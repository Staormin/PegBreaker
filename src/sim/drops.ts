// sim/drops.ts — apparition, ramassage et descente des drops.
import type { Ball, Drop } from '../core/types';
import type { BallFx } from './state';
import { hooksOf } from './elements/index';
import type { Ctx } from './ctx';
import { emit } from './ctx';
import { acquireDrop, releaseDrop } from './pools';
import { heal, pickBallElement, pickDropKind } from './rewards';
import { addVolleyBall } from './volley';
import { DROP_RADIUS, GOLD_DROP_OFFSET } from './constants';
import { contractAdd } from './contracts';

/**
 * Tirage d'un drop à la casse d'un bloc (appelé après l'incrément de blocksDestroyed).
 * `coinMult` > 0 (balle d'or) : pièce garantie de valeur × coinMult ; si la balle garantie tombe aussi,
 * les deux drops sortent, décalés de ±GOLD_DROP_OFFSET en x (B-02).
 */
export function maybeDrop(ctx: Ctx, x: number, y: number, coinMult = 0): void {
  const t = ctx.cfg.blocks.drops;
  const n = ctx.s.stats.blocksDestroyed;
  let kind: Drop['kind'];
  if (t.guaranteedBallEvery > 0 && n % t.guaranteedBallEvery === 0) {
    kind = 'ball';
    if (coinMult > 0) {
      spawnDrop(ctx, 'ball', x - GOLD_DROP_OFFSET, y, 0);
      spawnDrop(ctx, 'coin', x + GOLD_DROP_OFFSET, y, coinMult);
      return;
    }
  } else if (coinMult > 0) kind = 'coin';
  else if (ctx.rng.chance(Math.min(1, t.dropChance * ctx.mods.dropChanceMult))) kind = pickDropKind(ctx);
  else return;
  spawnDrop(ctx, kind, x, y, coinMult);
}

/**
 * Drop garanti (Divine) : la balle garantie (guaranteedBallEvery) s'applique comme pour maybeDrop, sinon un
 * type tiré selon drops.weights.
 */
export function forceDrop(ctx: Ctx, x: number, y: number): void {
  const t = ctx.cfg.blocks.drops;
  const n = ctx.s.stats.blocksDestroyed;
  const kind = t.guaranteedBallEvery > 0 && n % t.guaranteedBallEvery === 0 ? 'ball' : pickDropKind(ctx);
  spawnDrop(ctx, kind, x, y, 0);
}

/** Crée un drop (valeur tirée selon le type ; pièce × coinMult si > 0) et émet drop:spawned. */
export function spawnDrop(ctx: Ctx, kind: Drop['kind'], x: number, y: number, coinMult: number): void {
  const t = ctx.cfg.blocks.drops;
  let value = 1;
  let element: Drop['element'] = null;
  if (kind === 'coin') {
    value = ctx.rng.int(t.coinValue.min, t.coinValue.max);
    if (coinMult > 0) value = Math.max(1, Math.round(value * coinMult));
  }
  else if (kind === 'fragment') value = ctx.rng.int(t.fragmentValue.min, t.fragmentValue.max);
  else if (kind === 'ball') element = pickBallElement(ctx);
  const d = acquireDrop(ctx, kind, x, y, value, element);
  emit(ctx, { type: 'drop:spawned', dropId: d.id, kind, pos: { x, y } });
}

/** Ramasse le drop d'index i (swap-remove). `mult` : valeur multipliée (balle de chance). */
export function collectDrop(ctx: Ctx, i: number, mult = 1): void {
  const s = ctx.s;
  const d = s.drops[i];
  if (!d) return;
  let value = d.value * mult;
  switch (d.kind) {
    case 'coin': {
      value = Math.round(d.value * mult * ctx.meta.coinMultiplier * ctx.relic.coinMult * ctx.mods.coinMult);
      s.coins += value;
      s.stats.coinsEarned += value;
      contractAdd(ctx, 'collectCoins', value);
      if (ctx.relic.piggy > 0) {
        s.internal.piggyCoins += value;
        while (s.internal.piggyCoins >= ctx.relic.piggy) {
          s.internal.piggyCoins -= ctx.relic.piggy;
          heal(ctx, 1, 'relic');
        }
      }
      break;
    }
    case 'ball': {
      const n = Math.max(1, Math.round(mult));
      for (let k = 0; k < n; k++) addVolleyBall(ctx, d.element ?? 'stone', 1);
      contractAdd(ctx, 'collectBalls', n);
      value = n;
      break;
    }
    case 'fragment':
      value = Math.round(d.value * mult);
      s.stats.fragmentsEarned += value;
      break;
    case 'heart':
      value = Math.round(Math.max(d.value, ctx.relic.heartHeal) * mult);
      heal(ctx, value, 'drop');
      break;
  }
  emit(ctx, { type: 'drop:collected', dropId: d.id, kind: d.kind, pos: { x: d.pos.x, y: d.pos.y }, value });
  releaseDrop(ctx, i);
}

export function collectAllDrops(ctx: Ctx): void {
  for (let i = ctx.s.drops.length - 1; i >= 0; i--) collectDrop(ctx, i);
}

/**
 * Ramassage au contact d'une balle. `reach` : rayon de ramassage minimal (aimant) ; `ball`/`fx` : collecteur
 * (hook onDropCollected : chance → valeur multipliée).
 */
export function collectTouched(ctx: Ctx, bx: number, by: number, br: number, reach = 0, ball: Ball | null = null, fx: BallFx | null = null): void {
  const drops = ctx.s.drops;
  const R = Math.max(DROP_RADIUS + br, reach);
  const R2 = R * R;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i] as Drop;
    const dx = d.pos.x - bx;
    const dy = d.pos.y - by;
    if (dx * dx + dy * dy < R2) {
      let mult = 1;
      if (ball && fx) {
        const H = hooksOf(ball, fx);
        if (H.onDropCollected) mult = H.onDropCollected(ctx, ball, fx, d);
      }
      collectDrop(ctx, i, mult);
    }
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
