// sim/elements/divine.ts — la Divine (forge : deux hybrides de rang III, docs/HYBRIDS.md).
// Dorée en permanence, rayon × radiusMult, traverse tout, ignore l'armure, nova à chaque rebond, drop garanti,
// +comboPerBounce par rebond, Jugement à l'atterrissage. Paramètres : balls.json → divine.params.
import type { Block } from '../../core/types';
import { emit, isBreakable } from '../ctx';
import { bumpCombo, damageBlock, explode } from '../combat';
import { forceDrop } from '../drops';
import type { ElementHooks } from './types';
import { centerX, centerY, prm, setAttrib } from './common';

export const divine: ElementHooks = {
  passThrough: true,
  alwaysGolden: true,
  params: ['radiusMult', 'novaRadius', 'novaDamage', 'comboPerBounce', 'judgement'],
  modifyBall(ctx, b) {
    b.radius *= prm(ctx, 'divine', 'radiusMult', b.tier);
  },
  modifyDamage(ctx, _b, _fx, dmg, target) {
    if (target) ctx.hit.ignoreArmor = true;
    return dmg;
  },
  onBlockDestroyed(ctx, _b, _fx, _blk, x, y) {
    forceDrop(ctx, x, y);
    return true;
  },
  /** rebond (mur, plafond : elle traverse les blocs) : +comboPerBounce, puis nova de novaDamage (× éventail). */
  onBounce(ctx, b, fx) {
    bumpCombo(ctx, b, Math.round(prm(ctx, 'divine', 'comboPerBounce', b.tier)), fx);
    const radius = prm(ctx, 'divine', 'novaRadius', b.tier) * ctx.relic.bigboom;
    const dmg = prm(ctx, 'divine', 'novaDamage', b.tier) * (ctx.s.internal.shotDamageMult ?? 1);
    if (radius <= 0 || dmg <= 0) return;
    const pb = ctx.curBall;
    const pf = ctx.curFx;
    const pid = ctx.curBallId;
    const pg = ctx.curGolden;
    setAttrib(ctx, b, fx, b.id, b.golden);
    explode(ctx, b.pos.x, b.pos.y, radius, dmg, 'divine', -1, false, 'divine');
    setAttrib(ctx, pb, pf, pid, pg);
  },
  /** Jugement : chaque bloc cassable de la rangée cassable la plus basse prend `judgement` (block:hit puis lightning:chain). */
  onGrounded(ctx, b, fx) {
    const blocks = ctx.s.blocks;
    let low = -1;
    for (let i = 0; i < blocks.length; i++) {
      const t = blocks[i] as Block;
      if (isBreakable(t) && t.row > low) low = t.row;
    }
    const dmg = prm(ctx, 'divine', 'judgement', b.tier) * (ctx.s.internal.shotDamageMult ?? 1);
    if (low < 0 || dmg <= 0) return;
    const gy = ctx.cfg.blocks.board.rows;
    const pb = ctx.curBall;
    const pf = ctx.curFx;
    const pid = ctx.curBallId;
    const pg = ctx.curGolden;
    setAttrib(ctx, b, fx, b.id, b.golden);
    const n = blocks.length;
    for (let i = 0; i < n; i++) {
      const t = blocks[i] as Block;
      if (t.row !== low || !isBreakable(t)) continue;
      const tx = centerX(t);
      const ty = centerY(t);
      damageBlock(ctx, i, dmg, 'divine', 0, false);
      emit(ctx, { type: 'lightning:chain', from: { x: b.pos.x, y: gy }, to: { x: tx, y: ty }, damage: dmg, element: 'divine' });
    }
    setAttrib(ctx, pb, pf, pid, pg);
  },
};
