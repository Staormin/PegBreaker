// sim/elements/greed.ts — famille « greed » : or, chance, aimant, vampire.
import { maybeDrop } from '../drops';
import { heal } from '../rewards';
import type { ElementHooks } from './types';
import { prm } from './common';

/** Or : dégâts × damageMult ; les blocs qu'elle détruit lâchent toujours une pièce de valeur × coinMult. */
export const gold: ElementHooks = {
  params: ['coinMult', 'damageMult'],
  modifyDamage(ctx, b, _fx, dmg) {
    return dmg * prm(ctx, 'gold', 'damageMult', b.tier);
  },
  onBlockDestroyed(ctx, b, _fx, _blk, x, y) {
    maybeDrop(ctx, x, y, prm(ctx, 'gold', 'coinMult', b.tier));
    return true;
  },
};

/** Chance : critChance de critique × critMult par impact (block:hit.crit) ; les drops qu'elle ramasse valent × dropMult. */
export const lucky: ElementHooks = {
  params: ['critChance', 'critMult', 'dropMult'],
  modifyDamage(ctx, b, _fx, dmg, target) {
    if (!target || !ctx.rng.chance(prm(ctx, 'lucky', 'critChance', b.tier))) return dmg;
    ctx.hit.crit = true;
    return dmg * prm(ctx, 'lucky', 'critMult', b.tier);
  },
  onDropCollected(ctx, b) {
    return prm(ctx, 'lucky', 'dropMult', b.tier);
  },
};

/** Aimant : ramasse les drops à moins de `radius` du centre de la balle. */
export const magnet: ElementHooks = {
  params: ['radius'],
  collectRadius(ctx, b) {
    return prm(ctx, 'magnet', 'radius', b.tier);
  },
};

/** Vampire : chaque bloc qu'elle détruit rend healAmount PV, au plus perShot fois par balle et par tir (PV pleins : non compté). */
export const vampire: ElementHooks = {
  params: ['perShot', 'healAmount'],
  onBlockDestroyed(ctx, b, fx, _blk, x, y) {
    const s = ctx.s;
    if (fx.heals < prm(ctx, 'vampire', 'perShot', b.tier) && s.hp < s.maxHp) {
      fx.heals++;
      heal(ctx, prm(ctx, 'vampire', 'healAmount', b.tier), 'vampire', x, y);
    }
    return false;
  },
};
