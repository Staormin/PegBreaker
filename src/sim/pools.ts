// sim/pools.ts — pools de balles, drops et blocs (swap-remove, aucun splice).
import type { Ball, Block, BlockKind, Drop, DropKind, BallElement } from '../core/types';
import type { Ctx } from './ctx';
import { newId } from './ctx';
import { createFx, resetFx, type BallFx } from './state';

export function acquireBall(ctx: Ctx): Ball {
  const b =
    ctx.spareBalls.pop() ??
    ({
      id: 0,
      element: 'stone',
      tier: 1,
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      radius: 0,
      combo: 0,
      alive: false,
      triggered: false,
      golden: false,
    } satisfies Ball);
  b.id = newId(ctx);
  b.radius = ctx.cfg.blocks.board.ballRadius;
  b.combo = 0;
  b.alive = true;
  b.triggered = false;
  b.golden = false;
  b.kind = 'main';
  ctx.s.balls.push(b);
  const fx = ctx.spareFx.pop() ?? createFx();
  resetFx(fx);
  ctx.s.internal.bfx.push(fx);
  return b;
}

/** Effets de la balle (index aligné sur state.balls) ; repli neutre si absente. */
export function fxOf(ctx: Ctx, b: Ball): BallFx {
  const balls = ctx.s.balls;
  const fx = ctx.s.internal.bfx;
  for (let i = balls.length - 1; i >= 0; i--) if (balls[i] === b) return fx[i] ?? ctx.nullFx;
  return ctx.nullFx;
}

/** Garantit l'alignement bfx ↔ balls (reprise d'un snapshot antérieur aux 27 balles). */
export function syncFx(ctx: Ctx): void {
  const it = ctx.s.internal;
  if (!Array.isArray(it.bfx)) it.bfx = [];
  while (it.bfx.length > ctx.s.balls.length) it.bfx.pop();
  while (it.bfx.length < ctx.s.balls.length) it.bfx.push(createFx());
}

export function releaseBall(ctx: Ctx, i: number): void {
  const arr = ctx.s.balls;
  const b = arr[i];
  if (!b) return;
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last] as Ball;
  arr.pop();
  b.alive = false;
  ctx.spareBalls.push(b);
  const fx = ctx.s.internal.bfx;
  const f = fx[i];
  if (f) {
    const lf = fx.length - 1;
    if (i !== lf) fx[i] = fx[lf] as BallFx;
    fx.pop();
    ctx.spareFx.push(f);
  }
}

export function acquireDrop(ctx: Ctx, kind: DropKind, x: number, y: number, value: number, element: BallElement | null): Drop {
  const d = ctx.spareDrops.pop() ?? ({ id: 0, kind: 'coin', pos: { x: 0, y: 0 }, value: 0, element: null } satisfies Drop);
  d.id = newId(ctx);
  d.kind = kind;
  d.pos.x = x;
  d.pos.y = y;
  d.value = value;
  d.element = element;
  ctx.s.drops.push(d);
  return d;
}

export function releaseDrop(ctx: Ctx, i: number): void {
  const arr = ctx.s.drops;
  const d = arr[i];
  if (!d) return;
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last] as Drop;
  arr.pop();
  ctx.spareDrops.push(d);
}

export function acquireBlock(ctx: Ctx, kind: BlockKind, col: number, row: number, width: number, hp: number): Block {
  const b =
    ctx.spareBlocks.pop() ??
    ({
      id: 0,
      kind: 'normal',
      col: 0,
      row: 0,
      width: 1,
      hp: 0,
      maxHp: 0,
      frozen: false,
      armorSide: 'none',
      bossId: null,
    } satisfies Block);
  b.id = newId(ctx);
  b.kind = kind;
  b.col = col;
  b.row = row;
  b.width = width;
  b.hp = hp;
  b.maxHp = hp;
  b.frozen = false;
  b.armorSide = kind === 'armored' ? 'down' : 'none';
  b.bossId = null;
  if (b.acidCharges !== undefined) b.acidCharges = 0;
  ctx.s.blocks.push(b);
  ctx.gridDirty = true;
  return b;
}

export function releaseBlock(ctx: Ctx, i: number): void {
  const arr = ctx.s.blocks;
  const b = arr[i];
  if (!b) return;
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last] as Block;
  arr.pop();
  ctx.spareBlocks.push(b);
  ctx.gridDirty = true;
}

/** Retire les blocs morts (fin de sous-pas). */
export function compactBlocks(ctx: Ctx): void {
  const arr = ctx.s.blocks;
  for (let i = arr.length - 1; i >= 0; i--) {
    const b = arr[i] as Block;
    if (b.kind !== 'peg' && b.hp <= 0) releaseBlock(ctx, i);
  }
  ctx.blocksDied = false;
  ctx.gridDirty = true;
}
