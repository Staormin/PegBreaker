// tests/e2e/bots.ts — propriétaire : qa-tester.
// Bots de jeu Pegbreaker (naive / greedy) + enregistreur QA injecté dans la page.
//
// Tout le code qui tourne DANS la page est dans `qaInstall` (fonction autonome sérialisée par
// Playwright : aucune référence à un import ou à une constante du module). Il installe
// `window.__qa` : un enregistreur branché sur `__pegbreaker.bus.onAny` (moments morts, softlocks,
// invariants, fps) et une boucle de jeu `play(cond)` cadencée par requestAnimationFrame.
import type { Page } from '@playwright/test';
import type { Block, DebugApi, RewardOption, RunPhase, RunState, Vec2 } from '../../src/core/types';

export type BotKind = 'naive' | 'greedy';

export interface QaInstallOptions {
  bot: BotKind;
  /** graine du PRNG du bot (jitter, choix aléatoires) */
  rngSeed: number;
  /** délai « humain » avant chaque tir (ms réelles) ; 0 = immédiat */
  humanDelayMs: number;
  /** le bot agit-il aussi sur les écrans récompense/boutique ? (false = smoke : le test clique le DOM) */
  handleChoices: boolean;
}

export interface PlayCondition {
  /** rend la main dès que la phase devient l'une de celles-ci (avant que le bot n'agisse) */
  stopOnPhases?: RunPhase[];
  /** rend la main quand firstRewardAt est renseigné */
  untilFirstReward?: boolean;
  /** rend la main après N tirs terminés de plus (phase sortie de 'firing') */
  shots?: number;
  /** garde-fou en ms réelles */
  maxRealMs?: number;
  /** échantillonne __pegbreaker.fps chaque seconde réelle dans ce seau */
  fpsBucket?: string;
  /** n'échantillonne les fps que pendant la phase 'firing' */
  fpsOnlyFiring?: boolean;
}

export interface Violation {
  kind: string;
  detail: string;
  shot: number;
  wave: number;
  phase: RunPhase;
}

export interface ShotRecord {
  shot: number;
  wave: number;
  damage: number;
  combo: number;
  destroyed: number;
  volley: number;
  firingMs: number;
}

export interface QaReport {
  stopReason: string;
  shots: number;
  rewardChoices: number;
  buys: number;
  skips: number;
  /** ms simulées hors écrans de choix */
  activeMs: number;
  /** ms simulées sur reward/shop */
  choiceMs: number;
  /** ms simulées passées en 'aiming' (latence du bot + délais humains) */
  aimingMs: number;
  deadMoments: { gapMs: number; shot: number; wave: number }[];
  maxFeedbackGapMs: number;
  softlocks: Violation[];
  violations: Violation[];
  maxFiringMs: number;
  fps: Record<string, number[]>;
  /** durées de frame rAF mesurées par le bot (ms), par seau */
  frames: Record<string, number[]>;
  shotLog: ShotRecord[];
  rewardsTaken: string[];
  firstRewardAt: number | null;
  /** premier écran de récompense (fin de vague 1) : horloge page, temps simulé, tirs, visée bot */
  firstOffer: { perfNow: number; simMs: number; shots: number; aimingMs: number } | null;
  /** dégâts subis (player:damaged) et blocs ayant franchi la ligne (block:breached) */
  damageTaken: number;
  breaches: number;
  breachesByKind: Record<string, number>;
  /** dégâts subis par type de bloc ayant franchi la ligne */
  breachDamageByKind: Record<string, number>;
  bossesSpawned: number;
  pageErrors: string[];
  state: {
    phase: RunPhase;
    wave: number;
    depth: number;
    hp: number;
    maxHp: number;
    volley: number;
    coins: number;
    relics: string[];
    stats: RunState['stats'];
  };
}

interface QaApi {
  play(c: PlayCondition): Promise<QaReport>;
  report(): QaReport;
  checkInvariants(where: string): void;
  /** change le bot, le délai humain ou la gestion des choix en cours de run */
  configure(p: Partial<QaInstallOptions>): void;
}

export type QaWindow = Window & { __pegbreaker: DebugApi; __qa: QaApi };

/**
 * S'exécute dans la page. Installe window.__qa. Autonome (pas de closure sur le module).
 */
export function qaInstall(opt: QaInstallOptions): void {
  const w = window as unknown as QaWindow;
  const api = w.__pegbreaker;
  const sim = api.sim;
  const board = sim.config.blocks.board;
  const cols = board.cols;
  const rows = board.rows;
  const CHOICE: RunPhase[] = ['reward', 'shop', 'gameover'];
  const FEEDBACK = ['ball:', 'block:', 'drop:', 'combo:', 'reward:'];

  // --- PRNG du bot (mulberry32) ---------------------------------------------
  let rs = opt.rngSeed >>> 0;
  const rand = (): number => {
    rs = (rs + 0x6d2b79f5) >>> 0;
    let t = rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // --- enregistreur -----------------------------------------------------------
  const startErrors = api.errors.length;
  const rec = {
    shots: 0,
    rewardChoices: 0,
    buys: 0,
    skips: 0,
    activeMs: 0,
    choiceMs: 0,
    aimingMs: 0,
    lastDur: sim.state.stats.durationMs,
    lastPhase: sim.state.phase as RunPhase,
    lastFeedbackActive: 0,
    deadMoments: [] as { gapMs: number; shot: number; wave: number }[],
    maxFeedbackGapMs: 0,
    frozenMs: 0,
    lastSig: '',
    softlocks: [] as Violation[],
    violations: [] as Violation[],
    firingStart: -1,
    maxFiringMs: 0,
    fps: {} as Record<string, number[]>,
    frames: {} as Record<string, number[]>,
    shotLog: [] as ShotRecord[],
    rewardsTaken: [] as string[],
    destroyedAtFire: 0,
    nextFireAt: -1,
    stopReason: '',
    violationKeys: new Set<string>(),
    buysAtShopOpen: 0,
    firstOffer: null as QaReport['firstOffer'],
    damageTaken: 0,
    breaches: 0,
    breachesByKind: {} as Record<string, number>,
    breachDamageByKind: {} as Record<string, number>,
    bossesSpawned: 0,
  };

  const isChoice = (p: RunPhase): boolean => CHOICE.indexOf(p) >= 0;

  function tickClock(): void {
    const d = sim.state.stats.durationMs;
    let delta = d - rec.lastDur;
    if (delta < 0) delta = 0;
    if (isChoice(rec.lastPhase)) rec.choiceMs += delta;
    else {
      rec.activeMs += delta;
      if (rec.lastPhase === 'aiming') rec.aimingMs += delta;
    }
    rec.lastDur = d;
  }

  function addViolation(list: Violation[], kind: string, detail: string): void {
    const s = sim.state;
    // une seule entrée par (type, tir) pour ne pas noyer le rapport
    const key = `${kind}@${rec.shots}`;
    if (rec.violationKeys.has(key)) return;
    rec.violationKeys.add(key);
    if (list.length < 50) list.push({ kind, detail, shot: rec.shots, wave: s.wave, phase: s.phase });
  }

  function closeGap(): void {
    const gap = rec.activeMs - rec.lastFeedbackActive;
    if (gap > rec.maxFeedbackGapMs) rec.maxFeedbackGapMs = gap;
    if (gap > 5000) rec.deadMoments.push({ gapMs: Math.round(gap), shot: rec.shots, wave: sim.state.wave });
    rec.lastFeedbackActive = rec.activeMs;
  }

  api.bus.onAny((e) => {
    tickClock();
    if (e.type === 'player:damaged') rec.damageTaken += e.amount;
    else if (e.type === 'block:breached') {
      rec.breaches++;
      rec.breachesByKind[e.kind] = (rec.breachesByKind[e.kind] ?? 0) + 1;
      rec.breachDamageByKind[e.kind] = (rec.breachDamageByKind[e.kind] ?? 0) + e.damage;
    } else if (e.type === 'boss:spawned') rec.bossesSpawned++;
    else if (e.type === 'reward:offered' && !rec.firstOffer) {
      rec.firstOffer = { perfNow: Math.round(performance.now()), simMs: Math.round(sim.state.stats.durationMs), shots: rec.shots, aimingMs: Math.round(rec.aimingMs) };
    }
    for (let i = 0; i < FEEDBACK.length; i++) {
      if (e.type.startsWith(FEEDBACK[i] as string)) {
        closeGap();
        break;
      }
    }
  });

  function checkBalls(): void {
    const s = sim.state;
    const tol = 0.02;
    for (const b of s.balls) {
      if (!Number.isFinite(b.pos.x) || !Number.isFinite(b.pos.y) || !Number.isFinite(b.vel.x) || !Number.isFinite(b.vel.y)) {
        addViolation(rec.violations, 'ball-nan', `balle ${b.id} pos=(${b.pos.x},${b.pos.y}) vel=(${b.vel.x},${b.vel.y})`);
      } else if (b.pos.x < -tol || b.pos.x > cols + tol || b.pos.y < -tol || b.pos.y > rows + tol) {
        addViolation(rec.violations, 'ball-out', `balle ${b.id} hors plateau pos=(${b.pos.x.toFixed(3)},${b.pos.y.toFixed(3)})`);
      }
    }
  }

  function findNaN(o: unknown, path: string, out: string[], depth: number, seen: Set<unknown>): void {
    if (out.length >= 5 || depth > 8) return;
    if (typeof o === 'number') {
      if (!Number.isFinite(o)) out.push(`${path}=${o}`);
      return;
    }
    if (o === null || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) findNaN(o[i], `${path}[${i}]`, out, depth + 1, seen);
      return;
    }
    for (const k of Object.keys(o as Record<string, unknown>)) findNaN((o as Record<string, unknown>)[k], `${path}.${k}`, out, depth + 1, seen);
  }

  function checkInvariants(where: string): void {
    const s = sim.state;
    const bad: string[] = [];
    // `internal` contient des sentinelles (ex. -Infinity) d'implémentation : vérifié séparément pour NaN seulement
    const pub: Record<string, unknown> = {};
    for (const k of Object.keys(s)) if (k !== 'internal') pub[k] = (s as unknown as Record<string, unknown>)[k];
    findNaN(pub, 'state', bad, 0, new Set());
    if (bad.length) addViolation(rec.violations, 'nan', `${where}: ${bad.join(', ')}`);
    const internalNaN: string[] = [];
    const scan = (o: unknown, p: string, d: number): void => {
      if (internalNaN.length >= 3 || d > 6) return;
      if (typeof o === 'number') {
        if (Number.isNaN(o)) internalNaN.push(p);
        return;
      }
      if (o && typeof o === 'object') for (const k of Object.keys(o)) scan((o as Record<string, unknown>)[k], `${p}.${k}`, d + 1);
    };
    scan((s as unknown as { internal?: unknown }).internal, 'internal', 0);
    if (internalNaN.length) addViolation(rec.violations, 'nan-internal', `${where}: ${internalNaN.join(', ')}`);
    // depuis 8a20d70 : PV et dégâts entiers ; maxHp ≥ 1 sauf chevilles (incassables, hp = 0)
    for (const b of s.blocks) {
      if (!Number.isInteger(b.hp) || !Number.isInteger(b.maxHp) || (b.kind !== 'peg' && b.maxHp < 1)) addViolation(rec.violations, 'block-hp-int', `${where}: bloc ${b.id} (${b.kind}) hp=${b.hp} maxHp=${b.maxHp}`);
    }
    const st = s.stats;
    for (const [k, v] of [['bestShotDamage', st.bestShotDamage], ['totalDamage', st.totalDamage], ['currentShotDamage', s.currentShotDamage]] as const) {
      if (!Number.isInteger(v)) addViolation(rec.violations, 'damage-int', `${where}: ${k}=${v}`);
    }
    if (s.hp > s.maxHp) addViolation(rec.violations, 'hp>maxHp', `${where}: hp=${s.hp} maxHp=${s.maxHp}`);
    if (s.volley.length < 1) addViolation(rec.violations, 'volley-empty', `${where}: volley.length=${s.volley.length}`);
    const cells = new Map<string, number>();
    for (const b of s.blocks) {
      for (let c = b.col; c < b.col + Math.max(1, b.width); c++) {
        const key = `${c},${b.row}`;
        const other = cells.get(key);
        if (other !== undefined) addViolation(rec.violations, 'block-overlap', `${where}: blocs ${other} et ${b.id} sur la cellule (${key})`);
        else cells.set(key, b.id);
      }
      if (b.col < 0 || b.col + b.width > cols) addViolation(rec.violations, 'block-out', `${where}: bloc ${b.id} col=${b.col} width=${b.width}`);
    }
    checkBalls();
  }

  // --- stratégies de visée ------------------------------------------------------
  const breakable = (b: Block): boolean => b.kind !== 'peg' && b.hp > 0;

  function lowest(): Block | null {
    let best: Block | null = null;
    for (const b of sim.state.blocks) {
      if (!breakable(b)) continue;
      if (!best || b.row > best.row || (b.row === best.row && rand() < 0.5)) best = b;
    }
    return best;
  }

  function aimNaive(): Vec2 {
    const lp = sim.state.launchPos;
    const t = lowest();
    let ang = Math.PI / 2; // vertical
    if (t) ang = Math.atan2(-(t.row + 0.5 - lp.y), t.col + t.width / 2 - lp.x);
    ang += ((rand() * 2 - 1) * 10 * Math.PI) / 180;
    return { x: Math.cos(ang), y: -Math.sin(ang) };
  }

  function blockAt(p: Vec2): Block | null {
    const m = board.ballRadius + 0.06;
    let best: Block | null = null;
    let bd = Infinity;
    for (const b of sim.state.blocks) {
      if (p.x < b.col - m || p.x > b.col + b.width + m || p.y < b.row - m || p.y > b.row + 1 + m) continue;
      const d = Math.hypot(p.x - (b.col + b.width / 2), p.y - (b.row + 0.5));
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  function aimGreedy(): Vec2 {
    const minA = (board.minAimAngleDeg * Math.PI) / 180;
    let bestDir: Vec2 = { x: 0, y: -1 };
    let bestScore = -Infinity;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const a = minA + ((Math.PI - 2 * minA) * (i + 0.5)) / N;
      const dir = { x: Math.cos(a), y: -Math.sin(a) };
      const pts = sim.preview(dir);
      const hit = pts[1];
      let score = 0;
      if (hit) {
        const b = blockAt(hit);
        if (b && breakable(b)) {
          const nearWall = b.col === 0 || b.col + b.width >= cols;
          score = 100 + b.row * 10 + (nearWall ? 15 : 0) - (b.kind === 'armored' ? 8 : 0) + (b.kind === 'explosive' ? 6 : 0);
        } else if (b) {
          score = 40 + b.row * 3; // cheville : combo
        } else {
          score = hit.y < 0.2 ? 30 : 20; // plafond ou mur
        }
      }
      score += rand() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestDir = dir;
      }
    }
    return bestDir;
  }

  // --- choix --------------------------------------------------------------------
  function optKey(o: RewardOption): string {
    switch (o.kind) {
      case 'ball':
        return `ball:${o.element}`;
      case 'relic':
        return `relic:${o.relicId}`;
      case 'fuse':
        return `fuse:${o.element}${o.tier}`;
      case 'coins':
        return `coins:${o.amount}`;
      case 'heal':
        return `heal:${o.amount}`;
    }
  }

  function relicRarity(id: string): string {
    const d = sim.config.relics.defs.find((x) => x.id === id);
    return d ? d.rarity : 'common';
  }

  function chooseRewardIndex(offer: readonly RewardOption[]): number {
    if (opt.bot === 'naive') return Math.floor(rand() * offer.length);
    const s = sim.state;
    const find = (pred: (o: RewardOption) => boolean): number => offer.findIndex(pred);
    let i = -1;
    if (s.volley.length < 8) i = find((o) => o.kind === 'ball');
    if (i < 0) i = find((o) => o.kind === 'relic' && relicRarity(o.relicId) !== 'common');
    if (i < 0) i = find((o) => o.kind === 'fuse');
    if (i < 0) i = find((o) => o.kind === 'relic');
    if (i < 0) i = find((o) => o.kind === 'ball');
    return i < 0 ? 0 : i;
  }

  /** une action boutique par appel (achat, ou départ) */
  function shopStep(): void {
    const s = sim.state;
    const shop = s.shop;
    if (!shop) return;
    const affordable: number[] = [];
    shop.items.forEach((it, i) => {
      if (!it.sold && it.price <= s.coins) affordable.push(i);
    });
    let pick = -1;
    if (opt.bot === 'greedy') {
      pick = affordable.find((i) => shop.items[i]?.option.kind === 'ball') ?? -1;
    } else if (affordable.length && rec.buys === rec.buysAtShopOpen) {
      // débutant : un achat au hasard par boutique
      pick = affordable[Math.floor(rand() * affordable.length)] ?? -1;
    }
    if (pick >= 0) {
      const before = s.coins;
      sim.buy(pick);
      if (sim.state.coins !== before) rec.buys++;
      else sim.leaveShop();
      return;
    }
    sim.leaveShop();
  }

  function onPhaseChange(prev: RunPhase, next: RunPhase): void {
    const s = sim.state;
    if (next === 'firing') {
      rec.firingStart = s.stats.durationMs;
      rec.destroyedAtFire = s.stats.blocksDestroyed;
    }
    if (prev === 'firing') {
      const ms = s.stats.durationMs - rec.firingStart;
      rec.shotLog.push({
        shot: s.stats.shots,
        wave: s.wave,
        damage: Math.round(s.currentShotDamage),
        combo: s.currentShotCombo,
        destroyed: s.stats.blocksDestroyed - rec.destroyedAtFire,
        volley: s.volley.length,
        firingMs: Math.round(ms),
      });
      rec.firingStart = -1;
    }
    if (next === 'shop') rec.buysAtShopOpen = rec.buys;
    if (next === 'gameover') closeGap();
    checkInvariants(`${prev}->${next}`);
  }

  function report(): QaReport {
    const s = sim.state;
    return {
      stopReason: rec.stopReason,
      shots: rec.shots,
      rewardChoices: rec.rewardChoices,
      buys: rec.buys,
      skips: rec.skips,
      activeMs: Math.round(rec.activeMs),
      choiceMs: Math.round(rec.choiceMs),
      aimingMs: Math.round(rec.aimingMs),
      deadMoments: rec.deadMoments.slice(),
      maxFeedbackGapMs: Math.round(rec.maxFeedbackGapMs),
      softlocks: rec.softlocks.slice(),
      violations: rec.violations.slice(),
      maxFiringMs: Math.round(rec.maxFiringMs),
      fps: JSON.parse(JSON.stringify(rec.fps)) as Record<string, number[]>,
      frames: JSON.parse(JSON.stringify(rec.frames)) as Record<string, number[]>,
      shotLog: rec.shotLog.slice(),
      rewardsTaken: rec.rewardsTaken.slice(),
      firstRewardAt: api.firstRewardAt,
      firstOffer: rec.firstOffer,
      damageTaken: rec.damageTaken,
      breaches: rec.breaches,
      breachesByKind: { ...rec.breachesByKind },
      breachDamageByKind: { ...rec.breachDamageByKind },
      bossesSpawned: rec.bossesSpawned,
      pageErrors: api.errors.slice(startErrors),
      state: {
        phase: s.phase,
        wave: s.wave,
        depth: s.depth,
        hp: s.hp,
        maxHp: s.maxHp,
        volley: s.volley.length,
        coins: s.coins,
        relics: s.relics.slice(),
        stats: { ...s.stats },
      },
    };
  }

  async function play(c: PlayCondition): Promise<QaReport> {
    const t0 = performance.now();
    const shots0 = rec.shotLog.length;
    let lastFpsAt = performance.now();
    rec.stopReason = '';
    rec.lastSig = '';
    rec.frozenMs = 0;
    let lastRealProgress = performance.now();
    let lastDurSeen = sim.state.stats.durationMs;
    let prevFrame = performance.now();
    for (;;) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const now = performance.now();
      if (c.fpsBucket && (!c.fpsOnlyFiring || sim.state.phase === 'firing')) {
        const fr = (rec.frames[c.fpsBucket] ??= []);
        if (fr.length < 20000) fr.push(Math.round((now - prevFrame) * 10) / 10);
      }
      prevFrame = now;
      const s = sim.state;
      const before = rec.lastDur;
      tickClock();
      const delta = rec.lastDur - before;

      if (s.phase !== rec.lastPhase) {
        const prev = rec.lastPhase;
        rec.lastPhase = s.phase;
        onPhaseChange(prev, s.phase);
      }
      if (s.phase === 'firing') {
        checkBalls();
        if (rec.firingStart >= 0) {
          const ms = s.stats.durationMs - rec.firingStart;
          if (ms > rec.maxFiringMs) rec.maxFiringMs = ms;
          if (ms > board.maxVolleyMs + 2000) addViolation(rec.softlocks, 'firing-too-long', `firing depuis ${Math.round(ms)} ms simulées`);
        }
      }
      // softlock : phase + compteurs figés > 10 s simulées hors écrans de choix
      let total = 0;
      for (const k in api.eventCounts) total += api.eventCounts[k] ?? 0;
      const sig = `${s.phase}|${total}`;
      if (!isChoice(s.phase) && sig === rec.lastSig) rec.frozenMs += delta;
      else rec.frozenMs = 0;
      rec.lastSig = sig;
      if (rec.frozenMs > 10000) {
        addViolation(rec.softlocks, 'softlock', `phase ${s.phase} figée, eventCounts inchangés depuis ${Math.round(rec.frozenMs)} ms simulées`);
        rec.stopReason = 'softlock';
        break;
      }
      // sim gelée en temps réel (exception dans la boucle, onglet mort)
      if (s.stats.durationMs !== lastDurSeen || s.phase === 'gameover') {
        lastDurSeen = s.stats.durationMs;
        lastRealProgress = now;
      } else if (now - lastRealProgress > 10000) {
        addViolation(rec.softlocks, 'sim-frozen', `durationMs figé depuis 10 s réelles (phase ${s.phase})`);
        rec.stopReason = 'sim-frozen';
        break;
      }
      if (c.fpsBucket && now - lastFpsAt >= 1000 && (!c.fpsOnlyFiring || s.phase === 'firing')) {
        lastFpsAt = now;
        (rec.fps[c.fpsBucket] ??= []).push(api.fps);
      }
      if (api.errors.length > startErrors) {
        rec.stopReason = 'page-error';
        break;
      }
      // conditions d'arrêt
      if (c.stopOnPhases && c.stopOnPhases.indexOf(s.phase) >= 0) {
        rec.stopReason = `phase:${s.phase}`;
        break;
      }
      if (c.untilFirstReward && api.firstRewardAt !== null) {
        rec.stopReason = 'first-reward';
        break;
      }
      if (c.shots !== undefined && rec.shotLog.length - shots0 >= c.shots) {
        rec.stopReason = 'shots';
        break;
      }
      if (s.phase === 'gameover') {
        rec.stopReason = 'gameover';
        break;
      }
      if (c.maxRealMs !== undefined && now - t0 > c.maxRealMs) {
        rec.stopReason = 'timeout';
        break;
      }
      // actions du bot
      if (s.phase === 'aiming') {
        if (rec.nextFireAt < 0) rec.nextFireAt = now + opt.humanDelayMs;
        if (now >= rec.nextFireAt) {
          rec.nextFireAt = -1;
          sim.aim(opt.bot === 'naive' ? aimNaive() : aimGreedy());
          sim.fire();
          if (sim.state.phase === 'firing') rec.shots++;
        }
      } else if (opt.handleChoices && s.phase === 'reward' && s.rewardOffer) {
        const i = chooseRewardIndex(s.rewardOffer);
        const o = s.rewardOffer[i];
        if (o) rec.rewardsTaken.push(optKey(o));
        sim.chooseReward(i);
        rec.rewardChoices++;
      } else if (opt.handleChoices && s.phase === 'shop') {
        shopStep();
      }
    }
    return report();
  }

  function configure(p: Partial<QaInstallOptions>): void {
    if (p.bot !== undefined) opt.bot = p.bot;
    if (p.humanDelayMs !== undefined) opt.humanDelayMs = p.humanDelayMs;
    if (p.handleChoices !== undefined) opt.handleChoices = p.handleChoices;
    rec.nextFireAt = -1;
  }

  w.__qa = { play, report, checkInvariants, configure };
}

// =====================================================================
// Côté Node
// =====================================================================

export interface Session {
  page: Page;
  consoleErrors: string[];
}

/** Ouvre le jeu sur une seed, branche la collecte d'erreurs console, attend l'API de debug. */
export async function openGame(page: Page, seed: string): Promise<Session> {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(`/?seed=${encodeURIComponent(seed)}`);
  await page.waitForFunction(() => !!(window as unknown as QaWindow).__pegbreaker?.sim);
  return { page, consoleErrors };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export async function installBot(page: Page, o: Partial<QaInstallOptions> & { bot: BotKind; seed: string }): Promise<void> {
  const opts: QaInstallOptions = {
    bot: o.bot,
    rngSeed: o.rngSeed ?? hashSeed(`${o.bot}:${o.seed}`),
    humanDelayMs: o.humanDelayMs ?? 0,
    handleChoices: o.handleChoices ?? true,
  };
  await page.evaluate(qaInstall, opts);
}

export async function play(page: Page, c: PlayCondition): Promise<QaReport> {
  return page.evaluate((cond) => (window as unknown as QaWindow).__qa.play(cond), c);
}

export async function configureBot(page: Page, p: Partial<QaInstallOptions>): Promise<void> {
  await page.evaluate((x) => (window as unknown as QaWindow).__qa.configure(x), p);
}

export async function qaReport(page: Page): Promise<QaReport> {
  return page.evaluate(() => (window as unknown as QaWindow).__qa.report());
}

export async function setSpeed(page: Page, n: number): Promise<void> {
  await page.evaluate((m) => (window as unknown as QaWindow).__pegbreaker.setSpeed(m), n);
}

// --- géométrie écran : renderer.boardToScreen (px CSS relatifs au canvas) + rect du canvas ------
/** Convertit des points plateau en coordonnées client (pour page.mouse / touch). */
export async function boardToClient(page: Page, pts: Vec2[]): Promise<Vec2[]> {
  return page.evaluate((ps) => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    const r = (document.getElementById('game') as HTMLCanvasElement).getBoundingClientRect();
    return ps.map((p) => {
      const q = api.renderer.boardToScreen(p);
      return { x: r.left + q.x, y: r.top + q.y };
    });
  }, pts);
}

/** Cible « bloc le plus bas cassable » (centre), ou un point au-dessus du lanceur. */
export async function lowestBlockTarget(page: Page): Promise<{ target: Vec2; launch: Vec2 }> {
  return page.evaluate(() => {
    const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
    let best: { col: number; row: number; width: number } | null = null;
    for (const b of s.blocks) if (b.kind !== 'peg' && (!best || b.row > best.row)) best = b;
    const launch = { x: s.launchPos.x, y: s.launchPos.y };
    const target = best ? { x: best.col + best.width / 2, y: best.row + 0.5 } : { x: launch.x, y: 1 };
    return { target, launch };
  });
}

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))] as number;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
