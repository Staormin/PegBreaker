// sim/elements/heavy.ts — famille « heavy » : plomb (d'origine), géante, bombe, choc.
import type { Ctx } from '../ctx';
import { isBreakable } from '../ctx';
import { ballDamage, explode } from '../combat';
import { cellFree } from '../waves';
import type { ElementHooks } from './types';
import { prm, setAttrib } from './common';

/** Plomb : dégâts × lead.damageMultiplier, jamais de combo ; enclume : onde de choc en zone. */
export const lead: ElementHooks = {
  noCombo: true,
  modifyDamage(ctx, _b, _fx, dmg) {
    return dmg * ctx.cfg.balls.lead.damageMultiplier;
  },
  onBlockHit(ctx, _b, _fx, bi, _blk, px, py, dmg) {
    if (ctx.relic.anvilRatio > 0 && ctx.relic.anvilRadius > 0) {
      explode(ctx, px, py, ctx.relic.anvilRadius * ctx.relic.bigboom, dmg * ctx.relic.anvilRatio, 'lead', bi, false, 'lead');
    }
  },
};

/** Géante : rayon × radiusMult, vitesse × speedMult, dégâts × damageMult, aucun combo de mur (ricochet). */
export const giant: ElementHooks = {
  params: ['radiusMult', 'damageMult', 'speedMult'],
  noWallCombo: true,
  modifyBall(ctx, b, fx) {
    b.radius *= prm(ctx, 'giant', 'radiusMult', b.tier);
    fx.speedMult *= prm(ctx, 'giant', 'speedMult', b.tier);
  },
  modifyDamage(ctx, b, _fx, dmg) {
    return dmg * prm(ctx, 'giant', 'damageMult', b.tier);
  },
};

/** Bombe : explose en touchant le sol (rayon × bigboom), dégâts = damageMult × dégâts de base (combo remis à 0). */
export const bomb: ElementHooks = {
  params: ['radius', 'damageMult'],
  onGrounded(ctx, b, fx) {
    const radius = prm(ctx, 'bomb', 'radius', b.tier) * ctx.relic.bigboom;
    const dmg = ballDamage(ctx, b, null, fx) * prm(ctx, 'bomb', 'damageMult', b.tier);
    if (radius <= 0 || dmg <= 0) return;
    const pb = ctx.curBall;
    const pf = ctx.curFx;
    const pid = ctx.curBallId;
    const pg = ctx.curGolden;
    setAttrib(ctx, b, fx, b.id, b.golden);
    explode(ctx, b.pos.x, ctx.cfg.blocks.board.rows, radius, dmg, 'bomb', -1, false, 'bomb');
    setAttrib(ctx, pb, pf, pid, pg);
  },
};

/** Compteur de reculs du bloc `id` pendant ce tir (internal.shocked = paires [id, n]) ; −1 = absent. */
function shockSlot(ctx: Ctx, id: number): number {
  const a = ctx.s.internal.shocked;
  for (let k = 0; k + 1 < a.length; k += 2) if (a[k] === id) return k;
  return -1;
}

/** Choc : le bloc touché remonte d'une rangée si la place est libre et row > 0, au plus perBlock fois par bloc et par tir. */
export const shock: ElementHooks = {
  params: ['perBlock'],
  onBlockHit(ctx, b, _fx, _bi, blk, _px, _py, _dmg, isPeg) {
    if (isPeg || !isBreakable(blk) || blk.row <= 0) return;
    const max = Math.round(prm(ctx, 'shock', 'perBlock', b.tier));
    const a = ctx.s.internal.shocked;
    let k = shockSlot(ctx, blk.id);
    if (k >= 0 && (a[k + 1] as number) >= max) return;
    if (max <= 0) return;
    for (let c = blk.col; c < blk.col + blk.width; c++) if (!cellFree(ctx, c, blk.row - 1)) return;
    if (k < 0) {
      a.push(blk.id, 0);
      k = a.length - 2;
    }
    a[k + 1] = (a[k + 1] as number) + 1;
    blk.row--;
    ctx.gridDirty = true;
  },
  onShotStart(ctx) {
    ctx.s.internal.shocked.length = 0;
  },
};
