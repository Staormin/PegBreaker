// sim/elements/swarm.ts — famille « swarm » : scission (d'origine), essaim, jumelle.
import type { Ball } from '../../core/types';
import type { Ctx } from '../ctx';
import { emit } from '../ctx';
import { acquireBall } from '../pools';
import { fixVelocity } from '../physics';
import type { ElementHooks } from './types';
import { DEG, liveRoom, prm, spawnMini } from './common';

/** Scission (code d'origine) : au premier impact, `splitParts` balles réparties de +θ à −θ. */
function split(ctx: Ctx, b: Ball): void {
  const it = ctx.s.internal;
  b.triggered = true;
  if (it.splitsThisShot >= ctx.cfg.balls.split.maxSplitsPerShot) return;
  it.splitsThisShot++;
  const vx = b.vel.x;
  const vy = b.vel.y;
  const parts = Math.max(2, ctx.relic.splitParts);
  // angles répartis de +θ à −θ ; la balle d'origine prend +θ (k = 0)
  for (let k = parts - 1; k >= 0; k--) {
    let c: number;
    let sn: number;
    const f = 1 - (2 * k) / (parts - 1);
    if (f === 1 || f === -1) {
      c = ctx.splitCos;
      sn = f * ctx.splitSin;
    } else {
      const a = f * Math.atan2(ctx.splitSin, ctx.splitCos);
      c = Math.cos(a);
      sn = Math.sin(a);
    }
    const nb = k === 0 ? b : acquireBall(ctx);
    if (nb !== b) {
      nb.element = b.element;
      nb.tier = b.tier;
      nb.combo = b.combo;
      nb.triggered = true;
      nb.golden = false; // les filles d'une balle dorée ne sont pas dorées
      nb.radius = b.radius;
      nb.pos.x = b.pos.x;
      nb.pos.y = b.pos.y;
    }
    nb.vel.x = vx * c - vy * sn;
    nb.vel.y = vx * sn + vy * c;
  }
  emit(ctx, { type: 'ball:split', pos: { x: b.pos.x, y: b.pos.y }, element: 'split' });
}

export const splitHooks: ElementHooks = {
  onBlockHit(ctx, b) {
    if (!b.triggered) split(ctx, b);
  },
};

/**
 * Essaim : à chaque impact, `chance` de libérer une mini-balle « pierre » (dégâts × damageMult, rayon × radiusMult)
 * déviée de ±spreadDeg, au plus maxPerShot par balle d'essaim et par tir (et dans le plafond maxLiveBalls).
 */
export const swarm: ElementHooks = {
  params: ['chance', 'maxPerShot', 'damageMult', 'radiusMult', 'spreadDeg'],
  onBlockHit(ctx, b, fx) {
    if (fx.spawned >= prm(ctx, 'swarm', 'maxPerShot', b.tier) || !liveRoom(ctx)) return;
    if (!ctx.rng.chance(prm(ctx, 'swarm', 'chance', b.tier))) return;
    const spread = prm(ctx, 'swarm', 'spreadDeg', b.tier) * DEG;
    const a = ctx.rng.range(-spread, spread);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const nb = spawnMini(
      ctx,
      b,
      'stone',
      b.pos.x,
      b.pos.y,
      b.vel.x * c - b.vel.y * sn,
      b.vel.x * sn + b.vel.y * c,
      prm(ctx, 'swarm', 'damageMult', b.tier),
      prm(ctx, 'swarm', 'radiusMult', b.tier),
    );
    if (!nb) return;
    fx.spawned++;
    emit(ctx, { type: 'ball:split', pos: { x: b.pos.x, y: b.pos.y }, element: 'swarm' });
  },
};

/**
 * Jumelle : la balle de la volée part en `count` balles réparties sur ±angleDeg autour de sa direction, chacune
 * × damageMult. Elle garde la première direction (et la dorure) ; les autres sont des mini-balles « jumelle ».
 */
export const twin: ElementHooks = {
  params: ['count', 'angleDeg', 'damageMult'],
  onLaunch(ctx, b, fx) {
    const n = Math.max(1, Math.round(prm(ctx, 'twin', 'count', b.tier)));
    const mult = prm(ctx, 'twin', 'damageMult', b.tier);
    fx.dmgMult *= mult;
    if (n < 2) return;
    const half = prm(ctx, 'twin', 'angleDeg', b.tier) * DEG;
    const vx = b.vel.x;
    const vy = b.vel.y;
    for (let k = n - 1; k >= 0; k--) {
      const a = half * ((2 * k) / (n - 1) - 1);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const rx = vx * c - vy * sn;
      const ry = vx * sn + vy * c;
      if (k === 0) {
        b.vel.x = rx;
        b.vel.y = ry;
        fixVelocity(ctx, b, fx); // angle minimal
        continue;
      }
      const nb = spawnMini(ctx, b, 'twin', b.pos.x, b.pos.y, rx, ry, mult, 1);
      if (!nb) continue;
      emit(ctx, { type: 'ball:launched', ballId: nb.id, element: nb.element, tier: nb.tier, pos: { x: nb.pos.x, y: nb.pos.y }, golden: false });
    }
    emit(ctx, { type: 'ball:split', pos: { x: b.pos.x, y: b.pos.y }, element: 'twin' });
  },
};
