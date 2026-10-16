// sim/shop.ts — boutique (economy.json → shop).
import type { RewardOption, ShopItem, ShopState } from '../core/types';
import type { Ctx } from './ctx';
import { emit } from './ctx';
import { applyOption, makeOptions } from './rewards';
import { relicDef } from './relics';

export function priceOf(ctx: Ctx, o: RewardOption): number {
  const p = ctx.cfg.economy.shop.prices;
  switch (o.kind) {
    case 'ball':
      return p.ball * Math.pow(ctx.cfg.balls.tierDamageMultiplier, o.tier - 1);
    case 'relic': {
      const def = relicDef(ctx, o.relicId);
      return def ? p.relicByRarity[def.rarity] : p.relicByRarity.common;
    }
    case 'heal':
      return p.heal;
    case 'coins':
      return 0;
  }
}

/** Coût du prochain reroll : gratuit tant que rerollsUsed < freeRerolls, sinon rerollBase + rerollGrowth × rerollsUsed. */
export function rerollCost(ctx: Ctx, used: number): number {
  if (used < ctx.meta.freeRerolls) return 0;
  const s = ctx.cfg.economy.shop;
  return s.rerollBase + s.rerollGrowth * used;
}

/** Articles : (itemCount − 1) tirages balle/relique distincts + un soin. */
function makeItems(ctx: Ctx): ShopItem[] {
  const n = Math.max(1, ctx.cfg.economy.shop.itemCount);
  const opts = makeOptions(ctx, n - 1, false);
  const items: ShopItem[] = opts.map((option) => ({ option, price: Math.round(priceOf(ctx, option)), sold: false }));
  const heal: RewardOption = { kind: 'heal', amount: ctx.cfg.economy.shop.healAmount };
  if (!opts.some((o) => o.kind === 'heal')) items.push({ option: heal, price: Math.round(priceOf(ctx, heal)), sold: false });
  return items;
}

export function openShop(ctx: Ctx): void {
  const shop: ShopState = { items: makeItems(ctx), rerollCost: rerollCost(ctx, 0), rerollsUsed: 0 };
  ctx.s.shop = shop;
  ctx.s.phase = 'shop';
  emit(ctx, { type: 'shop:opened', shop: structuredClone(shop) });
}

export function buy(ctx: Ctx, index: number): void {
  const s = ctx.s;
  if (s.phase !== 'shop' || !s.shop) return;
  const item = s.shop.items[index];
  if (!item || item.sold || s.coins < item.price) return;
  s.coins -= item.price;
  item.sold = true;
  applyOption(ctx, item.option);
  emit(ctx, { type: 'shop:bought', item: structuredClone(item) });
}

export function reroll(ctx: Ctx): void {
  const s = ctx.s;
  if (s.phase !== 'shop' || !s.shop) return;
  const cost = s.shop.rerollCost;
  if (s.coins < cost) return;
  s.coins -= cost;
  s.shop.rerollsUsed++;
  s.shop.items = makeItems(ctx);
  s.shop.rerollCost = rerollCost(ctx, s.shop.rerollsUsed);
  emit(ctx, { type: 'shop:rerolled', cost });
}
