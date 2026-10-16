// tests/e2e/bots.ts — propriétaire : qa-tester.
// Bots de jeu Pegbreaker (naive / greedy) + enregistreur QA injecté dans la page.
//
// Tout le code qui tourne DANS la page est dans `qaInstall` (fonction autonome sérialisée par
// Playwright : aucune référence à un import ou à une constante du module). Il installe
// `window.__qa` : un enregistreur branché sur `__pegbreaker.bus.onAny` (moments morts, softlocks,
// invariants, fps) et une boucle de jeu `play(cond)` cadencée par requestAnimationFrame.
import type { Page } from '@playwright/test';
import type { Block, DebugApi, RewardOption, RunPhase, RunState, Vec2 } from '../../src/core/types';
import { SPREAD_DEAD_PX, SPREAD_RANGE_PX } from '../../src/ui/input';

export type BotKind = 'naive' | 'greedy' | 'contracts';
/** à la mort (run:lost) : abandon immédiat (sim.giveUp), rien (le test pilote l'écran « Revanche ? »),
 *  ou seconde chance via le DOM si elle est possible et payable (sinon abandon) */
export type LostPolicy = 'giveUp' | 'none' | 'reviveIfAffordable';
/** ouverture de l'éventail : 'none' = jamais touchée (0, comportement d'avant le lot 1) ;
 *  'drag' = longueur de geste d'un débutant tirée uniformément dans [40, 320] px CSS → spreadFromDrag ;
 *  'max' = éventail systématique (1) */
export type SpreadMode = 'none' | 'drag' | 'max';

export interface QaInstallOptions {
  bot: BotKind;
  /** graine du PRNG du bot (jitter, choix aléatoires) */
  rngSeed: number;
  /** délai « humain » avant chaque tir (ms réelles) ; 0 = immédiat */
  humanDelayMs: number;
  /** le bot agit-il aussi sur les écrans récompense/boutique ? (false = smoke : le test clique le DOM) */
  handleChoices: boolean;
  /** comportement à la mort (défaut 'giveUp') */
  onLost?: LostPolicy;
  /** ouverture de l'éventail pour naive/contracts (défaut 'none') */
  spreadMode?: SpreadMode;
  /** zone morte et plage du geste (px CSS), recopiées de ui/input.ts (défaut 150 / 220) */
  spreadDeadPx?: number;
  spreadRangePx?: number;
}

export interface PlayCondition {
  /** rend la main dès que la phase devient l'une de celles-ci (avant que le bot n'agisse) */
  stopOnPhases?: RunPhase[];
  /** rend la main à l'ouverture d'un coffre de boss (phase 'reward' et state.rewardSource === 'boss'), avant que le bot ne choisisse */
  stopOnBossReward?: boolean;
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
  /** ouverture de l'éventail au tir */
  spread: number;
  /** distance lanceur → cible visée en px CSS (bot naïf ; 0 sinon) */
  targetPx: number;
  /** contrat actif au tir (kind) ou null */
  contract: string | null;
  /** dégâts et blocs cassés par la balle dorée sur ce tir */
  goldenDamage: number;
  goldenKills: number;
}

export interface LostRecord {
  wave: number;
  depth: number;
  canRevive: boolean;
  /** ms simulées (durationMs) au moment de la mort */
  simMs: number;
  /** action du bot : 'revive' | 'giveUp' | 'none' */
  action: string;
}

export interface ContractTally {
  offered: number;
  completed: number;
  failed: number;
  byKind: Record<string, { offered: number; completed: number; failed: number }>;
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
  /** lot 1 */
  lost: LostRecord[];
  revives: number;
  runOverCount: number;
  contracts: ContractTally;
  golden: { launches: number; damage: number; kills: number; hits: number };
  /** dégâts totaux de block:hit (pour la part de la balle dorée) */
  hitDamage: number;
  rewardSources: Record<string, number>;
  /** premier reward:offered (source) */
  firstOfferSource: string | null;
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
    shotSpread: 0,
    lastTargetPx: 0,
    shotTargetPx: 0,
    shotContract: null as string | null,
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
    overSeen: false,
    runOverCount: 0,
    lost: [] as LostRecord[],
    revives: 0,
    lostSince: -1,
    lostAction: '' as string,
    contracts: { offered: 0, completed: 0, failed: 0, byKind: {} } as ContractTally,
    contractKind: new Map<string, string>(),
    goldenIds: new Set<number>(),
    golden: { launches: 0, damage: 0, kills: 0, hits: 0 },
    shotGoldenDamage: 0,
    shotGoldenKills: 0,
    hitDamage: 0,
    rewardSources: {} as Record<string, number>,
    firstOfferSource: null as string | null,
  };
  for (const d of sim.config.contracts?.defs ?? []) rec.contractKind.set(d.id, d.kind);
  const tallyKind = (kind: string, k: 'offered' | 'completed' | 'failed'): void => {
    const b = (rec.contracts.byKind[kind] ??= { offered: 0, completed: 0, failed: 0 });
    b[k]++;
    rec.contracts[k]++;
  };
  // contrat de la vague courante déjà tiré avant l'installation du bot (vague 1 : tiré au chargement)
  {
    const c0 = sim.state.contract;
    if (c0) {
      const k0 = rec.contractKind.get(c0.id) ?? c0.id;
      tallyKind(k0, 'offered');
      if (c0.status === 'done') tallyKind(k0, 'completed');
      else if (c0.status === 'failed') tallyKind(k0, 'failed');
    }
  }

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
    else if (e.type === 'reward:offered') {
      const src = (e as { source?: string }).source ?? 'none';
      rec.rewardSources[src] = (rec.rewardSources[src] ?? 0) + 1;
      if (!rec.firstOffer) {
        rec.firstOffer = { perfNow: Math.round(performance.now()), simMs: Math.round(sim.state.stats.durationMs), shots: rec.shots, aimingMs: Math.round(rec.aimingMs) };
        rec.firstOfferSource = src;
      }
    } else if (e.type === 'run:over') {
      rec.overSeen = true;
      rec.runOverCount++;
    } else if (e.type === 'run:started') {
      rec.overSeen = false;
      rec.lostSince = -1;
    } else if (e.type === 'run:lost') {
      rec.lost.push({ wave: e.wave, depth: e.depth, canRevive: e.canRevive, simMs: Math.round(sim.state.stats.durationMs), action: '' });
    } else if (e.type === 'run:revived') rec.revives++;
    else if (e.type === 'contract:offered') tallyKind(e.def.kind, 'offered');
    else if (e.type === 'contract:completed') tallyKind(e.def.kind, 'completed');
    else if (e.type === 'contract:failed') tallyKind(e.def.kind, 'failed');
    else if (e.type === 'ball:launched') {
      if (e.golden) {
        rec.goldenIds.add(e.ballId);
        rec.golden.launches++;
      }
    } else if (e.type === 'block:hit') {
      rec.hitDamage += e.damage;
      if (rec.goldenIds.has(e.ballId)) {
        rec.golden.hits++;
        rec.golden.damage += e.damage;
        rec.shotGoldenDamage += e.damage;
        if (e.hpLeft <= 0) {
          rec.golden.kills++;
          rec.shotGoldenKills++;
        }
      }
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
    // modèle B du geste : le joueur glisse du lanceur jusqu'à la cible (longueur en px CSS)
    if (t) {
      const a = api.renderer.boardToScreen({ x: lp.x, y: lp.y });
      const b = api.renderer.boardToScreen({ x: t.col + t.width / 2, y: t.row + 0.5 });
      rec.lastTargetPx = Math.hypot(b.x - a.x, b.y - a.y);
    } else rec.lastTargetPx = 0;
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

  // --- éventail (F1) et bot « contrats » ----------------------------------------------
  /** débutant : longueur de geste uniforme 40–320 px CSS, convertie comme ui/input.ts (90 px morts, 220 px de plage) */
  function dragSpread(): number {
    if (opt.spreadMode === 'max') return 1;
    if ((opt.spreadMode ?? 'none') !== 'drag') return sim.state.aimSpread ?? 0;
    const len = 40 + rand() * 280;
    const v = (len - (opt.spreadDeadPx ?? 150)) / (opt.spreadRangePx ?? 220);
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  }

  function dirTo(x: number, y: number, jitterDeg: number): Vec2 {
    const lp = sim.state.launchPos;
    let ang = Math.atan2(-(y - lp.y), x - lp.x);
    ang += ((rand() * 2 - 1) * jitterDeg * Math.PI) / 180;
    return { x: Math.cos(ang), y: -Math.sin(ang) };
  }

  function activeContractKind(): string | null {
    const c = sim.state.contract;
    if (!c || c.status !== 'active') return null;
    return rec.contractKind.get(c.id) ?? null;
  }

  /** naïf qui lit le contrat : mur + rafale serrée pour combo/casse ; blocs près des drops pour pièces/balles ;
   *  éventail à 1 si ≥ 4 blocs sur une même rangée pour « nettoie en N tirs » */
  function aimContracts(): { dir: Vec2; spread: number } {
    const kind = activeContractKind();
    const s = sim.state;
    if (kind === 'reachCombo' || kind === 'destroyInOneShot') {
      let wallB: Block | null = null;
      let left = 0;
      let right = 0;
      for (const b of s.blocks) {
        if (!breakable(b)) continue;
        if (b.col + b.width / 2 < cols / 2) left++;
        else right++;
        const nearWall = b.col === 0 || b.col + b.width >= cols;
        if (nearWall && (!wallB || b.row > wallB.row)) wallB = b;
      }
      if (wallB) {
        const x = wallB.col === 0 ? 0.05 : cols - 0.05;
        return { dir: dirTo(x, wallB.row + 0.5, 3), spread: 0 };
      }
      const lo = lowest();
      const x = left >= right ? 0.05 : cols - 0.05;
      return { dir: dirTo(x, lo ? lo.row + 1.2 : rows / 2, 3), spread: 0 };
    }
    if ((kind === 'collectCoins' || kind === 'collectBalls') && s.drops.length > 0) {
      let best: Block | null = null;
      let bd = Infinity;
      for (const d of s.drops) {
        if (kind === 'collectBalls' && d.kind !== 'ball') continue;
        if (kind === 'collectCoins' && d.kind !== 'coin') continue;
        for (const b of s.blocks) {
          if (!breakable(b)) continue;
          const dd = Math.hypot(d.pos.x - (b.col + b.width / 2), d.pos.y - (b.row + 0.5));
          if (dd < bd) {
            bd = dd;
            best = b;
          }
        }
      }
      if (best) return { dir: dirTo(best.col + best.width / 2, best.row + 0.5, 5), spread: dragSpread() };
    }
    if (kind === 'clearUnderShots') {
      const byRow = new Map<number, Block[]>();
      for (const b of s.blocks) if (breakable(b)) (byRow.get(b.row) ?? byRow.set(b.row, []).get(b.row)!).push(b);
      let row = -1;
      for (const [r, bs] of byRow) if (bs.length >= 4 && r > row) row = r;
      if (row >= 0) {
        const bs = byRow.get(row)!;
        let cx = 0;
        for (const b of bs) cx += b.col + b.width / 2;
        return { dir: dirTo(cx / bs.length, row + 0.5, 4), spread: 1 };
      }
    }
    return { dir: aimNaive(), spread: dragSpread() };
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
    if (opt.bot === 'naive' || opt.bot === 'contracts') return Math.floor(rand() * offer.length);
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
      rec.shotGoldenDamage = 0;
      rec.shotGoldenKills = 0;
      rec.shotSpread = Number.isFinite(s.aimSpread) ? s.aimSpread : 0;
      rec.shotTargetPx = rec.lastTargetPx;
      const c = s.contract;
      rec.shotContract = c && c.status === 'active' ? (rec.contractKind.get(c.id) ?? c.id) : null;
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
        spread: Math.round(rec.shotSpread * 1000) / 1000,
        targetPx: Math.round(rec.shotTargetPx),
        contract: rec.shotContract,
        goldenDamage: rec.shotGoldenDamage,
        goldenKills: rec.shotGoldenKills,
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
      lost: rec.lost.map((x) => ({ ...x })),
      revives: rec.revives,
      runOverCount: rec.runOverCount,
      contracts: JSON.parse(JSON.stringify(rec.contracts)) as ContractTally,
      golden: { ...rec.golden },
      hitDamage: rec.hitDamage,
      rewardSources: { ...rec.rewardSources },
      firstOfferSource: rec.firstOfferSource,
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
      // mort (run:lost) : run:over n'arrive qu'après abandon ou revanche + seconde mort
      const pol: LostPolicy = opt.onLost ?? 'giveUp';
      if (s.phase === 'gameover' && !rec.overSeen && pol !== 'none') {
        const last = rec.lost[rec.lost.length - 1];
        if (rec.lostSince < 0) {
          rec.lostSince = now;
          const r = sim.config.economy.revive;
          const canRev = (s.revivesUsed ?? 0) < r.maxPerRun;
          const cost = r.freeOnFirstRun && api.meta.data.stats.runs === 0 ? 0 : r.cost;
          const affordable = cost === 0 || api.meta.data.meta.fragments >= cost;
          rec.lostAction = pol === 'reviveIfAffordable' && canRev && affordable ? 'revive' : 'giveUp';
          if (last) last.action = rec.lostAction;
          if (rec.lostAction === 'giveUp') sim.giveUp();
        } else if (rec.lostAction === 'revive') {
          // clic réel sur « Seconde chance » (débit des fragments par l'UI), écran ouvert ~700 ms après run:lost
          const btn = document.querySelector<HTMLButtonElement>('#ui[data-screen="revive"] [data-action="revive"]');
          if (btn && !btn.disabled) {
            btn.click();
            rec.lostSince = -1;
          } else if (now - rec.lostSince > 4000) {
            if (last) last.action = 'giveUp(revive-indisponible)';
            rec.lostAction = 'giveUp';
            sim.giveUp();
          }
        }
        if (c.maxRealMs !== undefined && now - t0 > c.maxRealMs) {
          rec.stopReason = 'timeout';
          break;
        }
        continue;
      }
      if (s.phase !== 'gameover') rec.lostSince = -1;
      // conditions d'arrêt
      if (c.stopOnPhases && c.stopOnPhases.indexOf(s.phase) >= 0) {
        rec.stopReason = `phase:${s.phase}`;
        break;
      }
      if (c.stopOnBossReward && s.phase === 'reward' && (s as { rewardSource?: string }).rewardSource === 'boss') {
        rec.stopReason = 'boss-reward';
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
          if (opt.bot === 'contracts') {
            const a = aimContracts();
            sim.aim(a.dir, a.spread);
          } else if (opt.bot === 'naive') {
            if ((opt.spreadMode ?? 'none') !== 'none') sim.aim(aimNaive(), dragSpread());
            else sim.aim(aimNaive());
          } else sim.aim(aimGreedy());
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
    if (p.onLost !== undefined) opt.onLost = p.onLost;
    if (p.spreadMode !== undefined) opt.spreadMode = p.spreadMode;
    if (p.spreadDeadPx !== undefined) opt.spreadDeadPx = p.spreadDeadPx;
    if (p.spreadRangePx !== undefined) opt.spreadRangePx = p.spreadRangePx;
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

export interface OpenOptions {
  /** URL relative (ex. '/?fresh=1') ; sinon `/?seed=<seed>` */
  url?: string;
  /** ferme l'écran titre (premier lancement) par un clic ; défaut true */
  dismissTitle?: boolean;
}

/** Collecte les erreurs console / page d'une page (à appeler une fois par page). */
export function watchErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  return consoleErrors;
}

/** Attend l'API de debug ; ferme l'écran titre s'il est affiché (clic = premier pointerdown, déverrouille l'audio). */
export async function waitReady(page: Page, dismissTitle = true): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as QaWindow).__pegbreaker?.sim);
  if (!dismissTitle) return;
  // écran « titre » : ancien écran .screen-title ou logo d'onboarding ; dans les deux cas #ui[data-screen=title]
  // (écran 'title' ou logo d'onboarding `.intro-logo.on` selon la version de l'UI)
  const isTitle = await page.evaluate(
    () => document.getElementById('ui')?.dataset.screen === 'title' || !!document.querySelector('.intro-logo.on'),
  );
  if (isTitle) {
    const vp = page.viewportSize() ?? { width: 540, height: 960 };
    await page.mouse.click(vp.width / 2, vp.height / 2);
    await page.waitForFunction(() => document.getElementById('ui')?.dataset.screen !== 'title');
  }
}

/** Ouvre le jeu (seed forcée par défaut : run jamais sauvegardée), branche la collecte d'erreurs, ferme le titre. */
export async function openGame(page: Page, seed: string, o: OpenOptions = {}): Promise<Session> {
  const consoleErrors = watchErrors(page);
  await page.goto(o.url ?? `/?seed=${encodeURIComponent(seed)}&qa=1`);
  await waitReady(page, o.dismissTitle ?? true);
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
    onLost: o.onLost ?? 'giveUp',
    spreadMode: o.spreadMode ?? 'none',
    spreadDeadPx: o.spreadDeadPx ?? SPREAD_DEAD_PX,
    spreadRangePx: o.spreadRangePx ?? SPREAD_RANGE_PX,
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

/** dossier des captures du jalon courant (lot 1 du plan fun) ; docs/qa/final-shots reste la référence « avant » */
export const SHOTS_DIR = 'docs/qa/fun-final-shots/suite';

/** captures du passage courant (anciennement docs/qa/final-shots) */
export const FINAL_SHOTS = 'docs/qa/fun-final-shots/suite';

/** préfixe des sorties JSON du passage courant (les fichiers final-*.json restent la référence « avant ») */
export const QA_OUT = 'docs/qa/fun-final';

/** captures du rapport fun-lot1 */
export const FUN_SHOTS = 'docs/qa/fun-final-shots';
