// tests/e2e/balls.spec.ts — propriétaire : qa-tester. Les 20 nouvelles balles (docs/BALLS.md, 2026-10-17).
//
// Par balle : `?seed=balls-<id>&qa=1`, volée forcée à 5 balles de l'élément (rangs I, I, I, II, III) avant CHAQUE tir
// via `sim.state.volley`, visée déterministe (bloc cassable le plus bas, décalage ±0,3 selon le tir), ouverture 0,
// vitesse 8, 6 tirs. Récompenses : première option qui n'est pas une relique (sinon passer) ; boutique : quitter.
// Vampire seulement : PV ramenés à maxHp − 3 avant chaque tir (le soin n'est émis que si PV < maxHp).
//
// Le pilote (`ballsInstall`, autonome, sérialisé dans la page) enveloppe `sim.step` : après chaque pas fixe (1/60 s),
// il lit les événements du pas ET l'état (balles, blocs) pour détecter les signaux de mécanique, les NaN et les
// invariants. Aucun code du jeu n'est modifié. Résultats : docs/qa/balls-data/<id>.json, capture en vol :
// docs/qa/balls-shots/<id>.png. Dernier test : perf (30 balles des nouvelles familles, CPU 4×, DPR 1,5).
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { BallElement } from '../../src/core/types';
import { waitReady, watchErrors, type QaWindow } from './bots';

const NEW: BallElement[] = [
  'acid', 'magnet', 'pierce', 'bomb', 'homing', 'giant', 'swarm', 'vampire', 'gold', 'prism',
  'void', 'echo', 'boomerang', 'crystal', 'shock', 'twin', 'rust', 'nova', 'comet', 'lucky',
];
const SHOTS = 6;
const TIERS = [1, 1, 1, 2, 3];
const SHOTS_DIR = 'docs/qa/balls-shots';
const DATA_DIR = 'docs/qa/balls-data';

export interface BallsOpts {
  elements: BallElement[];
  tiers: number[];
  shots: number;
  speed: number;
  /** PV ramenés à maxHp − 3 avant chaque tir */
  wound: boolean;
  /** élément suivi (signaux) */
  focus: BallElement;
  /** capture demandée en vol (pause à vitesse 0,1) */
  capture: boolean;
  /** si > 0 : avant chaque tir, les blocs cassables sous ce nombre de PV max passent à ce nombre (hp = maxHp) */
  beef?: number;
}

export interface BallsReport {
  done: string;
  shots: number;
  wave: number;
  depth: number;
  hp: number;
  maxHp: number;
  simMs: number;
  counts: Record<string, number>;
  explodeByEl: Record<string, number>;
  chainByEl: Record<string, number>;
  splitByEl: Record<string, number>;
  healBySource: Record<string, number>;
  destroyedByEl: Record<string, number>;
  hitsByEl: Record<string, number>;
  damageByEl: Record<string, number>;
  kinds: Record<string, number>;
  focus: {
    critLowCombo: number;
    critHits: number;
    hits: number;
    acidMax: number;
    acidBlocks: number;
    /** acide : blocs chargés au moment du tir, et PV qu'ils perdent pendant sim.fire() (morsure de début de tir) */
    acidChargedAtFire: number;
    acidTickBlocks: number;
    acidTickDamage: number;
    /** sonde : quadruplets dans internal.acidQ juste avant sim.fire() (interne, lecture seule) */
    acidQAtFire: number;
    /** blocs chargés encore vivants à la fin du tir (volley:end) */
    acidAliveAtEnd: number;
    rowUp: number;
    maxHpDrop: number;
    radiusMin: number;
    radiusMax: number;
    speedRatioMin: number;
    speedRatioMax: number;
    homingSamples: number;
    homingDeviated: number;
    homingMaxDevDeg: number;
    groundBounces: number;
    groundedAtOrigin: number;
    groundedTotal: number;
    magnetRemote: number;
    magnetRemoteMaxDist: number;
    dropsCollectedInFlight: number;
    pierceHits: number;
    pierceBlockBounces: number;
    voidMatch: number;
    voidNoBonus: number;
    voidSamples: number;
    goldCoin: number;
    /** drop « balle garantie » (guaranteedBallEvery) au point d'un bloc détruit par l'or, à la place de la pièce */
    goldBall: number;
    goldDestroyed: number;
    ceilingBounces: number;
    comboMax: number;
    /** traqueuse : déviation max (°) par rang ; boomerang : vol max (ms simulées) avant le sol, par rang */
    homingMaxDevByTier: Record<string, number>;
    /** traqueuse : rebonds où la déviation dépasse maxDeg du rang (angle de la vitesse à l'horizontale, en °) */
    homingOverMax: { tier: number; dev: number; angleFromHorizDeg: number }[];
    flightMsMaxByTier: Record<string, number>;
    groundedBeforeMs: number;
  };
  /** déviation (°) après rebond simple, toutes balles (contrôle pour la traqueuse) */
  devSamples: number;
  devOver2: number;
  maxLive: number;
  maxParticles: number;
  nan: string[];
  violations: string[];
  pageErrors: string[];
  shotDamage: number[];
  captured: boolean;
}

/** S'exécute dans la page. Installe window.__bt. Autonome. */
export function ballsInstall(o: BallsOpts): void {
  type W = Window & { __pegbreaker: QaWindow['__pegbreaker']; __bt: unknown };
  const w = window as unknown as W;
  const api = w.__pegbreaker;
  const sim = api.sim;
  const cfg = sim.config;
  const board = cfg.blocks.board;
  const ROWS = board.rows;
  const COLS = board.cols;
  const SPEED = board.ballSpeed;
  const DROP_R = 0.25;
  const errStart = api.errors.length;
  const inc = (m: Record<string, number>, k: string, n = 1): void => {
    m[k] = (m[k] ?? 0) + n;
  };
  const R: BallsReport = {
    done: '',
    shots: 0,
    wave: 0,
    depth: 0,
    hp: 0,
    maxHp: 0,
    simMs: 0,
    counts: {},
    explodeByEl: {},
    chainByEl: {},
    splitByEl: {},
    healBySource: {},
    destroyedByEl: {},
    hitsByEl: {},
    damageByEl: {},
    kinds: {},
    focus: {
      critLowCombo: 0, critHits: 0, hits: 0, acidMax: 0, acidBlocks: 0, acidChargedAtFire: 0, acidTickBlocks: 0, acidTickDamage: 0, acidQAtFire: 0, acidAliveAtEnd: 0, rowUp: 0, maxHpDrop: 0,
      radiusMin: Infinity, radiusMax: 0, speedRatioMin: Infinity, speedRatioMax: 0,
      homingSamples: 0, homingDeviated: 0, homingMaxDevDeg: 0,
      groundBounces: 0, groundedAtOrigin: 0, groundedTotal: 0,
      magnetRemote: 0, magnetRemoteMaxDist: 0, dropsCollectedInFlight: 0,
      pierceHits: 0, pierceBlockBounces: 0, voidMatch: 0, voidNoBonus: 0, voidSamples: 0,
      goldCoin: 0, goldBall: 0, goldDestroyed: 0, ceilingBounces: 0, comboMax: 0,
      homingMaxDevByTier: {}, homingOverMax: [], flightMsMaxByTier: {}, groundedBeforeMs: 0,
    },
    devSamples: 0,
    devOver2: 0,
    maxLive: 0,
    maxParticles: 0,
    nan: [],
    violations: [],
    pageErrors: [],
    shotDamage: [],
    captured: false,
  };
  const F = R.focus;
  const ballMeta = new Map<number, { el: string; golden: boolean; tier: number; seen: boolean; kind: string }>();
  const launchAt = new Map<number, number>();
  const prevVel = new Map<number, { x: number; y: number }>();
  const prevRow = new Map<number, number>();
  const prevMaxHp = new Map<number, number>();
  const acidSeen = new Set<number>();
  const kindSeen = new Set<string>();
  let originX = sim.state.launchPos.x;
  let fireSimMs = 0;
  let shotIdx = 0;
  let capturePending = o.capture;
  let paused = false;

  const walkNaN = (v: unknown, path: string, depth: number): void => {
    if (R.nan.length >= 8) return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) R.nan.push(`${path}=${String(v)}`);
      return;
    }
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walkNaN(v[i], `${path}[${i}]`, depth + 1);
      return;
    }
    for (const k of Object.keys(v as Record<string, unknown>)) {
      if (depth === 0 && k === 'internal') continue;
      walkNaN((v as Record<string, unknown>)[k], `${path}.${k}`, depth + 1);
    }
  };
  const violate = (msg: string): void => {
    if (R.violations.length < 20) R.violations.push(`tir ${R.shots} : ${msg}`);
  };
  const checkInvariants = (): void => {
    const s = sim.state;
    walkNaN(s, 'state', 0);
    if (s.hp > s.maxHp) violate(`hp ${s.hp} > maxHp ${s.maxHp}`);
    if (s.volley.length < 1) violate('volée vide');
    const cells = new Set<string>();
    for (const b of s.blocks) {
      for (let c = b.col; c < b.col + b.width; c++) {
        const key = `${c},${b.row}`;
        if (cells.has(key)) violate(`cellule ${key} en double`);
        cells.add(key);
      }
      if (b.hp < 0 || b.hp > b.maxHp + 1e-6) violate(`bloc ${b.id} hp ${b.hp}/${b.maxHp}`);
    }
  };

  const vecDevDeg = (ax: number, ay: number, bx: number, by: number): number => {
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return 0;
    const c = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    return (Math.acos(c) * 180) / Math.PI;
  };

  const orig = sim.step.bind(sim);
  (sim as { step: (dt: number) => readonly unknown[] }).step = (dt: number) => {
    const phaseBefore = sim.state.phase;
    const evs = orig(dt) as readonly import('../../src/core/types').GameEvent[];
    const s = sim.state;
    const bounceCount = new Map<number, { n: number; nx: number; ny: number; surface: string }>();
    const destroyedPos: { x: number; y: number }[] = [];
    for (const e of evs) {
      inc(R.counts, e.type);
      switch (e.type) {
        case 'volley:start':
          originX = e.from.x;
          fireSimMs = s.stats.durationMs;
          break;
        case 'ball:launched':
          launchAt.set(e.ballId, s.stats.durationMs);
          ballMeta.set(e.ballId, { el: e.element, golden: e.golden, tier: e.tier, seen: false, kind: 'main' });
          break;
        case 'block:explode':
          inc(R.explodeByEl, String(e.element ?? 'none'));
          break;
        case 'lightning:chain':
          inc(R.chainByEl, String(e.element ?? 'lightning'));
          break;
        case 'ball:split':
          inc(R.splitByEl, String(e.element ?? 'none'));
          break;
        case 'player:healed':
          inc(R.healBySource, String(e.source ?? 'none'));
          break;
        case 'block:destroyed':
          inc(R.destroyedByEl, e.element);
          if (e.element === 'gold') {
            F.goldDestroyed++;
            destroyedPos.push({ x: e.pos.x, y: e.pos.y });
          }
          break;
        case 'block:hit': {
          inc(R.hitsByEl, e.element);
          inc(R.damageByEl, e.element, e.damage);
          if (e.element === o.focus) {
            F.hits++;
            if (e.crit) F.critHits++;
            if (e.crit && e.combo < cfg.balls.comboMilestones[0]) F.critLowCombo++;
            if (o.focus === 'pierce') F.pierceHits++;
            if (o.focus === 'void') {
              const m = ballMeta.get(e.ballId);
              const maxHp = prevMaxHp.get(e.blockId);
              if (m && !m.golden && maxHp !== undefined) {
                const bc = cfg.balls;
                const c = e.combo;
                const base = 10 * Math.pow(bc.tierDamageMultiplier, m.tier - 1) * (1 + bc.comboDamagePerBounce * Math.min(c, bc.comboSoftCap) + bc.comboDamagePerBounceAfterCap * Math.max(0, c - bc.comboSoftCap));
                const pct = (cfg.balls.defs.find((d) => d.id === 'void')?.params?.['pctMaxHp']?.[m.tier - 1] ?? 0) / 100;
                const bonus = pct * maxHp;
                if (bonus >= 2) {
                  F.voidSamples++;
                  if (Math.abs(e.damage - Math.max(1, Math.round(base + bonus))) <= 1) F.voidMatch++;
                  if (Math.abs(e.damage - Math.max(1, Math.round(base))) <= 1) F.voidNoBonus++;
                }
              }
            }
          }
          break;
        }
        case 'ball:bounce': {
          const m = ballMeta.get(e.ballId);
          const cur = bounceCount.get(e.ballId);
          bounceCount.set(e.ballId, { n: (cur?.n ?? 0) + 1, nx: e.normal.x, ny: e.normal.y, surface: e.surface });
          if (m && m.el === o.focus) {
            if (e.combo > F.comboMax) F.comboMax = e.combo;
            if (e.surface === 'block' && o.focus === 'pierce') F.pierceBlockBounces++;
            if (e.normal.x === 0 && e.normal.y === -1 && e.pos.y >= ROWS - 1e-6) F.groundBounces++;
            if (e.surface === 'wall' && e.normal.y === 1) F.ceilingBounces++;
          }
          break;
        }
        case 'ball:grounded': {
          const m = ballMeta.get(e.ballId);
          if (m && m.el === o.focus && m.kind === 'main') {
            F.groundedTotal++;
            const fl = s.stats.durationMs - (launchAt.get(e.ballId) ?? s.stats.durationMs);
            const tk = String(m.tier);
            if (fl > (F.flightMsMaxByTier[tk] ?? 0)) F.flightMsMaxByTier[tk] = fl;
            if (o.focus === 'boomerang' && fl < 1500) F.groundedBeforeMs++;
            if (Math.abs(e.pos.x - originX) < 1e-3) F.groundedAtOrigin++;
          }
          break;
        }
        case 'drop:collected': {
          if (phaseBefore === 'firing' || s.phase === 'firing') {
            F.dropsCollectedInFlight++;
            let minAll = Infinity;
            let minFocus = Infinity;
            for (const b of s.balls) {
              if (!b.alive) continue;
              const d = Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y) - b.radius;
              if (d < minAll) minAll = d;
              if (b.element === o.focus && d < minFocus) minFocus = d;
            }
            // contact direct : distance centre-à-centre < DROP_R + rayon ; marge de mouvement d'un pas (≤ 0,3 u)
            if (minAll > DROP_R + 0.3 && Number.isFinite(minFocus)) {
              F.magnetRemote++;
              if (minAll > F.magnetRemoteMaxDist) F.magnetRemoteMaxDist = minAll;
            }
          }
          break;
        }
        case 'drop:spawned':
          for (const p of destroyedPos) if (Math.hypot(p.x - e.pos.x, p.y - e.pos.y) < 0.6) {
            if (e.kind === 'coin') F.goldCoin++;
            else if (e.kind === 'ball') F.goldBall++;
            break;
          }
          break;
        case 'volley:end':
          for (const b of s.blocks) if ((b.acidCharges ?? 0) > 0) F.acidAliveAtEnd++;
          R.shots++;
          R.shotDamage.push(e.shotDamage);
          checkInvariants();
          break;
        default:
          break;
      }
    }
    // --- état après le pas ---
    let live = 0;
    for (const b of s.balls) {
      if (!b.alive) continue;
      live++;
      const kind = b.kind ?? 'main';
      const key = `${b.id}:${kind}:${b.element}`;
      if (!kindSeen.has(key)) {
        kindSeen.add(key);
        inc(R.kinds, kind);
      }
      let m = ballMeta.get(b.id);
      if (!m) {
        m = { el: b.element, golden: b.golden, tier: b.tier, seen: false, kind };
        ballMeta.set(b.id, m);
      }
      m.kind = kind;
      if (!Number.isFinite(b.pos.x) || !Number.isFinite(b.pos.y) || b.pos.x < -0.5 || b.pos.x > COLS + 0.5 || b.pos.y < -0.5 || b.pos.y > ROWS + 0.5) {
        violate(`balle ${b.id} (${b.element}) hors plateau (${b.pos.x.toFixed(2)}, ${b.pos.y.toFixed(2)})`);
      }
      if (b.element === o.focus && kind === 'main') {
        if (b.radius < F.radiusMin) F.radiusMin = b.radius;
        if (b.radius > F.radiusMax) F.radiusMax = b.radius;
        if (!m.seen) {
          m.seen = true;
          const r = Math.hypot(b.vel.x, b.vel.y) / SPEED;
          if (r < F.speedRatioMin) F.speedRatioMin = r;
          if (r > F.speedRatioMax) F.speedRatioMax = r;
        }
      }
      // déviation après un rebond unique dans le pas (réflexion pure attendue sauf traqueuse / angle mini)
      const pv = prevVel.get(b.id);
      const bc = bounceCount.get(b.id);
      if (pv && bc && bc.n === 1 && kind === 'main' && s.recallSpeed <= 1) {
        const dot = pv.x * bc.nx + pv.y * bc.ny;
        const rx = pv.x - 2 * dot * bc.nx;
        const ry = pv.y - 2 * dot * bc.ny;
        const dev = vecDevDeg(rx, ry, b.vel.x, b.vel.y);
        R.devSamples++;
        if (dev > 2) R.devOver2++;
        if (b.element === 'homing') {
          F.homingSamples++;
          if (dev > 2) F.homingDeviated++;
          if (dev > F.homingMaxDevDeg) F.homingMaxDevDeg = dev;
          const tk = String(b.tier);
          if (dev > (F.homingMaxDevByTier[tk] ?? 0)) F.homingMaxDevByTier[tk] = dev;
          const maxDeg = cfg.balls.defs.find((d) => d.id === 'homing')?.params?.['maxDeg']?.[b.tier - 1] ?? 0;
          if (dev > maxDeg + 0.5 && F.homingOverMax.length < 12) {
            F.homingOverMax.push({ tier: b.tier, dev: Math.round(dev * 10) / 10, angleFromHorizDeg: Math.round((Math.atan2(Math.abs(b.vel.y), Math.abs(b.vel.x)) * 1800) / Math.PI) / 10 });
          }
        }
      }
      prevVel.set(b.id, { x: b.vel.x, y: b.vel.y });
    }
    if (live > R.maxLive) R.maxLive = live;
    for (const b of s.blocks) {
      const pr = prevRow.get(b.id);
      if (pr !== undefined && b.row < pr) F.rowUp++;
      prevRow.set(b.id, b.row);
      const pm = prevMaxHp.get(b.id);
      if (pm !== undefined && b.maxHp < pm) F.maxHpDrop++;
      prevMaxHp.set(b.id, b.maxHp);
      const ac = b.acidCharges ?? 0;
      if (ac > F.acidMax) F.acidMax = ac;
      if (ac > 0 && !acidSeen.has(b.id)) {
        acidSeen.add(b.id);
        F.acidBlocks++;
      }
    }
    // capture en vol : à partir du 2e tir, critère par élément
    if (capturePending && !paused && s.phase === 'firing' && shotIdx >= 2) {
      const since = s.stats.durationMs - fireSimMs;
      let alive = 0;
      let special = false;
      for (const b of s.balls) {
        if (!b.alive) continue;
        alive++;
        if ((o.focus === 'echo' && b.kind === 'echo') || ((o.focus === 'crystal' || o.focus === 'swarm') && b.kind === 'mini')) special = true;
      }
      const want = o.focus === 'echo' || o.focus === 'crystal' || o.focus === 'swarm' ? special && since > 150 : o.focus === 'boomerang' ? since > 1700 : since > 450;
      if (want && alive >= 1) {
        paused = true;
        capturePending = false;
        api.setSpeed(0.1);
      }
    }
    return evs;
  };

  const choose = (): void => {
    const s = sim.state;
    const offer = s.rewardOffer ?? [];
    const i = offer.findIndex((x) => x.kind !== 'relic');
    if (i >= 0) sim.chooseReward(i);
    else sim.skipReward();
  };
  const fire = (): void => {
    const s = sim.state;
    const v = s.volley as { element: BallElement; tier: number }[];
    v.length = 0;
    for (let i = 0; i < o.tiers.length; i++) v.push({ element: o.elements[i % o.elements.length] as BallElement, tier: o.tiers[i] as number });
    if (o.wound && s.maxHp > 3) (s as { hp: number }).hp = s.maxHp - 3;
    if (o.beef) for (const b of s.blocks) if (b.kind !== 'peg' && b.kind !== 'boss' && b.maxHp < o.beef) (b as { hp: number; maxHp: number }).maxHp = (b as { hp: number }).hp = o.beef;
    let best: { col: number; row: number; width: number } | null = null;
    for (const b of s.blocks) if (b.kind !== 'peg' && (!best || b.row > best.row || (b.row === best.row && b.col < best.col))) best = b;
    const tx = best ? best.col + best.width / 2 + 0.3 * ((shotIdx % 3) - 1) : s.launchPos.x + 0.5;
    const ty = best ? best.row + 0.5 : 1;
    let dx = tx - s.launchPos.x;
    let dy = ty - s.launchPos.y;
    if (dy > -0.3) dy = -0.3;
    const l = Math.hypot(dx, dy);
    dx /= l;
    dy /= l;
    sim.aim({ x: dx, y: dy }, 0);
    const q = (s as unknown as { internal?: { acidQ?: number[] } }).internal?.acidQ;
    if (Array.isArray(q)) F.acidQAtFire += q.length / 4;
    const charged = new Map<number, number>();
    for (const b of s.blocks) if ((b.acidCharges ?? 0) > 0) charged.set(b.id, b.hp);
    sim.fire();
    F.acidChargedAtFire += charged.size;
    for (const [id, hp0] of charged) {
      const b = s.blocks.find((x) => x.id === id);
      const lost = hp0 - (b ? b.hp : 0);
      if (lost > 0) {
        F.acidTickBlocks++;
        F.acidTickDamage += lost;
      }
    }
    shotIdx++;
  };

  let finish: (r: BallsReport) => void = () => undefined;
  const done = new Promise<BallsReport>((res) => {
    finish = res;
  });
  const end = (why: string): void => {
    if (R.done) return;
    const s = sim.state;
    checkInvariants();
    R.done = why;
    R.wave = s.wave;
    R.depth = s.depth;
    R.hp = s.hp;
    R.maxHp = s.maxHp;
    R.simMs = s.stats.durationMs;
    R.pageErrors = api.errors.slice(errStart);
    if (!Number.isFinite(F.radiusMin)) F.radiusMin = 0;
    if (!Number.isFinite(F.speedRatioMin)) F.speedRatioMin = 0;
    finish(R);
  };
  const t0 = performance.now();
  const loop = (): void => {
    if (R.done) return;
    const s = sim.state;
    const pc = api.renderer.particleCount;
    if (pc > R.maxParticles) R.maxParticles = pc;
    if (performance.now() - t0 > 100_000) end('timeout');
    else if (paused) {
      /* attente de la capture */
    } else if (s.phase === 'aiming') {
      if (R.shots >= o.shots) end('shots');
      else fire();
    } else if (s.phase === 'reward') choose();
    else if (s.phase === 'shop') sim.leaveShop();
    else if (s.phase === 'gameover') {
      sim.giveUp();
      end('gameover');
    }
    requestAnimationFrame(loop);
  };
  api.setSpeed(o.speed);
  requestAnimationFrame(loop);
  w.__bt = {
    done,
    isPaused: () => paused,
    resume: () => {
      paused = false;
      R.captured = true;
      api.setSpeed(o.speed);
    },
    report: () => R,
  };
}

type BtWindow = QaWindow & { __bt: { done: Promise<BallsReport>; isPaused(): boolean; resume(): void; report(): BallsReport } };

async function runBalls(page: Page, opts: BallsOpts, shotPath: string | null): Promise<BallsReport> {
  await page.evaluate(ballsInstall, opts);
  const doneP = page.evaluate(() => (window as unknown as BtWindow).__bt.done);
  if (shotPath) {
    // attend la pause de capture (ou la fin de la run)
    const paused = await page
      .waitForFunction(() => (window as unknown as BtWindow).__bt.isPaused() || !!(window as unknown as BtWindow).__bt.report().done, null, { timeout: 90_000 })
      .then(() => page.evaluate(() => (window as unknown as BtWindow).__bt.isPaused()));
    if (paused) {
      await page.waitForTimeout(120);
      await page.screenshot({ path: shotPath });
      await page.evaluate(() => (window as unknown as BtWindow).__bt.resume());
    }
  }
  return doneP;
}

interface Signal {
  /** signal observable attendu (texte du rapport) */
  what: string;
  ok(r: BallsReport): boolean;
  /** valeur mesurée (texte) */
  measured(r: BallsReport): string;
}

const SIGNALS: Record<string, Signal> = {
  acid: {
    what: 'bloc avec acidCharges > 0, puis PV perdus au début du tir suivant',
    ok: (r) => r.focus.acidMax > 0,
    measured: (r) => `${r.focus.acidBlocks} blocs chargés (max ${r.focus.acidMax}), ${r.focus.acidAliveAtEnd} encore chargés en fin de tir ; au tir suivant : ${r.focus.acidChargedAtFire} chargés, acidQ ${r.focus.acidQAtFire}, ${r.focus.acidTickBlocks} mordus, ${r.focus.acidTickDamage} PV`,
  },
  magnet: { what: 'drop:collected en vol sans contact direct (distance > 0,25 + rayon + 0,3)', ok: (r) => r.focus.magnetRemote > 0, measured: (r) => `${r.focus.magnetRemote}/${r.focus.dropsCollectedInFlight} ramassés à distance, max ${r.focus.magnetRemoteMaxDist.toFixed(2)} u` },
  pierce: { what: 'block:hit sans rebond (impacts > rebonds sur bloc)', ok: (r) => r.focus.pierceHits > r.focus.pierceBlockBounces, measured: (r) => `${r.focus.pierceHits} impacts / ${r.focus.pierceBlockBounces} rebonds bloc` },
  bomb: { what: "block:explode element 'bomb'", ok: (r) => (r.explodeByEl['bomb'] ?? 0) > 0, measured: (r) => `${r.explodeByEl['bomb'] ?? 0} explosions` },
  homing: { what: 'vitesse après rebond ≠ réflexion pure (> 2°)', ok: (r) => r.focus.homingDeviated >= 3, measured: (r) => `${r.focus.homingDeviated}/${r.focus.homingSamples} rebonds déviés, max par rang ${JSON.stringify(Object.fromEntries(Object.entries(r.focus.homingMaxDevByTier).map(([k, v]) => [k, Math.round(v * 10) / 10])))}°` },
  giant: { what: 'Ball.radius > 0,2', ok: (r) => r.focus.radiusMin > 0.2, measured: (r) => `rayon ${r.focus.radiusMin.toFixed(3)}..${r.focus.radiusMax.toFixed(3)} ; vitesse ×${r.focus.speedRatioMin.toFixed(2)}` },
  swarm: { what: "ball:split element 'swarm' + Ball.kind 'mini'", ok: (r) => (r.splitByEl['swarm'] ?? 0) > 0 && (r.kinds['mini'] ?? 0) > 0, measured: (r) => `${r.splitByEl['swarm'] ?? 0} splits, ${r.kinds['mini'] ?? 0} mini` },
  vampire: { what: "player:healed source 'vampire' (PV forcés à max − 3)", ok: (r) => (r.healBySource['vampire'] ?? 0) > 0, measured: (r) => `${r.healBySource['vampire'] ?? 0} soins vampire` },
  gold: { what: 'drop:spawned coin au point de chaque bloc détruit par l\'or', ok: (r) => r.focus.goldCoin > 0 && r.focus.goldCoin + r.focus.goldBall >= r.focus.goldDestroyed, measured: (r) => `${r.focus.goldCoin} pièces + ${r.focus.goldBall} balles garanties / ${r.focus.goldDestroyed} blocs détruits` },
  prism: { what: "lightning:chain element 'prism'", ok: (r) => (r.chainByEl['prism'] ?? 0) > 0, measured: (r) => `${r.chainByEl['prism'] ?? 0} rayons` },
  void: { what: 'dégâts = base × combo + pctMaxHp × maxHp (bonus ≥ 2)', ok: (r) => r.focus.voidMatch > 0 && r.focus.voidMatch >= r.focus.voidNoBonus, measured: (r) => `${r.focus.voidMatch}/${r.focus.voidSamples} impacts conformes (${r.focus.voidNoBonus} sans bonus)` },
  echo: { what: "Ball.kind 'echo' en vol", ok: (r) => (r.kinds['echo'] ?? 0) > 0, measured: (r) => `${r.kinds['echo'] ?? 0} échos` },
  boomerang: { what: 'ball:bounce normale (0,−1) au sol (rangs II/III) + retour au lanceur (rang I)', ok: (r) => r.focus.groundBounces > 0 && r.focus.groundedAtOrigin > 0, measured: (r) => `${r.focus.groundBounces} rebonds sol, ${r.focus.groundedAtOrigin}/${r.focus.groundedTotal} posées au lanceur, ${r.focus.groundedBeforeMs} au sol avant 1,5 s` },
  crystal: { what: "ball:split element 'crystal' + éclats Ball.kind 'mini'", ok: (r) => (r.splitByEl['crystal'] ?? 0) > 0 && (r.kinds['mini'] ?? 0) > 0, measured: (r) => `${r.splitByEl['crystal'] ?? 0} éclatements, ${r.kinds['mini'] ?? 0} éclats` },
  shock: { what: 'un bloc dont row diminue', ok: (r) => r.focus.rowUp > 0, measured: (r) => `${r.focus.rowUp} reculs` },
  twin: { what: "ball:split element 'twin' + Ball.kind 'mini'", ok: (r) => (r.splitByEl['twin'] ?? 0) > 0 && (r.kinds['mini'] ?? 0) > 0, measured: (r) => `${r.splitByEl['twin'] ?? 0} dédoublements, ${r.kinds['mini'] ?? 0} jumelles` },
  rust: { what: 'maxHp d\'un bloc qui diminue', ok: (r) => r.focus.maxHpDrop > 0, measured: (r) => `${r.focus.maxHpDrop} blocs rouillés` },
  nova: { what: "block:explode element 'nova'", ok: (r) => (r.explodeByEl['nova'] ?? 0) > 0, measured: (r) => `${r.explodeByEl['nova'] ?? 0} novas` },
  comet: { what: 'vitesse au lancement > ballSpeed', ok: (r) => r.focus.speedRatioMin > 1.05, measured: (r) => `vitesse ×${r.focus.speedRatioMin.toFixed(2)}..×${r.focus.speedRatioMax.toFixed(2)}, ${r.focus.ceilingBounces} rebonds plafond, combo max ${r.focus.comboMax}` },
  lucky: { what: 'block:hit.crit avec combo < 3 (critique propre à la chance)', ok: (r) => r.focus.critLowCombo > 0, measured: (r) => `${r.focus.critLowCombo}/${r.focus.hits} impacts critiques hors combo` },
};

test.describe.configure({ mode: 'parallel' });

for (const el of NEW) {
  test(`balle ${el} : mécanique observable, 0 erreur, 0 NaN`, async ({ page }) => {
    test.setTimeout(150_000);
    mkdirSync(SHOTS_DIR, { recursive: true });
    mkdirSync(DATA_DIR, { recursive: true });
    const consoleErrors = watchErrors(page);
    await page.goto(`/?seed=balls-${el}&qa=1`);
    await waitReady(page);
    const r = await runBalls(page, { elements: [el], tiers: TIERS, shots: SHOTS, speed: 8, wound: el === 'vampire', focus: el, capture: true }, `${SHOTS_DIR}/${el}.png`);
    const sig = SIGNALS[el] as Signal;
    // run de référence à graine commune (comparaison des dégâts entre balles, même plateau)
    const ref = await refRun(page, el);
    // acide : en vague 1-2 les blocs chargés meurent dans le même tir (charges perdues) ; run mécanique à blocs de
    // 200 PV (`beef`) pour vérifier la morsure de début de tir : min(pctPerTurn % × 200, capPerTurn) par charge.
    let mech: BallsReport | null = null;
    if (el === 'acid') {
      await page.goto(`/?seed=balls-${el}-beef&qa=1`);
      await waitReady(page);
      mech = await runBalls(page, { elements: [el], tiers: [1, 1, 1, 1, 1], shots: 4, speed: 8, wound: false, focus: el, capture: false, beef: 200 }, null);
    }
    const ok = el === 'acid' ? r.focus.acidMax > 0 && !!mech && mech.focus.acidTickDamage > 0 : sig.ok(r);
    const mechTxt = mech ? ` | blocs 200 PV : ${mech.focus.acidTickBlocks} blocs mordus, ${mech.focus.acidTickDamage} PV (${(mech.focus.acidTickDamage / Math.max(1, mech.focus.acidTickBlocks)).toFixed(1)} PV/bloc/tir)` : '';
    const out = { element: el, seed: `balls-${el}`, signal: sig.what, measured: sig.measured(r) + mechTxt, ok, consoleErrors, ref, mech: mech ? { seed: `balls-${el}-beef`, beef: 200, focus: mech.focus, errors: [...mech.pageErrors, ...mech.violations, ...mech.nan] } : null, report: r };
    writeFileSync(`${DATA_DIR}/${el}.json`, JSON.stringify(out, null, 2) + '\n');
    test.info().annotations.push({ type: el, description: `${sig.what} → ${out.measured}` });
    expect(r.done, 'run arrêtée après 6 tirs').toBe('shots');
    expect(r.shots).toBe(SHOTS);
    expect(r.nan, 'aucun NaN dans state').toEqual([]);
    expect(r.violations, 'invariants').toEqual([]);
    expect(r.pageErrors, '__pegbreaker.errors').toEqual([]);
    expect(consoleErrors, 'erreurs console').toEqual([]);
    expect(r.maxParticles, 'particules ≤ 1024').toBeLessThanOrEqual(1024);
    expect(r.maxLive, 'balles vivantes ≤ maxLiveBalls').toBeLessThanOrEqual(30);
    expect(r.captured, 'capture en vol').toBe(true);
    expect(ok, `signal ${el} : ${sig.what} (mesuré : ${out.measured})`).toBe(true);
    if (out.mech) expect(out.mech.errors, 'run mécanique : erreurs').toEqual([]);
    expect(ref.errors, `run de référence ${el} : erreurs`).toEqual([]);
  });
}

const REF_SEEDS = ['balls-ref-1', 'balls-ref-2', 'balls-ref-3'];
interface RefOne { seed: string; shots: number; damage: number; destroyed: number; wave: number; coins: number; explode: Record<string, number>; chain: Record<string, number>; split: Record<string, number>; heal: Record<string, number>; acidMax: number; rowUp: number; maxHpDrop: number }
interface RefResult { runs: RefOne[]; damage: number; destroyed: number; coins: number; errors: string[]; nan: string[] }

/** 6 tirs × 3 graines communes avec 5 balles de `el` (rangs I, I, I, II, III), sans capture ni blessure. */
async function refRun(page: Page, el: BallElement): Promise<RefResult> {
  const res: RefResult = { runs: [], damage: 0, destroyed: 0, coins: 0, errors: [], nan: [] };
  for (const seed of REF_SEEDS) {
    await page.goto(`/?seed=${seed}&qa=1`);
    await waitReady(page);
    const r = await runBalls(page, { elements: [el], tiers: TIERS, shots: SHOTS, speed: 8, wound: false, focus: el, capture: false }, null);
    const coins = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.stats.coinsEarned);
    const one: RefOne = {
      seed, shots: r.shots, damage: r.shotDamage.reduce((a, b) => a + b, 0), destroyed: Object.values(r.destroyedByEl).reduce((a, b) => a + b, 0), wave: r.wave, coins,
      explode: r.explodeByEl, chain: r.chainByEl, split: r.splitByEl, heal: r.healBySource, acidMax: r.focus.acidMax, rowUp: r.focus.rowUp, maxHpDrop: r.focus.maxHpDrop,
    };
    res.runs.push(one);
    res.damage += one.damage;
    res.destroyed += one.destroyed;
    res.coins += coins;
    res.errors.push(...r.pageErrors, ...r.violations);
    res.nan.push(...r.nan);
    if (r.shots !== SHOTS) res.errors.push(`${seed} : ${r.shots} tirs (${r.done})`);
  }
  return res;
}

test('référence : les 7 balles d\'origine sur la graine commune', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(DATA_DIR, { recursive: true });
  const consoleErrors = watchErrors(page);
  const out: Record<string, RefResult> = {};
  for (const el of ['stone', 'fire', 'lightning', 'ice', 'ghost', 'lead', 'split'] as BallElement[]) out[el] = await refRun(page, el);
  writeFileSync(`${DATA_DIR}/ref-originals.json`, JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'ref', description: JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.damage]))) });
  for (const [el, v] of Object.entries(out)) {
    expect(v.errors, el).toEqual([]);
    expect(v.nan, el).toEqual([]);
  }
  expect(consoleErrors).toEqual([]);
});

const ORIGINAL: BallElement[] = ['stone', 'fire', 'lightning', 'ice', 'ghost', 'lead', 'split'];
const PERF_MIXES: { key: string; label: string; mix: BallElement[]; assertFps: boolean }[] = [
  // les 20 nouvelles puis 10 de plus (bombe, prisme, nova, essaim, cristal, jumelle, écho, foudre, feu, scission)
  { key: 'perf', label: 'nouvelles familles', mix: [...NEW, 'bomb', 'prism', 'nova', 'swarm', 'crystal', 'twin', 'echo', 'lightning', 'fire', 'split'], assertFps: true },
  // contrôle : même protocole, 30 balles des 7 éléments d'origine (référence avant les 20 nouvelles)
  { key: 'perf-control', label: "7 éléments d'origine (contrôle)", mix: Array.from({ length: 30 }, (_, i) => ORIGINAL[i % ORIGINAL.length] as BallElement), assertFps: false },
];
for (const pm of PERF_MIXES) test(`perf : 30 balles, ${pm.label}, CPU 4×, 720×1280 DPR 1,5`, async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const consoleErrors = watchErrors(page);
  await page.goto('/?seed=balls-perf&qa=1');
  await waitReady(page);
  const mix = pm.mix;
  const tiers = mix.map(() => 1);
  await page.waitForTimeout(1000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // échantillons fps (moyenne glissante 1 s) et durées de frame rAF pendant 'firing'
  await page.evaluate(() => {
    const w = window as unknown as QaWindow & { __perf: { fps: number[]; frames: number[]; particles: number; dpr: number[]; slow: { sinceFireMs: number; dt: number; live: number }[] } };
    const api = w.__pegbreaker;
    w.__perf = { fps: [], frames: [], particles: 0, dpr: [], slow: [] };
    let fireAt = performance.now();
    api.bus.onAny((e) => {
      if (e.type === 'volley:start') fireAt = performance.now();
    });
    let last = performance.now();
    let lastSample = last;
    const f = (now: number): void => {
      const st = api.sim.state;
      if (st.phase === 'firing') {
        w.__perf.frames.push(now - last);
        if (now - last > 40 && w.__perf.slow.length < 40) {
          let live = 0;
          for (const b of st.balls) if (b.alive) live++;
          w.__perf.slow.push({ sinceFireMs: Math.round(now - fireAt), dt: Math.round(now - last), live });
        }
        if (now - lastSample >= 1000) {
          w.__perf.fps.push(api.fps);
          w.__perf.dpr.push(api.renderer.dpr);
          lastSample = now;
        }
      } else lastSample = now;
      if (api.renderer.particleCount > w.__perf.particles) w.__perf.particles = api.renderer.particleCount;
      last = now;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  // vitesse 1 : 3 tirs de 30 balles (perf réelle, pas de vitesse QA)
  const r = await runBalls(page, { elements: mix, tiers, shots: 3, speed: 1, wound: false, focus: 'bomb', capture: false }, null);
  await page.screenshot({ path: `${SHOTS_DIR}/zz-${pm.key}-fin.png` });
  const perf = await page.evaluate(() => (window as unknown as QaWindow & { __perf: { fps: number[]; frames: number[]; particles: number; dpr: number[]; slow: { sinceFireMs: number; dt: number; live: number }[] } }).__perf);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const sorted = [...perf.frames].sort((a, b) => a - b);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] ?? NaN;
  // la 1re seconde mesurée chevauche le lancement : on garde tous les échantillons (min honnête)
  const out = {
    viewport: '720×1280', deviceScaleFactor: 1.5, cpuThrottle: 4, mix, shots: r.shots,
    fpsSamples: perf.fps, fpsMin: Math.min(...perf.fps), fpsMean: perf.fps.reduce((a, b) => a + b, 0) / Math.max(1, perf.fps.length),
    frameP50: q(0.5), frameP95: q(0.95), frameP99: q(0.99), frameMax: sorted[sorted.length - 1] ?? NaN, frames: sorted.length,
    slowFrames: perf.slow, rendererDpr: perf.dpr, maxParticles: Math.max(perf.particles, r.maxParticles), maxLive: r.maxLive,
    explodeByEl: r.explodeByEl, splitByEl: r.splitByEl, kinds: r.kinds, nan: r.nan, violations: r.violations,
    note: 'mesure valable seulement si le test tourne seul (npx playwright test balls -g perf --workers=1) ; en suite parallèle le CPU est partagé',
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${DATA_DIR}/${pm.key}.json`, JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: pm.key, description: JSON.stringify(out) });
  expect(r.shots).toBe(3);
  expect(r.nan).toEqual([]);
  expect(r.pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(out.maxParticles, 'particules ≤ 1024').toBeLessThanOrEqual(1024);
  // fps : significatif seulement en exécution isolée (CPU partagé par les workers sinon) :
  //   npx playwright test balls -g perf --workers=1
  const isolated = testInfo.config.workers === 1;
  test.info().annotations.push({ type: 'fps', description: isolated ? 'assertion stricte (isolé)' : `non asserté : ${testInfo.config.workers} workers en parallèle` });
  if (pm.assertFps && isolated) expect(out.fpsMin, 'fps min ≥ 50 (CPU 4×, DPR 1,5, 30 balles)').toBeGreaterThanOrEqual(50);
  await ctx.close();
});
