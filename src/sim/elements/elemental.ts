// sim/elements/elemental.ts — famille « elemental » : feu, foudre, glace (d'origine), acide, comète.
import type { Block } from '../../core/types';
import type { Ctx } from '../ctx';
import { emit, isBreakable } from '../ctx';
import { bumpCombo, chainLightning, damageBlock, explode } from '../combat';
import type { ElementHooks } from './types';
import { blockIndex, centerX, centerY, prm } from './common';

/** Feu : explose au premier impact (balls.fire), pyromane : rayon et braises. */
export const fire: ElementHooks = {
  onBlockHit(ctx, b, _fx, bi, _blk, px, py, dmg) {
    if (b.triggered) return;
    b.triggered = true;
    const f = ctx.cfg.balls.fire;
    explode(ctx, px, py, f.radius * ctx.relic.bigboom * ctx.relic.pyroRadius, dmg * f.damageRatio, 'fire', bi, ctx.relic.emberRatio > 0, 'fire');
  },
};

/** Foudre : chaque impact frappe aussi le bloc le plus proche (balls.lightning, paratonnerre). */
export const lightning: ElementHooks = {
  onBlockHit(ctx, _b, _fx, bi, _blk, px, py, dmg) {
    chainLightning(ctx, px, py, bi, dmg * ctx.cfg.balls.lightning.damageRatio);
  },
};

/** Glace : gèle au premier impact de la balle (cheville comprise), au plus maxFrozenPerShot blocs par tir. */
export const ice: ElementHooks = {
  onBlockHit(ctx, b, _fx, _bi, blk, _px, _py, _dmg, isPeg) {
    const s = ctx.s;
    if (!isPeg && !b.triggered) {
      b.triggered = true;
      const it = s.internal;
      const thawed = it.thawedIds;
      if (
        isBreakable(blk) &&
        !blk.frozen &&
        !(thawed && thawed.includes(blk.id)) &&
        (it.frozenThisShot ?? 0) < ctx.cfg.balls.ice.maxFrozenPerShot
      ) {
        it.frozenThisShot = (it.frozenThisShot ?? 0) + 1;
        blk.frozen = true;
        emit(ctx, { type: 'block:frozen', blockId: blk.id, pos: { x: centerX(blk), y: centerY(blk) } });
      }
    }
    b.triggered = true; // une cheville consomme aussi le premier impact
  },
};

/**
 * Acide : chaque impact pose une charge (pctPerTurn % des PV max, `turns` tirs, au plus maxCharges par bloc).
 * Au plafond, la charge la plus usée est rafraîchie. Les charges mordent au début des tirs suivants.
 */
export const acid: ElementHooks = {
  params: ['pctPerTurn', 'turns', 'maxCharges'],
  onBlockHit(ctx, b, _fx, _bi, blk, _px, _py, _dmg, isPeg) {
    if (isPeg || !isBreakable(blk)) return;
    const pct = prm(ctx, 'acid', 'pctPerTurn', b.tier);
    const turns = Math.round(prm(ctx, 'acid', 'turns', b.tier));
    const max = Math.round(prm(ctx, 'acid', 'maxCharges', b.tier));
    if (pct <= 0 || turns <= 0 || max <= 0) return;
    const a = ctx.s.internal.acid;
    let count = 0;
    let weakest = -1;
    for (let k = 0; k + 2 < a.length; k += 3) {
      if (a[k] !== blk.id) continue;
      count++;
      if (weakest < 0 || (a[k + 2] as number) < (a[weakest + 2] as number)) weakest = k;
    }
    if (count < max) {
      a.push(blk.id, pct, turns);
      blk.acidCharges = count + 1;
    } else if (weakest >= 0) {
      a[weakest + 1] = Math.max(a[weakest + 1] as number, pct);
      a[weakest + 2] = turns;
    }
  },
  onShotStart(ctx) {
    const a = ctx.s.internal.acid;
    let k = 0;
    while (k + 2 < a.length) {
      const i = blockIndex(ctx, a[k] as number);
      const blk = i >= 0 ? (ctx.s.blocks[i] as Block) : null;
      if (blk && isBreakable(blk)) {
        damageBlock(ctx, i, ((a[k + 1] as number) / 100) * blk.maxHp, 'acid', 0, false);
        a[k + 2] = (a[k + 2] as number) - 1;
      } else a[k + 2] = 0;
      if ((a[k + 2] as number) <= 0) {
        // swap-remove du triplet
        const last = a.length - 3;
        if (k !== last) {
          a[k] = a[last] as number;
          a[k + 1] = a[last + 1] as number;
          a[k + 2] = a[last + 2] as number;
        }
        a.length = last;
      } else k += 3;
    }
    syncAcidCharges(ctx);
  },
};

/** Block.acidCharges (lu par le renderer) = nombre de charges restantes, recalculé depuis internal.acid. */
function syncAcidCharges(ctx: Ctx): void {
  const blocks = ctx.s.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as Block;
    if (b.acidCharges) b.acidCharges = 0;
  }
  const a = ctx.s.internal.acid;
  for (let k = 0; k + 2 < a.length; k += 3) {
    const i = blockIndex(ctx, a[k] as number);
    const b = i >= 0 ? blocks[i] : undefined;
    if (b) b.acidCharges = (b.acidCharges ?? 0) + 1;
  }
}

/** Comète : vitesse × speedMult ; chaque rebond de plafond donne ceilingCombo de combo. */
export const comet: ElementHooks = {
  params: ['speedMult', 'ceilingCombo'],
  modifyBall(ctx, b, fx) {
    fx.speedMult *= prm(ctx, 'comet', 'speedMult', b.tier);
  },
  onCeilingBounce(ctx, b, fx) {
    bumpCombo(ctx, b, Math.round(prm(ctx, 'comet', 'ceilingCombo', b.tier)), fx);
  },
};
