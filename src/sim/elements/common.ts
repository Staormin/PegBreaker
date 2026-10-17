// sim/elements/common.ts — utilitaires partagés par les éléments (paramètres, mini-balles, géométrie).
import type { Ball, BallElement, Block } from '../../core/types';
import type { Ctx } from '../ctx';
import { ballDef, isBreakable } from '../ctx';
import type { BallFx } from '../state';
import { acquireBall } from '../pools';
import { fixVelocity } from '../physics';

/** Paramètre de mécanique `key` au rang `tier` (balls.json → params[key][tier−1]) ; 0 si absent (validé à createSim). */
export function prm(ctx: Ctx, el: BallElement, key: string, tier: number): number {
  const v = ballDef(ctx, el).params?.[key]?.[tier - 1];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export const DEG = Math.PI / 180;

/** Place pour une balle de plus dans le plafond balls.maxLiveBalls (balles en vol + rafale restante). */
export function liveRoom(ctx: Ctx): boolean {
  const balls = ctx.s.balls;
  let live = ctx.s.pendingLaunches;
  for (let i = 0; i < balls.length; i++) if ((balls[i] as Ball).alive) live++;
  return live < ctx.cfg.balls.maxLiveBalls;
}

/**
 * Mini-balle (essaim, éclat de cristal, jumelle, écho) : poolée, sans hooks d'élément, jamais dorée, combo 0,
 * rang du parent (tierDamageMultiplier). Renvoie null au plafond. Ses effets sont accessibles par miniFx().
 */
export function spawnMini(
  ctx: Ctx,
  parent: Ball,
  element: BallElement,
  x: number,
  y: number,
  vx: number,
  vy: number,
  dmgMult: number,
  radiusMult: number,
): Ball | null {
  if (!liveRoom(ctx)) return null;
  const nb = acquireBall(ctx);
  const fx = ctx.s.internal.bfx[ctx.s.balls.length - 1] as BallFx;
  nb.element = element;
  nb.tier = parent.tier;
  nb.radius = ctx.cfg.blocks.board.ballRadius * radiusMult;
  nb.pos.x = x;
  nb.pos.y = y;
  nb.vel.x = vx;
  nb.vel.y = vy;
  nb.golden = false;
  nb.combo = 0;
  nb.triggered = false;
  nb.kind = element === 'echo' ? 'echo' : 'mini';
  fx.mini = true;
  fx.dmgMult = dmgMult;
  fx.dirX = vx;
  fx.dirY = vy;
  fixVelocity(ctx, nb, fx);
  clampToBoard(ctx, nb);
  return nb;
}

/** Ramène une balle née pendant une collision (scission, mini-balle) dans [r, cols − r] × [r, rows − r]. */
export function clampToBoard(ctx: Ctx, b: Ball): void {
  const { cols, rows } = ctx.cfg.blocks.board;
  const r = b.radius;
  if (b.pos.x < r) b.pos.x = r;
  else if (b.pos.x > cols - r) b.pos.x = cols - r;
  if (b.pos.y < r) b.pos.y = r;
  else if (b.pos.y > rows - r) b.pos.y = rows - r;
}

/** Effets de la dernière balle acquise (juste après spawnMini/acquireBall). */
export function lastFx(ctx: Ctx): BallFx {
  return ctx.s.internal.bfx[ctx.s.balls.length - 1] ?? ctx.nullFx;
}

export function centerX(b: Block): number {
  return b.col + b.width / 2;
}
export function centerY(b: Block): number {
  return b.row + 0.5;
}

/** Index du bloc cassable le plus proche de (x,y) (centre), hors `exclude` ; −1 si aucun. */
export function nearestBreakable(ctx: Ctx, x: number, y: number, exclude: number): number {
  const blocks = ctx.s.blocks;
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    if (i === exclude) continue;
    const b = blocks[i] as Block;
    if (!isBreakable(b)) continue;
    const dx = centerX(b) - x;
    const dy = centerY(b) - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/** Index du bloc d'identifiant `id`, −1 si absent. */
export function blockIndex(ctx: Ctx, id: number): number {
  const blocks = ctx.s.blocks;
  for (let i = 0; i < blocks.length; i++) if ((blocks[i] as Block).id === id) return i;
  return -1;
}

/**
 * Attribution d'un effet différé (bombe, prisme, nova) : casses, drops et contrats comptés pour la balle.
 * L'appelant sauvegarde ctx.curBall/curFx/curBallId/curGolden dans des locales et les restaure avec restoreAttrib.
 */
export function setAttrib(ctx: Ctx, b: Ball | null, fx: BallFx | null, id: number, golden: boolean): void {
  ctx.curBall = b;
  ctx.curFx = fx;
  ctx.curBallId = id;
  ctx.curGolden = golden;
}
