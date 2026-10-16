// sim/drops.ts — apparition, ramassage et descente des drops.
import type { Drop } from '../core/types';
import type { Ctx } from './ctx';
import { emit } from './ctx';
import { acquireDrop, releaseDrop } from './pools';
import { heal, pickBallElement, pickDropKind } from './rewards';
import { addVolleyBall } from './volley';
import { DROP_RADIUS } from './constants';

/** Tirage d'un drop à la casse d'un bloc (appelé après l'incrément de blocksDestroyed). */
export function maybeDrop(ctx: Ctx, x: number, y: number): void {
  const t = ctx.cfg.blocks.drops;
  const n = ctx.s.stats.blocksDestroyed;
  let kind: Drop['kind'];
  if (t.guaranteedBallEvery > 0 && n % t.guaranteedBallEvery === 0) kind = 'ball';
  else if (ctx.rng.chance(t.dropChance)) kind = pickDropKind(ctx);
  else return;
  let value = 1;
  let element: Drop['element'] = null;
  if (kind === 'coin') value = ctx.rng.int(t.coinValue.min, t.coinValue.max);
  else if (kind === 'fragment') value = ctx.rng.int(t.fragmentValue.min, t.fragmentValue.max);
  else if (kind === 'ball') element = pickBallElement(ctx);
  const d = acquireDrop(ctx, kind, x, y, value, element);
  emit(ctx, { type: 'drop:spawned', dropId: d.id, kind, pos: { x, y } });
}

/** Ramasse le drop d'index i (swap-remove). */
export function collectDrop(ctx: Ctx, i: number): void {
  const s = ctx.s;
  const d = s.drops[i];
  if (!d) return;
  let value = d.value;
  switch (d.kind) {
    case 'coin': {
      value = Math.round(d.value * ctx.meta.coinMultiplier * ctx.relic.coinMult);
      s.coins += value;
      s.stats.coinsEarned += value;
      if (ctx.relic.piggy > 0) {
        s.internal.piggyCoins += value;
        while (s.internal.piggyCoins >= ctx.relic.piggy) {
          s.internal.piggyCoins -= ctx.relic.piggy;
          heal(ctx, 1);
        }
      }
      break;
    }
    case 'ball':
      addVolleyBall(ctx, d.element ?? 'stone', 1);
      break;
    case 'fragment':
      s.stats.fragmentsEarned += d.value;
      break;
    case 'heart':
      heal(ctx, Math.max(d.value, ctx.relic.heartHeal));
      break;
  }
  emit(ctx, { type: 'drop:collected', dropId: d.id, kind: d.kind, pos: { x: d.pos.x, y: d.pos.y }, value });
  releaseDrop(ctx, i);
}

export function collectAllDrops(ctx: Ctx): void {
  for (let i = ctx.s.drops.length - 1; i >= 0; i--) collectDrop(ctx, i);
}

/** Ramassage au contact d'une balle. */
export function collectTouched(ctx: Ctx, bx: number, by: number, br: number): void {
  const drops = ctx.s.drops;
  const R = DROP_RADIUS + br;
  const R2 = R * R;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i] as Drop;
    const dx = d.pos.x - bx;
    const dy = d.pos.y - by;
    if (dx * dx + dy * dy < R2) collectDrop(ctx, i);
  }
}

/** Les drops descendent avec les blocs. */
export function shiftDrops(ctx: Ctx, rows: number): void {
  for (const d of ctx.s.drops) d.pos.y += rows;
}

/** Drops arrivés sur la ligne du joueur : ramassés automatiquement. */
export function collectGroundDrops(ctx: Ctx): void {
  const limit = ctx.cfg.blocks.board.rows - 1;
  for (let i = ctx.s.drops.length - 1; i >= 0; i--) {
    const d = ctx.s.drops[i] as Drop;
    if (d.pos.y > limit) collectDrop(ctx, i);
  }
}
