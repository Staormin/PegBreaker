// sim/elements/arcane.ts — famille « arcane » : pierre (d'origine), prisme, vide, cristal, nova, rouille.
import { emit, isBreakable } from '../ctx';
import type { Block } from '../../core/types';
import { ballDamage, damageBlock, explode } from '../combat';
import type { ElementHooks } from './types';
import { DEG, centerX, centerY, prm, setAttrib, spawnMini } from './common';

/** Pierre : aucune mécanique. */
export const stone: ElementHooks = {};

/** Prisme : à chaque rebond de mur latéral, un rayon inflige rowRatio × ses dégâts (plafonnés à cap) à chaque bloc de sa rangée. */
export const prism: ElementHooks = {
  params: ['rowRatio', 'cap'],
  onWallBounce(ctx, b, fx, wallX) {
    const row = Math.floor(b.pos.y);
    const dmg = Math.min(ballDamage(ctx, b, null, fx) * prm(ctx, 'prism', 'rowRatio', b.tier), prm(ctx, 'prism', 'cap', b.tier));
    if (dmg <= 0) return;
    const blocks = ctx.s.blocks;
    const n = blocks.length;
    const pb = ctx.curBall;
    const pf = ctx.curFx;
    const pid = ctx.curBallId;
    const pg = ctx.curGolden;
    setAttrib(ctx, b, fx, b.id, b.golden);
    for (let i = 0; i < n; i++) {
      const t = blocks[i] as Block;
      if (t.row !== row || !isBreakable(t)) continue;
      emit(ctx, { type: 'lightning:chain', from: { x: wallX, y: b.pos.y }, to: { x: centerX(t), y: centerY(t) }, damage: dmg, element: 'prism' });
      damageBlock(ctx, i, dmg, 'prism', b.combo, false);
    }
    setAttrib(ctx, pb, pf, pid, pg);
  },
};

/** Vide : ignore l'armure ; chaque impact ajoute pctMaxHp % des PV max du bloc, au plus `cap`. */
export const voidHooks: ElementHooks = {
  params: ['pctMaxHp', 'cap'],
  modifyDamage(ctx, b, _fx, dmg, target) {
    if (!target) return dmg;
    ctx.hit.ignoreArmor = true;
    return dmg + Math.min((prm(ctx, 'void', 'pctMaxHp', b.tier) / 100) * target.maxHp, prm(ctx, 'void', 'cap', b.tier));
  },
};

/** Rouille : au premier contact avec un bloc, il perd son armure et pctMaxHp % de ses PV max (au plus `cap`), définitivement. */
export const rust: ElementHooks = {
  params: ['pctMaxHp', 'cap'],
  modifyDamage(ctx, b, _fx, dmg, target) {
    if (!target || !isBreakable(target)) return dmg;
    const rusted = ctx.s.internal.rusted;
    if (rusted.includes(target.id)) return dmg;
    rusted.push(target.id);
    if (target.kind === 'armored') {
      target.kind = 'normal';
      target.armorSide = 'none';
    }
    const loss = Math.min((prm(ctx, 'rust', 'pctMaxHp', b.tier) / 100) * target.maxHp, prm(ctx, 'rust', 'cap', b.tier));
    target.maxHp = Math.max(1, Math.round(target.maxHp - loss));
    return dmg + loss;
  },
  onShotStart(ctx) {
    // élagage : ids des blocs disparus
    const r = ctx.s.internal.rusted;
    let k = 0;
    while (k < r.length) {
      let alive = false;
      for (let i = 0; i < ctx.s.blocks.length && !alive; i++) if ((ctx.s.blocks[i] as Block).id === r[k]) alive = true;
      if (alive) k++;
      else {
        r[k] = r[r.length - 1] as number;
        r.length--;
      }
    }
  },
};

/** Cristal : +perBouncePct % de dégâts par rebond ; après `bounces` rebonds, éclate en `shards` mini-balles × shardMult (éventail ±shardSpreadDeg). */
export const crystal: ElementHooks = {
  params: ['perBouncePct', 'bounces', 'shards', 'shardMult', 'shardRadiusMult', 'shardSpreadDeg'],
  modifyDamage(ctx, b, fx, dmg) {
    return dmg * (1 + (prm(ctx, 'crystal', 'perBouncePct', b.tier) / 100) * fx.bounces);
  },
  onBounce(ctx, b, fx) {
    fx.bounces++;
    if (fx.bounces < prm(ctx, 'crystal', 'bounces', b.tier)) return;
    b.alive = false; // libérée en fin de sous-pas ; pas de ball:grounded (elle éclate en vol)
    emit(ctx, { type: 'ball:split', pos: { x: b.pos.x, y: b.pos.y }, element: 'crystal' });
    const n = Math.round(prm(ctx, 'crystal', 'shards', b.tier));
    const mult = prm(ctx, 'crystal', 'shardMult', b.tier);
    const rm = prm(ctx, 'crystal', 'shardRadiusMult', b.tier);
    // éventail de ±shardSpreadDeg autour de la vitesse (réfléchie) de la balle
    const half = prm(ctx, 'crystal', 'shardSpreadDeg', b.tier) * DEG;
    const base = Math.atan2(b.vel.y, b.vel.x);
    const sp = Math.hypot(b.vel.x, b.vel.y);
    for (let k = 0; k < n; k++) {
      const a = n > 1 ? base + half * ((2 * k) / (n - 1) - 1) : base;
      spawnMini(ctx, b, 'stone', b.pos.x, b.pos.y, Math.cos(a) * sp, Math.sin(a) * sp, mult, rm);
    }
  },
};

/** Nova : à chaque palier de combo, explose (rayon × bigboom) ; dégâts = combo × comboMult (× éventail), au plus `cap`. */
export const nova: ElementHooks = {
  params: ['radius', 'comboMult', 'cap'],
  onComboMilestone(ctx, b, fx, _level, combo) {
    const radius = prm(ctx, 'nova', 'radius', b.tier) * ctx.relic.bigboom;
    const dmg = Math.min(combo * prm(ctx, 'nova', 'comboMult', b.tier) * (ctx.s.internal.shotDamageMult ?? 1), prm(ctx, 'nova', 'cap', b.tier));
    if (radius <= 0 || dmg <= 0) return;
    const pb = ctx.curBall;
    const pf = ctx.curFx;
    const pid = ctx.curBallId;
    const pg = ctx.curGolden;
    setAttrib(ctx, b, fx, b.id, b.golden);
    explode(ctx, b.pos.x, b.pos.y, radius, dmg, 'nova', -1, false, 'nova');
    setAttrib(ctx, pb, pf, pid, pg);
  },
};
