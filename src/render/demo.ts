// render/demo.ts — démo autonome du renderer, sans la sim : RunState factice, mini-physique
// locale (5 balles), événements synthétiques sur un vrai EventBus, TimeControl factice.
// Usage : const stop = mountRenderDemo(canvas); ... stop();
import { createEventBus } from '../core/events';
import { loadConfig } from '../core/config';
import type { Ball, BallElement, Block, BlockKind, Drop, GameEvent, RunState, TimeControl } from '../core/types';
import { createRenderer } from './index';

interface DemoTime extends TimeControl {
  tick(dtReal: number): void;
}

function createDemoTime(): DemoTime {
  let hitStop = 0, slowLeft = 0, slowScale = 1;
  return {
    get timeScale() { return hitStop > 0 ? 0 : slowLeft > 0 ? slowScale : 1; },
    requestHitStop(ms) { hitStop = Math.max(hitStop, ms); },
    requestSlowMo(scale, ms) { slowScale = Math.min(scale, slowLeft > 0 ? slowScale : 1); slowLeft = Math.max(slowLeft, ms); },
    tick(dt) { if (hitStop > 0) hitStop -= dt; else if (slowLeft > 0) slowLeft -= dt; },
  };
}

const ELEMS: BallElement[] = ['stone', 'fire', 'lightning', 'ice', 'ghost'];

export function mountRenderDemo(canvas: HTMLCanvasElement): () => void {
  const config = loadConfig();
  const { cols, rows, ballRadius: R } = config.blocks.board;
  const bus = createEventBus();
  const time = createDemoTime();
  const renderer = createRenderer(canvas, bus, time, config);

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
    mkBlock('explosive', 1, 5, 4), mkBlock('normal', 5, 5, 17),
  ];
  const drops: Drop[] = [
    { id: 1, kind: 'coin', pos: { x: 1.5, y: 6.5 }, value: 3, element: null },
    { id: 2, kind: 'ball', pos: { x: 3.5, y: 6.5 }, value: 1, element: 'fire' },
    { id: 3, kind: 'fragment', pos: { x: 5.5, y: 6.5 }, value: 1, element: null },
    { id: 4, kind: 'heart', pos: { x: 4.5, y: 7.5 }, value: 1, element: null },
  ];
  const balls: Ball[] = [];
  for (let i = 0; i < 5; i++) {
    balls.push({ id: 100 + i, element: ELEMS[i] ?? 'stone', tier: ((i % 3) + 1) as 1 | 2 | 3, pos: { x: 3.5, y: rows - R }, vel: { x: 0, y: 0 }, radius: R, combo: 0, alive: false, triggered: false });
  }

  const state: RunState = {
    seed: 'demo', phase: 'aiming', wave: 1, shotInWave: 0, rowsLeftInWave: 3, depth: 0,
    hp: 5, maxHp: 5, coins: 0,
    volley: balls.map((b) => ({ element: b.element, tier: b.tier })),
    balls, blocks, drops, relics: [],
    launchPos: { x: 3.5, y: rows - R }, aimDir: { x: 0.3, y: -1 },
    currentShotDamage: 0, currentShotCombo: 0, rewardOffer: null, shop: null,
    pendingLaunches: 0, advanceProgress: 0,
    stats: { shots: 0, blocksDestroyed: 0, bestCombo: 0, bestShotDamage: 0, totalDamage: 0, coinsEarned: 0, fragmentsEarned: 0, fusions: 0, bossesKilled: 0, durationMs: 0 },
    rngState: 0, recallSpeed: 1,
  };

  const emit = (e: GameEvent): void => bus.emit(e);
  let phaseT = 0;
  let launchT = 0;
  let launched = 0;
  let milestoneT = 0;
  let milestoneLvl: 1 | 2 | 3 = 1;
  let aimAngle = 0;
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
    ball.combo++;
    const crit = Math.random() < 0.12;
    const dmg = Math.max(1, Math.round((ball.tier * 2 + ball.combo * 0.3) * (crit ? 3 : 1)));
    b.hp = Math.max(0, b.hp - dmg);
    emit({ type: 'block:hit', blockId: b.id, pos: { x: ball.pos.x, y: ball.pos.y }, damage: dmg, combo: ball.combo, element: ball.element, hpLeft: b.hp, crit });
    if (ball.element === 'lightning') {
      const other = blocks[Math.floor(Math.random() * blocks.length)];
      if (other && other !== b) emit({ type: 'lightning:chain', from: { x: ball.pos.x, y: ball.pos.y }, to: { x: other.col + other.width / 2, y: other.row + 0.5 }, damage: 1 });
    }
    if (ball.element === 'ice' && !b.frozen && b.kind !== 'boss') { b.frozen = true; emit({ type: 'block:frozen', blockId: b.id, pos: { x: b.col + 0.5, y: b.row + 0.5 } }); }
    if (b.hp <= 0) {
      const pos = { x: b.col + b.width / 2, y: b.row + 0.5 };
      emit({ type: 'block:destroyed', blockId: b.id, kind: b.kind, pos, width: b.width, element: ball.element });
      if (b.kind === 'explosive') emit({ type: 'block:explode', pos, radius: 1.2, damage: 5 });
      if (b.kind === 'boss') b.hp = b.maxHp = 1520;
      else respawnBlock(b);
    }
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
        if (ball.pos.x < R) { ball.pos.x = R; ball.vel.x = Math.abs(ball.vel.x); emit({ type: 'ball:bounce', ballId: ball.id, pos: { x: 0, y: ball.pos.y }, normal: { x: 1, y: 0 }, surface: 'wall', combo: ball.combo }); }
        if (ball.pos.x > cols - R) { ball.pos.x = cols - R; ball.vel.x = -Math.abs(ball.vel.x); emit({ type: 'ball:bounce', ballId: ball.id, pos: { x: cols, y: ball.pos.y }, normal: { x: -1, y: 0 }, surface: 'wall', combo: ball.combo }); }
        if (ball.pos.y < R) { ball.pos.y = R; ball.vel.y = Math.abs(ball.vel.y); emit({ type: 'ball:bounce', ballId: ball.id, pos: { x: ball.pos.x, y: 0 }, normal: { x: 0, y: 1 }, surface: 'wall', combo: ball.combo }); }
        if (ball.pos.y > rows - R) {
          ball.pos.y = rows - R; ball.alive = false; ball.combo = 0;
          emit({ type: 'ball:grounded', ballId: ball.id, pos: { x: ball.pos.x, y: rows } });
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
      if (phaseT > 2200) {
        state.phase = 'firing'; phaseT = 0; launched = 0; launchT = 0;
        state.pendingLaunches = balls.length;
        if (state.stats.shots % 2 === 1) emit({ type: 'volley:fusion', element: 'fire', tier: 2, index: 0, pos: { x: state.launchPos.x, y: state.launchPos.y } });
        emit({ type: 'volley:start', count: balls.length, from: { ...state.launchPos }, dir: { ...state.aimDir } });
      }
    } else if (state.phase === 'firing') {
      launchT += dtMs;
      const dir = state.aimDir;
      while (launched < balls.length && launchT >= launched * 90 && dir) {
        const b = balls[launched]!;
        b.alive = true; b.combo = 0;
        b.pos.x = state.launchPos.x; b.pos.y = state.launchPos.y;
        b.vel.x = dir.x * config.blocks.board.ballSpeed * 0.6; b.vel.y = dir.y * config.blocks.board.ballSpeed * 0.6;
        launched++;
        state.pendingLaunches = balls.length - launched;
      }
      physics(dtMs);
      milestoneT += dtMs;
      if (milestoneT > 1600) {
        milestoneT = 0;
        const lead = balls.find((b) => b.alive) ?? balls[0]!;
        emit({ type: 'combo:milestone', combo: [5, 10, 20][milestoneLvl - 1] ?? 5, pos: { x: lead.pos.x, y: lead.pos.y }, level: milestoneLvl });
        milestoneLvl = milestoneLvl === 3 ? 1 : ((milestoneLvl + 1) as 2 | 3);
      }
      if (phaseT > 5000 || (launched === balls.length && balls.every((b) => !b.alive))) {
        for (const b of balls) { b.alive = false; }
        const last = balls[balls.length - 1]!;
        state.launchPos.x = Math.min(cols - 0.5, Math.max(0.5, last.pos.x));
        state.aimDir = null;
        state.pendingLaunches = 0;
        state.stats.shots++;
        // avancée : la sim incrémente row au début de la phase et anime advanceProgress
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
        emit({ type: 'rows:advanced', wave: 1, newRow: false });
        state.phase = 'advancing'; phaseT = 0; state.advanceProgress = 0;
      }
    } else if (state.phase === 'advancing') {
      state.advanceProgress = Math.min(1, phaseT / config.blocks.board.advanceDurationMs);
      if (state.advanceProgress >= 1) { state.phase = 'aiming'; phaseT = 0; }
    }
  }

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
    time.tick(dt);
    acc += dt * time.timeScale;
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
