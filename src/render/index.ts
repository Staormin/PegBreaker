// render/index.ts — renderer canvas 2D de Pegbreaker (propriétaire : feel-artist).
// Lit RunState en lecture seule, s'abonne au bus pour le juice, appelle TimeControl
// pour hit-stop / slow-mo. Ne touche jamais à la sim.
import type { EventBus, Unsubscribe } from '../core/events';
import type { GameConfig, Renderer, RunState, TimeControl, Vec2 } from '../core/types';
import { boardToScreen, computeLayout, createLayout, screenToBoard } from './layout';
import { buildSprites, type Sprites } from './sprites';
import { createParticles, P_CRYSTAL, P_SHARD, P_SPARK } from './particles';
import { createDamageNumbers, formatNumber, FONT_BUCKETS } from './damageNumbers';
import { createVfx } from './vfx';
import { createFrameDrawer } from './draw';
import { buildColors, ELEMENT_INDEX, KIND_INDEX, PALETTE } from './palette';

export { PALETTE } from './palette';

export interface PegRenderer extends Renderer {
  /** désabonne le renderer du bus (démo, hot reload). Hors interface Renderer. */
  dispose(): void;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  bus: EventBus,
  time: TimeControl,
  config: GameConfig,
): PegRenderer {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('render: contexte 2D indisponible');
  const board = config.blocks.board;
  const colors = buildColors(config);
  const layout = createLayout(board.cols, board.rows);
  const particles = createParticles();
  const numbers = createDamageNumbers();
  const vfx = createVfx();
  let sprites: Sprites | null = null;
  let frame = 0;
  let lastState: Readonly<RunState> | null = null;
  let reduceMotion = false;

  function doResize(): Sprites {
    computeLayout(layout, canvas);
    const s = buildSprites(layout, colors, config);
    sprites = s;
    numbers.rebuildFonts(layout);
    drawer.rebuildFonts();
    return s;
  }

  function ensureSprites(): Sprites {
    return sprites ?? doResize();
  }

  const drawer = createFrameDrawer({
    ctx, layout, particles, numbers, vfx,
    ballRadius: board.ballRadius,
    getSprites: ensureSprites,
  });

  // ------------------------------------------------------------------
  // Événements → feedback (allocation tolérée ici : hors boucle de dessin)
  // ------------------------------------------------------------------
  const kindColor = (k: number): string => colors.kind[k] ?? PALETTE.block;
  const elemColor = (e: keyof typeof ELEMENT_INDEX): string => colors.element[ELEMENT_INDEX[e]] ?? PALETTE.stone;
  const subs: Unsubscribe[] = [];

  subs.push(bus.on('ball:bounce', (e) => {
    const dir = Math.atan2(e.normal.y, e.normal.x);
    const n = 3 + Math.floor(Math.random() * 3);
    if (e.surface === 'wall') {
      particles.burst(e.pos.x, e.pos.y, n, '#b8c8ff', P_SPARK, 2, 5, dir, 0.9, 0.1, 0.22, 0.03, 0.05, 0);
      // micro-flash du mur à l'impact (0,08 s)
      if (Math.abs(e.normal.x) > 0.5) vfx.flashRect(e.normal.x > 0 ? 0 : board.cols - 0.06, e.pos.y - 0.3, 0.06, 0.6, 80, '#9fb4e0');
      else vfx.flashRect(e.pos.x - 0.3, 0, 0.6, 0.06, 80, '#9fb4e0');
    } else {
      particles.burst(e.pos.x, e.pos.y, n, PALETTE.text, P_SPARK, 2, 5.5, dir, 1.0, 0.1, 0.22, 0.03, 0.05, 0);
      if (e.surface === 'peg' && lastState) {
        // squash du peg le plus proche (les pegs ne reçoivent pas forcément block:hit)
        const blocks = lastState.blocks;
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i]!;
          if (b.kind !== 'peg') continue;
          const dx = b.col + 0.5 - e.pos.x, dy = b.row + 0.5 - e.pos.y;
          if (dx * dx + dy * dy < 0.36) { vfx.blockFx(b.id).squashT = 0; break; }
        }
      }
    }
  }));

  subs.push(bus.on('block:hit', (e) => {
    numbers.add(e.pos.x, e.pos.y - 0.1, e.damage, e.crit, e.blockId);
    vfx.blockFx(e.blockId).squashT = 0;
    particles.burst(e.pos.x, e.pos.y, 2, elemColor(e.element), P_SPARK, 1.5, 4, 0, Math.PI, 0.1, 0.2, 0.03, 0.05, 0);
  }));

  subs.push(bus.on('block:destroyed', (e) => {
    const fx = vfx.peekBlockFx(e.blockId);
    const k = KIND_INDEX[e.kind];
    const w = fx ? fx.w : e.width;
    const cx = fx ? fx.x + w * 0.5 : e.pos.x;
    const cy = fx ? fx.y + 0.5 : e.pos.y;
    const n = Math.min(40, (8 + Math.floor(Math.random() * 7)) * (w > 1 ? 2 : 1));
    particles.burst(cx, cy, n, kindColor(k), P_SHARD, 3, 8, -Math.PI / 2, Math.PI, 0.35, 0.6, 0.07, 0.13, 7);
    particles.burst(cx, cy, 4, '#ffffff', P_SPARK, 3, 7, -Math.PI / 2, Math.PI, 0.1, 0.2, 0.04, 0.06, 0);
    vfx.flashRect(cx - w * 0.5 + 0.05, cy - 0.45, w - 0.1, 0.9, 70, '#ffffff');
    vfx.addShake(2);
    vfx.releaseBlockFx(e.blockId);
  }));

  subs.push(bus.on('block:explode', (e) => {
    vfx.ring(e.pos.x, e.pos.y, 0.15, Math.max(0.5, e.radius), 250, elemColor('fire'), 0.16);
    vfx.ring(e.pos.x, e.pos.y, 0.05, Math.max(0.4, e.radius * 0.75), 200, '#ffffff', 0.06);
    vfx.flashCircle(e.pos.x, e.pos.y, Math.max(0.4, e.radius * 0.6), 120, '#ffe0b0');
    particles.burst(e.pos.x, e.pos.y, 14, elemColor('fire'), P_SPARK, 4, 9, 0, Math.PI, 0.15, 0.35, 0.05, 0.08, 0);
    vfx.addShake(6);
    time.requestHitStop(30);
  }));

  subs.push(bus.on('combo:milestone', (e) => {
    const lvl = e.level;
    vfx.screenFlash(lvl === 1 ? 0.16 : lvl === 2 ? 0.22 : 0.3, lvl === 3 ? PALETTE.accent : '#ffffff');
    vfx.addShake(lvl === 1 ? 4 : lvl === 2 ? 5 : 7);
    vfx.ring(e.pos.x, e.pos.y, 0.1, 0.8 + 0.4 * lvl, 300, PALETTE.accent, 0.08);
    particles.burst(e.pos.x, e.pos.y, 6 + 4 * lvl, PALETTE.accent, P_SPARK, 3, 7, 0, Math.PI, 0.2, 0.4, 0.04, 0.07, 0);
    numbers.addLabel(e.pos.x, e.pos.y - 0.35, `COMBO ×${e.combo}`, PALETTE.accent, Math.min(FONT_BUCKETS - 1, 4 + 2 * lvl));
    if (lvl === 2) time.requestHitStop(40);
    if (lvl === 3) {
      time.requestHitStop(70);
      if (!reduceMotion) time.requestSlowMo(0.3, 200);
      vfx.vignette(600);
    }
  }));

  subs.push(bus.on('player:damaged', () => {
    vfx.redEdges(500);
    vfx.addShake(8);
    time.requestHitStop(60);
  }));

  subs.push(bus.on('drop:collected', (e) => {
    const c = e.kind === 'coin' ? PALETTE.coin : e.kind === 'fragment' ? PALETTE.fragment : e.kind === 'heart' ? PALETTE.heart : PALETTE.good;
    particles.burst(e.pos.x, e.pos.y, 8, c, P_SPARK, 2, 5, 0, Math.PI, 0.15, 0.3, 0.04, 0.06, 0);
    vfx.flashCircle(e.pos.x, e.pos.y, 0.3, 120, c);
    vfx.ring(e.pos.x, e.pos.y, 0.1, 0.45, 200, c, 0.05);
    if (e.value > 0) numbers.addLabel(e.pos.x, e.pos.y - 0.2, `+${formatNumber(e.value)}`, c, 1);
  }));

  subs.push(bus.on('volley:fusion', (e) => {
    const x = lastState ? lastState.launchPos.x : board.cols / 2;
    const y = lastState ? lastState.launchPos.y : board.rows - 0.2;
    const c = elemColor(e.element);
    vfx.flashCircle(x, y, 0.55, 160, '#ffffff');
    vfx.ring(x, y, 0.1, 0.9, 260, c, 0.08);
    particles.burst(x, y, 10, c, P_SPARK, 2, 6, -Math.PI / 2, Math.PI * 0.7, 0.2, 0.4, 0.04, 0.07, 0);
  }));

  subs.push(bus.on('lightning:chain', (e) => {
    vfx.bolt(e.from.x, e.from.y, e.to.x, e.to.y, 120, elemColor('lightning'));
    particles.burst(e.to.x, e.to.y, 4, elemColor('lightning'), P_SPARK, 2, 5, 0, Math.PI, 0.1, 0.2, 0.03, 0.05, 0);
  }));

  subs.push(bus.on('block:frozen', (e) => {
    particles.burst(e.pos.x, e.pos.y, 7, elemColor('ice'), P_CRYSTAL, 0.8, 2.5, -Math.PI / 2, Math.PI, 0.3, 0.55, 0.07, 0.12, 1.5);
    vfx.ring(e.pos.x, e.pos.y, 0.1, 0.55, 220, elemColor('ice'), 0.05);
  }));

  subs.push(bus.on('boss:spawned', () => {
    vfx.tremble(400, 4);
  }));

  subs.push(bus.on('boss:killed', (e) => {
    particles.burst(e.pos.x, e.pos.y, 40, kindColor(KIND_INDEX.boss), P_SHARD, 3, 9, 0, Math.PI, 0.4, 0.6, 0.08, 0.16, 6);
    vfx.ring(e.pos.x, e.pos.y, 0.2, 2.5, 400, PALETTE.accent, 0.12);
    vfx.screenFlash(0.3, '#ffffff');
    vfx.addShake(9);
    time.requestHitStop(80);
  }));

  subs.push(bus.on('block:breached', () => {
    vfx.flashRect(0, board.rows - 1, board.cols, 1, 220, PALETTE.danger);
  }));

  subs.push(bus.on('ball:split', (e) => {
    particles.burst(e.pos.x, e.pos.y, 6, elemColor('split'), P_SPARK, 2, 5, 0, Math.PI, 0.12, 0.25, 0.03, 0.06, 0);
    vfx.flashCircle(e.pos.x, e.pos.y, 0.22, 90, elemColor('split'));
  }));

  subs.push(bus.on('drop:spawned', (e) => {
    vfx.ring(e.pos.x, e.pos.y, 0.05, 0.35, 160, PALETTE.text, 0.04);
  }));

  subs.push(bus.on('ball:grounded', (e) => {
    particles.burst(e.pos.x, e.pos.y, 2, PALETTE.textDim, P_SPARK, 0.5, 1.5, -Math.PI / 2, 0.8, 0.1, 0.2, 0.03, 0.04, 0);
  }));

  subs.push(bus.on('run:started', () => {
    particles.clear(); numbers.clear(); vfx.clear(); drawer.clearTrails();
  }));
  // rows:advanced : volontairement rien — l'interpolation easeOutBack dans draw suffit.

  // ------------------------------------------------------------------
  // API Renderer
  // ------------------------------------------------------------------
  return {
    draw(state, dtMs) {
      lastState = state;
      ensureSprites();
      const dt = (dtMs > 100 ? 100 : dtMs < 0 ? 0 : dtMs) / 1000;
      frame++;
      vfx.update(dt);
      particles.update(dt);
      numbers.update(dt);
      drawer.draw(state, dt, frame);
    },
    resize() {
      doResize();
    },
    screenToBoard(px: number, py: number): Vec2 {
      ensureSprites();
      return screenToBoard(layout, px, py);
    },
    boardToScreen(p: Vec2): Vec2 {
      ensureSprites();
      return boardToScreen(layout, p);
    },
    setReduceMotion(v: boolean) {
      reduceMotion = v;
      vfx.reduceMotion = v;
      particles.density = v ? 0.5 : 1;
    },
    setShake(v: boolean) {
      vfx.shakeEnabled = v;
    },
    get particleCount() {
      return particles.count;
    },
    dispose() {
      for (const u of subs) u();
      subs.length = 0;
    },
  };
}
