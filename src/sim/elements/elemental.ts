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

/**
 * Gel d'un bloc, règles de la glace : cassable, pas déjà gelé, pas dégelé au dernier tour, au plus
 * ice.maxFrozenPerShot blocs par tir. Émet block:frozen. Vrai si gelé.
 */
export function tryFreeze(ctx: Ctx, blk: Block): boolean {
  const it = ctx.s.internal;
  const thawed = it.thawedIds;
  if (
    !isBreakable(blk) ||
    blk.frozen ||
    (thawed && thawed.includes(blk.id)) ||
    (it.frozenThisShot ?? 0) >= ctx.cfg.balls.ice.maxFrozenPerShot
  )
    return false;
  it.frozenThisShot = (it.frozenThisShot ?? 0) + 1;
  blk.frozen = true;
  emit(ctx, { type: 'block:frozen', blockId: blk.id, pos: { x: centerX(blk), y: centerY(blk) } });
  return true;
}

/** Glace : gèle au premier impact de la balle (cheville comprise), au plus maxFrozenPerShot blocs par tir. */
export const ice: ElementHooks = {
  onBlockHit(ctx, b, _fx, _bi, blk, _px, _py, _dmg, isPeg) {
    if (!isPeg && !b.triggered) {
      b.triggered = true;
      tryFreeze(ctx, blk);
    }
    b.triggered = true; // une cheville consomme aussi le premier impact
  },
};

/** Pas des charges d'acide dans internal.acidQ : [blockId, pct, toursRestants, plafondParTour]. */
const AQ = 4;

/**
 * Acide : chaque impact pose une charge (pctPerTurn % des PV max, plafonnée à capPerTurn par tour, `turns` tirs,
 * au plus maxCharges par bloc). Au plafond, la charge la plus usée est rafraîchie. Les charges mordent au début
 * des tirs suivants.
 */
export const acid: ElementHooks = {
  params: ['pctPerTurn', 'turns', 'maxCharges', 'capPerTurn'],
  onBlockHit(ctx, b, _fx, _bi, blk, _px, _py, _dmg, isPeg) {
    if (isPeg) return;
    addAcidCharge(
      ctx,
      blk,
      prm(ctx, 'acid', 'pctPerTurn', b.tier),
      Math.round(prm(ctx, 'acid', 'turns', b.tier)),
      Math.round(prm(ctx, 'acid', 'maxCharges', b.tier)),
      prm(ctx, 'acid', 'capPerTurn', b.tier),
    );
  },
  onShotStart(ctx) {
    const a = ctx.s.internal.acidQ;
    let k = 0;
    while (k + AQ - 1 < a.length) {
      const i = blockIndex(ctx, a[k] as number);
      const blk = i >= 0 ? (ctx.s.blocks[i] as Block) : null;
      if (blk && isBreakable(blk)) {
        damageBlock(ctx, i, Math.min(((a[k + 1] as number) / 100) * blk.maxHp, a[k + 3] as number), 'acid', 0, false);
        a[k + 2] = (a[k + 2] as number) - 1;
      } else a[k + 2] = 0;
      if ((a[k + 2] as number) <= 0) {
        // swap-remove du quadruplet
        const last = a.length - AQ;
        if (k !== last) for (let j = 0; j < AQ; j++) a[k + j] = a[last + j] as number;
        a.length = last;
      } else k += AQ;
    }
    syncAcidCharges(ctx);
  },
};

/**
 * Pose une charge d'acide sur `blk` (pct % des PV max par tour, `turns` tours, plafond `cap` par tour), au plus
 * `max` charges par bloc : au plafond, la charge la plus usée est rafraîchie. Vrai si une charge a été posée/rafraîchie.
 */
export function addAcidCharge(ctx: Ctx, blk: Block, pct: number, turns: number, max: number, cap: number): boolean {
  if (!isBreakable(blk) || pct <= 0 || turns <= 0 || max <= 0) return false;
  const a = ctx.s.internal.acidQ;
  let count = 0;
  let weakest = -1;
  for (let k = 0; k + AQ - 1 < a.length; k += AQ) {
    if (a[k] !== blk.id) continue;
    count++;
    if (weakest < 0 || (a[k + 2] as number) < (a[weakest + 2] as number)) weakest = k;
  }
  if (count < max) {
    a.push(blk.id, pct, turns, cap);
    blk.acidCharges = count + 1;
  } else if (weakest >= 0) {
    a[weakest + 1] = Math.max(a[weakest + 1] as number, pct);
    a[weakest + 2] = turns;
    a[weakest + 3] = Math.max(a[weakest + 3] as number, cap);
  } else return false;
  return true;
}

/** Fixe à `cap` le plafond par tour de toutes les charges d'acide du bloc `id` (abysse). */
export function setAcidCap(ctx: Ctx, id: number, cap: number): void {
  const a = ctx.s.internal.acidQ;
  for (let k = 0; k + AQ - 1 < a.length; k += AQ) if (a[k] === id) a[k + 3] = cap;
}

/** Nombre de charges d'acide du bloc `id`. */
export function acidChargesOf(ctx: Ctx, id: number): number {
  const a = ctx.s.internal.acidQ;
  let n = 0;
  for (let k = 0; k + AQ - 1 < a.length; k += AQ) if (a[k] === id) n++;
  return n;
}

/** Reprise : anciennes charges (triplets sans plafond) → quadruplets, plafond du rang I. */
export function migrateAcid(ctx: Ctx): void {
  const it = ctx.s.internal;
  if (!Array.isArray(it.acidQ)) it.acidQ = [];
  const old = it.acid;
  if (Array.isArray(old)) {
    const cap = prm(ctx, 'acid', 'capPerTurn', 1);
    for (let k = 0; k + 2 < old.length; k += 3) it.acidQ.push(old[k] as number, old[k + 1] as number, old[k + 2] as number, cap);
    delete it.acid;
  }
}

/** Block.acidCharges (lu par le renderer) = nombre de charges restantes, recalculé depuis internal.acidQ. */
function syncAcidCharges(ctx: Ctx): void {
  const blocks = ctx.s.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as Block;
    if (b.acidCharges) b.acidCharges = 0;
  }
  const a = ctx.s.internal.acidQ;
  for (let k = 0; k + AQ - 1 < a.length; k += AQ) {
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
