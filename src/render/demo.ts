// render/demo.ts — démo autonome du renderer, sans la sim : RunState factice, mini-physique
// locale (5 balles), événements synthétiques sur un vrai EventBus.
// Lot 1 : éventail de visée (aimSpread oscillant), balle dorée (dernière de la volée), combos sur
// balle (combos de départ échelonnés), contrat réussi (1 tir sur 3), défaite → seconde chance
// (1 tir sur 4 : voile, puis 3 rangées du bas effacées avec éclats).
// Usage : const stop = mountRenderDemo(canvas); ... stop();
import { createEventBus, type EventBus } from '../core/events';
import { loadConfig } from '../core/config';
import type { Ball, BallElement, Block, BlockKind, ContractDef, Drop, GameEvent, RunState } from '../core/types';
import { createRenderer, type PegRenderer } from './index';
import { ELEMENTS } from './palette';
export { mountBallGallery } from './gallery';

/** jeu « forge » (?set=forge) : les 13 hybrides ×2, 2 Divines, + vapeur et missile (30 balles) */
const HYBRIDS: readonly BallElement[] = ['steam', 'laser', 'cluster', 'wraith', 'abyss', 'jackpot', 'quake', 'missile', 'supernova', 'plague', 'choir', 'orbit', 'hammer'];
const FORGE_SET: readonly BallElement[] = [...HYBRIDS, 'divine', ...HYBRIDS, 'divine', 'steam', 'missile'];
/** recettes jouées par la démo de forge (shop:forged) */
const FORGE_DEMO: readonly [BallElement, BallElement, BallElement][] = [
  ['steam', 'fire', 'ice'], ['laser', 'lightning', 'prism'], ['supernova', 'crystal', 'nova'], ['divine', 'steam', 'missile'],
];
/** au-delà d'une balle par élément : mini-balles (essaim, éclats de cristal, jumelles), rayon × 0,6 */
const MINIS: readonly BallElement[] = ['swarm', 'crystal', 'twin'];
const MINI_RADIUS = 0.6;

export interface RenderDemoOptions {
  /** nombre de balles de la volée (défaut : une par élément, 27) ; au-delà, des mini-balles */
  balls?: number;
  /** 'forge' : volée d'hybrides + 2 Divines, événements hybrides synthétiques, forge à chaque visée */
  set?: 'base' | 'forge';
  /** accès de debug (captures QA) : bus et état factice */
  debug?: (api: { bus: EventBus; state: RunState; renderer: PegRenderer }) => void;
}

export function mountRenderDemo(canvas: HTMLCanvasElement, opts: RenderDemoOptions = {}): () => void {
  const forgeSet = opts.set === 'forge';
  const noDiv = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nodiv') === '1';
  const ELEMS: readonly BallElement[] = forgeSet ? (noDiv ? FORGE_SET.map((e) => (e === 'divine' ? 'stone' : e)) : FORGE_SET) : ELEMENTS.filter((e) => e !== 'divine' && !HYBRIDS.includes(e));
  const nBalls = opts.balls ?? ELEMS.length;
  const config = loadConfig();
  const { cols, rows, ballRadius: R } = config.blocks.board;
  const bus = createEventBus();
  const renderer = createRenderer(canvas, bus, config);

  let nextId = 1;
  const mkBlock = (kind: BlockKind, col: number, row: number, hp: number, extra?: Partial<Block>): Block => ({
    id: nextId++, kind, col, row, width: 1, hp, maxHp: hp, frozen: false, armorSide: kind === 'armored' ? 'down' : 'none', bossId: null, ...extra,
  });
  const blocks: Block[] = [
    mkBlock('boss', 2, 0, 1520, { width: 3, bossId: 'regen' }),
    mkBlock('normal', 0, 2, 12), mkBlock('armored', 1, 2, 24), mkBlock('explosive', 3, 2, 8),
    mkBlock('heart', 5, 2, 6), mkBlock('normal', 6, 2, 1234),
    mkBlock('peg', 2, 3, 1), mkBlock('peg', 4, 3, 1),
    mkBlock('normal', 0, 4, 9, { frozen: true }), mkBlock('normal', 3, 4, 31), mkBlock('normal', 6, 4, 5),
    mkBlock('explosive', 1, 5, 4), mkBlock('normal', 5, 5, 17, { acidCharges: 2 }),
  ];
  const drops: Drop[] = [
    { id: 1, kind: 'coin', pos: { x: 1.5, y: 6.5 }, value: 3, element: null },
    { id: 2, kind: 'ball', pos: { x: 3.5, y: 6.5 }, value: 1, element: 'fire' },
    { id: 3, kind: 'fragment', pos: { x: 5.5, y: 6.5 }, value: 1, element: null },
    { id: 4, kind: 'heart', pos: { x: 4.5, y: 7.5 }, value: 1, element: null },
  ];
  const balls: Ball[] = [];
  const giantMult = config.balls.defs.find((d) => d.id === 'giant')?.params?.radiusMult ?? [1.8, 2.1, 2.4];
  const crystalBounces = config.balls.defs.find((d) => d.id === 'crystal')?.params?.bounces?.[0] ?? 8;
  const radiusOf = (b: Ball, i: number): number =>
    i >= ELEMS.length ? R * MINI_RADIUS : b.element === 'giant' ? R * (giantMult[b.tier - 1] ?? 1.8) : b.element === 'divine' ? R * 1.3 : R;
  for (let i = 0; i < nBalls; i++) {
    const mini = i >= ELEMS.length;
    const element = mini ? MINIS[(i - ELEMS.length) % MINIS.length] ?? 'swarm' : ELEMS[i] ?? 'stone';
    // rangs mélangés : on voit les anneaux II / III sur toutes les familles
    const tier = (mini ? 1 : (i % 3) + 1) as 1 | 2 | 3;
    const b: Ball = { id: 100 + i, element, tier, pos: { x: 3.5, y: rows - R }, vel: { x: 0, y: 0 }, radius: R, combo: 0, alive: false, triggered: false, golden: false, kind: mini ? 'mini' : 'main' };
    b.radius = radiusOf(b, i);
    balls.push(b);
  }
  /** rebonds par balle (cristal) et échos déjà relancés */
  const bounces = new Map<number, number>();

  const state: RunState = {
    seed: 'demo', phase: 'aiming', wave: 1, shotInWave: 0, rowsLeftInWave: 3, depth: 0,
    hp: 5, maxHp: 5, coins: 0,
    volley: balls.map((b) => ({ element: b.element, tier: b.tier })),
    balls, blocks, drops, relics: [],
    launchPos: { x: 3.5, y: rows - R }, aimDir: { x: 0.3, y: -1 }, aimSpread: 0, contract: null, revivesUsed: 0,
    currentShotDamage: 0, currentShotCombo: 0, rewardOffer: null, shop: null,
    pendingLaunches: 0, advanceProgress: 0,
    stats: { shots: 0, blocksDestroyed: 0, bestCombo: 0, bestShotDamage: 0, totalDamage: 0, coinsEarned: 0, fragmentsEarned: 0, fusions: 0, bossesKilled: 0, perfectWaves: 0, contractsCompleted: 0, durationMs: 0 },
    rngState: 0, recallSpeed: 1,
  };

  const emit = (e: GameEvent): void => bus.emit(e);
  let phaseT = 0;
  let launchT = 0;
  let launched = 0;
  let milestoneT = 0;
  let milestoneLvl: 1 | 2 | 3 = 1;
  let aimAngle = 0;
  const maxSpreadRad = ((config.blocks.board.maxSpreadDeg ?? 14) * Math.PI) / 180;
  let shotBase = 0;
  let shotHalf = 0;
  const contractDef: ContractDef = {
    id: 'demo-combo', kind: 'reachCombo', target: 10, text: 'Combo {n}', reward: { kind: 'coins', amount: 10 }, minWave: 1, weight: 1,
  };
  /** blocs effacés par la seconde chance, réinjectés en haut à l'avancée suivante */
  const cleared: Block[] = [];
  bus.emit({ type: 'boss:spawned', bossId: 'regen', blockId: blocks[0]!.id });

  function respawnBlock(b: Block): void {
    // réapparaît en haut, pour que la démo tourne indéfiniment
    b.id = nextId++;
    b.row = 1;
    b.hp = b.maxHp = 5 + Math.floor(Math.random() * 40);
    b.frozen = false;
  }

  function hitBlock(ball: Ball, b: Block, nx: number, ny: number): void {
    emit({ type: 'ball:bounce', ballId: ball.id, pos: { x: ball.pos.x, y: ball.pos.y }, normal: { x: nx, y: ny }, surface: b.kind === 'peg' ? 'peg' : 'block', combo: ball.combo });
    if (b.kind === 'peg') { ball.combo++; return; }
    if (ball.element === 'ghost') return;
    ball.combo++;
    const crit = Math.random() < 0.12;
    const dmg = Math.max(1, Math.round((ball.tier * 2 + ball.combo * 0.3) * (crit ? 3 : 1)));
    b.hp = Math.max(0, b.hp - dmg);
    state.currentShotDamage += dmg * 8; // démo : fait monter la « lumière » du plateau
    emit({ type: 'block:hit', blockId: b.id, ballId: ball.id, pos: { x: ball.pos.x, y: ball.pos.y }, damage: dmg, combo: ball.combo, element: ball.element, hpLeft: b.hp, crit });
    if (ball.element === 'lightning') {
      const other = blocks[Math.floor(Math.random() * blocks.length)];
      if (other && other !== b) emit({ type: 'lightning:chain', from: { x: ball.pos.x, y: ball.pos.y }, to: { x: other.col + other.width / 2, y: other.row + 0.5 }, damage: 1 });
    }
    if (ball.element === 'ice' && !b.frozen && b.kind !== 'boss') { b.frozen = true; emit({ type: 'block:frozen', blockId: b.id, pos: { x: b.col + 0.5, y: b.row + 0.5 } }); }
    if (ball.element === 'acid' || ball.element === 'plague' || ball.element === 'abyss') b.acidCharges = Math.min(3, (b.acidCharges ?? 0) + 1);
    hybridHit(ball, b);
    if (ball.element === 'shock' && b.kind !== 'boss' && b.row > 1 && !blocks.some((o) => o !== b && o.row === b.row - 1 && o.col <= b.col && b.col < o.col + o.width)) {
      b.row--; // la sim le fait sans événement dédié : le rendu détecte la baisse de row
    }
    if (ball.element === 'crystal') {
      const n = (bounces.get(ball.id) ?? 0) + 1;
      bounces.set(ball.id, n);
      if (n >= crystalBounces) {
        bounces.set(ball.id, 0);
        emit({ type: 'ball:split', pos: { x: ball.pos.x, y: ball.pos.y }, element: 'crystal' });
      }
    }
    if (b.hp <= 0) {
      const pos = { x: b.col + b.width / 2, y: b.row + 0.5 };
      emit({ type: 'block:destroyed', blockId: b.id, kind: b.kind, pos, width: b.width, element: ball.element });
      if (b.kind === 'explosive') emit({ type: 'block:explode', pos, radius: 1.2, damage: 5, element: 'explosive' });
      if (ball.element === 'vampire') emit({ type: 'player:healed', amount: 1, hpLeft: state.hp, source: 'vampire' });
      if (ball.element === 'gold') emit({ type: 'drop:spawned', dropId: 999, kind: 'coin', pos: { x: pos.x, y: pos.y } });
      if (b.kind === 'boss') b.hp = b.maxHp = 1520;
      else respawnBlock(b);
    }
  }

  /** effets propres des hybrides et de la Divine (événements tels que la sim les émet) */
  const flightHits = new Map<number, number>();
  const qp = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const noFx = qp?.get('nofx') === '1';
  function hybridHit(ball: Ball, b: Block): void {
    if (noFx) return;
    const n = (flightHits.get(ball.id) ?? 0) + 1;
    flightHits.set(ball.id, n);
    const p = { x: ball.pos.x, y: ball.pos.y };
    switch (ball.element) {
      case 'steam': if (n === 1) emit({ type: 'block:explode', pos: p, radius: 1.2, damage: 5, element: 'steam' }); break;
      case 'laser': emit({ type: 'lightning:chain', from: { x: b.col + 0.5, y: 0.05 }, to: { x: b.col + 0.5, y: rows - 1.05 }, damage: 3, element: 'laser' }); break;
      case 'missile': if (n % 3 === 0) emit({ type: 'block:explode', pos: p, radius: 1, damage: 9, element: 'missile' }); break;
      case 'divine': emit({ type: 'block:explode', pos: p, radius: 1.5, damage: 250, element: 'divine' }); break;
      case 'quake': {
        if (n !== 1 || b.kind === 'boss' || b.row <= 1) break;
        const row = b.row;
        for (const o of blocks) {
          if (o.row !== row || o.kind === 'boss') continue;
          if (!blocks.some((q) => q.row === row - 1 && q.col < o.col + o.width && o.col < q.col + q.width)) o.row--;
        }
        break;
      }
      default:
    }
  }
  function hybridGrounded(ball: Ball): void {
    if (noFx) return;
    flightHits.delete(ball.id);
    if (ball.element === 'cluster') {
      emit({ type: 'ball:split', pos: { x: ball.pos.x, y: rows - 0.3 }, element: 'cluster' });
      for (let i = 0; i < 3; i++) emit({ type: 'block:explode', pos: { x: Math.max(0.5, Math.min(cols - 0.5, ball.pos.x + (i - 1) * 0.9)), y: rows - 1.2 - Math.random() }, radius: 0.8, damage: 5, element: 'cluster' });
    } else if (ball.element === 'divine') {
      // Jugement : rangée cassable la plus basse
      let low = -1;
      for (const o of blocks) if (o.kind !== 'boss' && o.kind !== 'peg' && o.row > low) low = o.row;
      for (const o of blocks) {
        if (o.row !== low || o.kind === 'peg' || o.kind === 'boss') continue;
        emit({ type: 'lightning:chain', from: { x: ball.pos.x, y: rows }, to: { x: o.col + o.width / 2, y: o.row + 0.5 }, damage: 1500, element: 'divine' });
      }
    }
  }

  /** prisme : rayon horizontal sur toute la rangée à chaque rebond de mur */
  function prismRay(ball: Ball): void {
    const y = Math.floor(ball.pos.y) + 0.5;
    emit({ type: 'lightning:chain', from: { x: 0.05, y }, to: { x: cols - 0.05, y }, damage: 1, element: 'prism' });
  }

  function physics(dtMs: number): void {
    const dt = dtMs / 1000;
    const sub = 4;
    const h = dt / sub;
    for (const ball of balls) {
      if (!ball.alive) continue;
      for (let s = 0; s < sub; s++) {
        ball.pos.x += ball.vel.x * h;
        ball.pos.y += ball.vel.y * h;
        if (ball.element === 'prism' && (ball.pos.x < R || ball.pos.x > cols - R)) prismRay(ball);
        if (ball.pos.x < R) { ball.pos.x = R; ball.vel.x = Math.abs(ball.vel.x); emit({ type: 'ball:bounce', ballId: ball.id, pos: { x: 0, y: ball.pos.y }, normal: { x: 1, y: 0 }, surface: 'wall', combo: ball.combo }); }
        if (ball.pos.x > cols - R) { ball.pos.x = cols - R; ball.vel.x = -Math.abs(ball.vel.x); emit({ type: 'ball:bounce', ballId: ball.id, pos: { x: cols, y: ball.pos.y }, normal: { x: -1, y: 0 }, surface: 'wall', combo: ball.combo }); }
        if (ball.pos.y < R) { ball.pos.y = R; ball.vel.y = Math.abs(ball.vel.y); emit({ type: 'ball:bounce', ballId: ball.id, pos: { x: ball.pos.x, y: 0 }, normal: { x: 0, y: 1 }, surface: 'wall', combo: ball.combo }); }
        if (ball.pos.y > rows - R) {
          ball.pos.y = rows - R;
          emit({ type: 'ball:grounded', ballId: ball.id, pos: { x: ball.pos.x, y: rows } });
          hybridGrounded(ball);
          if (ball.element === 'bomb') emit({ type: 'block:explode', pos: { x: ball.pos.x, y: rows - 0.3 }, radius: 1.4, damage: 30, element: 'bomb' });
          if (ball.element === 'echo' && !ball.triggered) {
            // copie fantôme : repart vers le haut (Ball.kind = 'echo')
            ball.triggered = true; ball.kind = 'echo'; ball.vel.y = -Math.abs(ball.vel.y); ball.pos.y = rows - R - 0.01;
            continue;
          }
          ball.alive = false; ball.combo = 0;
          break;
        }
        for (const b of blocks) {
          if (ball.element === 'ghost' && b.kind !== 'peg') continue;
          // AABB vs cercle (approx.)
          const cx = Math.max(b.col, Math.min(ball.pos.x, b.col + b.width));
          const cy = Math.max(b.row, Math.min(ball.pos.y, b.row + 1));
          const dx = ball.pos.x - cx, dy = ball.pos.y - cy;
          if (dx * dx + dy * dy >= R * R) continue;
          let nx = 0, ny = 0;
          if (Math.abs(dx) > Math.abs(dy)) nx = Math.sign(dx) || 1; else ny = Math.sign(dy) || 1;
          if (nx !== 0) { ball.vel.x = Math.abs(ball.vel.x) * nx; ball.pos.x = cx + nx * R; }
          else { ball.vel.y = Math.abs(ball.vel.y) * ny; ball.pos.y = cy + ny * R; }
          hitBlock(ball, b, nx, ny);
          break;
        }
      }
    }
  }

  function simStep(dtMs: number): void {
    phaseT += dtMs;
    // drops qui « tombent » doucement et sont ramassés en bas
    for (const d of drops) {
      if (state.phase === 'firing') d.pos.y += dtMs * 0.0004;
      if (d.pos.y > rows - 1.2) {
        emit({ type: 'drop:collected', dropId: d.id, kind: d.kind, pos: { x: d.pos.x, y: d.pos.y }, value: d.value });
        d.pos.y = 5.5 + Math.random();
        d.pos.x = 0.5 + Math.floor(Math.random() * cols);
        emit({ type: 'drop:spawned', dropId: d.id, kind: d.kind, pos: { x: d.pos.x, y: d.pos.y } });
      }
    }
    if (state.phase === 'aiming') {
      aimAngle += dtMs * 0.0012;
      const a = -Math.PI / 2 + Math.sin(aimAngle) * 1.1;
      state.aimDir = { x: Math.cos(a), y: Math.sin(a) };
      // éventail : passe par 0 (rafale serrée) puis s'ouvre jusqu'à 1
      const sp = Math.sin(aimAngle * 1.6);
      state.aimSpread = sp > 0 ? sp : 0;
      if (phaseT > 2200) {
        state.phase = 'firing'; phaseT = 0; launched = 0; launchT = 0;
        state.pendingLaunches = balls.length;
        state.currentShotDamage = 0;
        state.recallSpeed = 1;
        if (forgeSet) {
          const f = FORGE_DEMO[state.stats.shots % FORGE_DEMO.length]!;
          emit({ type: 'shop:forged', result: f[0], parents: [f[1], f[2]], cost: 40, pos: { x: cols / 2, y: rows / 2 } });
        } else if (state.stats.shots % 2 === 1) emit({ type: 'volley:fusion', element: 'fire', tier: 2, index: 0, pos: { x: state.launchPos.x, y: state.launchPos.y - 0.6 } });
        else emit({ type: 'reward:chosen', option: { kind: 'fuse', element: 'ice', tier: 3 } });
        shotBase = Math.atan2(state.aimDir.y, state.aimDir.x);
        shotHalf = state.aimSpread * maxSpreadRad;
        emit({ type: 'volley:start', count: balls.length, from: { ...state.launchPos }, dir: { ...state.aimDir }, spread: state.aimSpread });
      }
    } else if (state.phase === 'firing') {
      launchT += dtMs;
      const dir = state.aimDir;
      while (launched < balls.length && launchT >= launched * 90 && dir) {
        const b = balls[launched]!;
        // combos de départ échelonnés : montre les paliers 8 / 16 / 32 du combo sur balle
        b.alive = true; b.combo = launched % 4 === 0 ? 6 + launched : 0; b.triggered = false; if (b.kind === 'echo') b.kind = 'main';
        b.golden = launched === balls.length - 1;
        b.pos.x = state.launchPos.x; b.pos.y = state.launchPos.y;
        const u = balls.length > 1 ? (launched / (balls.length - 1)) * 2 - 1 : 0;
        const a = Math.min(-0.15, Math.max(-Math.PI + 0.15, shotBase + u * shotHalf));
        b.vel.x = Math.cos(a) * config.blocks.board.ballSpeed * 0.6; b.vel.y = Math.sin(a) * config.blocks.board.ballSpeed * 0.6;
        emit({ type: 'ball:launched', ballId: b.id, element: b.element, tier: b.tier, pos: { x: b.pos.x, y: b.pos.y }, golden: b.golden });
        launched++;
        state.pendingLaunches = balls.length - launched;
      }
      // accélération automatique après 2,5 s (comme la sim après 4,5 s)
      if (phaseT > 2500) state.recallSpeed = Math.min(3, state.recallSpeed + dtMs * 0.002);
      physics(dtMs * state.recallSpeed);
      milestoneT += dtMs;
      if (milestoneT > 1600) {
        milestoneT = 0;
        const lead = balls.find((b) => b.alive) ?? balls[0]!;
        emit({ type: 'combo:milestone', combo: [5, 10, 20][milestoneLvl - 1] ?? 5, pos: { x: lead.pos.x, y: lead.pos.y }, level: milestoneLvl });
        const nova = balls.find((b) => b.alive && b.element === 'nova');
        if (nova) emit({ type: 'block:explode', pos: { x: nova.pos.x, y: nova.pos.y }, radius: 1.2, damage: 10, element: 'nova' });
        const sn = balls.find((b) => b.alive && b.element === 'supernova');
        if (sn) emit({ type: 'block:explode', pos: { x: sn.pos.x, y: sn.pos.y }, radius: 2, damage: 100, element: 'supernova' });
        milestoneLvl = milestoneLvl === 3 ? 1 : ((milestoneLvl + 1) as 2 | 3);
      }
      if (phaseT > 5000 || (launched === balls.length && balls.every((b) => !b.alive))) {
        for (const b of balls) { b.alive = false; }
        const last = balls[balls.length - 1]!;
        state.launchPos.x = Math.min(cols - 0.5, Math.max(0.5, last.pos.x));
        state.aimDir = null;
        state.pendingLaunches = 0;
        state.stats.shots++;
        for (const b of blocks) if (b.acidCharges) b.acidCharges--; // morsure de début de tir
        if (state.stats.shots % 3 === 1) {
          state.stats.contractsCompleted++;
          emit({ type: 'contract:completed', def: contractDef, reward: contractDef.reward });
        }
        if (state.stats.shots % 4 === 2) {
          // défaite simulée : voile, puis seconde chance après 1,5 s
          state.phase = 'gameover'; phaseT = 0;
          // la rangée « fatale » : sera effacée par la seconde chance (éclats sans block:destroyed)
          for (let c = 0; c < cols; c++) if (c % 3 !== 1) blocks.push(mkBlock('normal', c, rows - 2, 20 + c));
          emit({ type: 'run:lost', canRevive: true, wave: state.wave, depth: state.depth });
          return;
        }
        if (state.stats.shots % 2 === 0) state.wave = Math.min(15, state.wave + 3); // teinte de profondeur
        emit({ type: 'rows:advanced', wave: state.wave, newRow: false });
        state.phase = 'advancing'; phaseT = 0; state.advanceProgress = 0;
      }
    } else if (state.phase === 'gameover') {
      if (phaseT > 1500) {
        // comme la sim : 3 rangées du bas effacées SANS block:destroyed (le rendu les détecte)
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i]!;
          if (b.kind !== 'boss' && b.row >= rows - 1 - 3) { cleared.push(b); blocks.splice(i, 1); }
        }
        state.revivesUsed++;
        state.phase = 'aiming'; phaseT = 0;
        emit({ type: 'run:revived', hpLeft: state.hp, revivesUsed: state.revivesUsed });
      }
    } else if (state.phase === 'advancing') {
      state.advanceProgress = Math.min(1, phaseT / config.blocks.board.advanceDurationMs);
      if (state.advanceProgress >= 1) {
        // comme la sim : row est incrémenté à la FIN de l'avancée
        for (const b of blocks) {
          if (b.frozen) { b.frozen = false; continue; }
          if (b.kind === 'boss') continue;
          b.row++;
          if (b.row >= rows - 1) {
            emit({ type: 'block:breached', blockId: b.id, kind: b.kind, damage: 1 });
            emit({ type: 'player:damaged', amount: 1, hpLeft: state.hp });
            respawnBlock(b);
          }
        }
        // réinjecte les blocs effacés par la seconde chance (nouveaux ids : « pop » d'apparition)
        while (cleared.length > 0) {
          const b = cleared.pop()!;
          respawnBlock(b);
          b.row = 1 + Math.floor(Math.random() * 3);
          blocks.push(b);
        }
        state.phase = 'aiming'; phaseT = 0; state.advanceProgress = 0;
      }
    }
  }

  opts.debug?.({ bus, state, renderer });
  const onResize = (): void => renderer.resize();
  window.addEventListener('resize', onResize);
  renderer.resize();

  let raf = 0;
  let last = performance.now();
  let acc = 0;
  const FIXED = 1000 / 60;
  const loop = (now: number): void => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(100, now - last);
    last = now;
    acc += dt;
    while (acc >= FIXED) { simStep(FIXED); acc -= FIXED; }
    renderer.draw(state, dt);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    renderer.dispose();
  };
}
