// sim/shop.ts — boutique (economy.json → shop).
import type { BallElement, BallTier, RewardOption, ShopItem, ShopState, VolleyBall } from '../core/types';
import type { Ctx } from './ctx';
import { ballDef, emit } from './ctx';
import { applyOption, elementAllowed, makeOptions } from './rewards';
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
    case 'fuse':
      return p.ball; // décision architecte : réutilise le prix d'une balle
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

/** Articles : (itemCount − 1) tirages balle/relique distincts (dont une fusion si une paire existe) + un soin. */
function makeItems(ctx: Ctx): ShopItem[] {
  const n = Math.max(1, ctx.cfg.economy.shop.itemCount);
  const opts = makeOptions(ctx, n - 1, false, 'always');
  const items: ShopItem[] = opts.map((option) => ({ option, price: Math.round(priceOf(ctx, option)), sold: false }));
  const heal: RewardOption = { kind: 'heal', amount: ctx.cfg.economy.shop.healAmount };
  if (!opts.some((o) => o.kind === 'heal')) items.push({ option: heal, price: Math.round(priceOf(ctx, heal)), sold: false });
  addCatalyst(ctx, items);
  return items;
}

// ----------------------------------------------------------------------------------------------------------
// Forge (docs/HYBRIDS.md) : vente, catalyseur, hybrides, Divine, upgrade.

/** Rang minimal des parents d'une hybride (II) et des hybrides d'une Divine (III). */
const HYBRID_PARENT_MIN_TIER = 2;
const DIVINE_PARENT_TIER = 3;
const MAX_TIER = 3;

function familyOf(ctx: Ctx, el: BallElement): string {
  return ballDef(ctx, el).family;
}

/** Hybride produite par deux éléments de base (recette, ordre indifférent), null sinon. */
export function recipeResult(ctx: Ctx, a: BallElement, b: BallElement): BallElement | null {
  if (a === b) return null;
  for (const d of ctx.cfg.balls.defs) {
    const r = d.recipe;
    if (r && ((r[0] === a && r[1] === b) || (r[0] === b && r[1] === a))) return d.id;
  }
  return null;
}

/** Résultat et coût de la forge de deux balles de la volée, null si impossible. */
function forgeOf(ctx: Ctx, x: VolleyBall, y: VolleyBall): { result: BallElement; cost: number } | null {
  const fx = familyOf(ctx, x.element);
  const fy = familyOf(ctx, y.element);
  const f = ctx.cfg.economy.forge;
  if (fx === 'divine' || fy === 'divine') return null;
  if (fx === 'hybrid' || fy === 'hybrid') {
    if (fx === 'hybrid' && fy === 'hybrid' && x.tier === DIVINE_PARENT_TIER && y.tier === DIVINE_PARENT_TIER) {
      return { result: 'divine', cost: f.divineCost };
    }
    return null;
  }
  if (Math.max(x.tier, y.tier) < HYBRID_PARENT_MIN_TIER) return null; // un parent ≥ II, l'autre ≥ I
  const result = recipeResult(ctx, x.element, y.element);
  return result ? { result, cost: f.hybridCost } : null;
}

/**
 * Forges possibles (i < j, index de la volée telle quelle), sans effet de bord. Une seule paire par combinaison
 * (élément, rang) × (élément, rang) : deux feu II identiques ne produisent pas deux lignes.
 */
export function forgeOptions(ctx: Ctx): { i: number; j: number; result: BallElement; cost: number }[] {
  const out: { i: number; j: number; result: BallElement; cost: number }[] = [];
  const v = ctx.s.volley;
  const seen: string[] = [];
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 1; j < v.length; j++) {
      const a = v[i] as VolleyBall;
      const b = v[j] as VolleyBall;
      const r = forgeOf(ctx, a, b);
      if (!r) continue;
      const ka = `${a.element}:${a.tier}`;
      const kb = `${b.element}:${b.tier}`;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.includes(key)) continue;
      seen.push(key);
      out.push({ i, j, result: r.result, cost: r.cost });
    }
  }
  return out;
}

/** Forge les balles i et j : débite, retire les parents, ajoute le résultat au rang I, émet shop:forged. */
export function forge(ctx: Ctx, i: number, j: number): boolean {
  const s = ctx.s;
  if (s.phase !== 'shop' || i === j) return false;
  const a = s.volley[i];
  const b = s.volley[j];
  if (!a || !b) return false;
  const r = forgeOf(ctx, a, b);
  if (!r || s.coins < r.cost) return false;
  s.coins -= r.cost;
  const hi = Math.max(i, j);
  const lo = Math.min(i, j);
  s.volley.splice(hi, 1);
  s.volley.splice(lo, 1);
  s.volley.push({ element: r.result, tier: 1 });
  s.volley.sort(ctx.cmpVolley);
  if (!Array.isArray(s.internal.forged)) s.internal.forged = [];
  s.internal.forged.push(r.result);
  s.stats.forged = (s.stats.forged ?? 0) + 1;
  emit(ctx, {
    type: 'shop:forged',
    result: r.result,
    parents: [a.element, b.element],
    cost: r.cost,
    pos: { x: s.launchPos.x, y: s.launchPos.y },
  });
  return true;
}

/** Monte une hybride d'un rang (I → II → III) contre forge.upgradeCost ; jamais la Divine ni une balle de base. */
export function upgrade(ctx: Ctx, index: number): boolean {
  const s = ctx.s;
  if (s.phase !== 'shop') return false;
  const v = s.volley[index];
  if (!v || familyOf(ctx, v.element) !== 'hybrid' || v.tier >= MAX_TIER) return false;
  const cost = ctx.cfg.economy.forge.upgradeCost[v.tier - 1];
  if (cost === undefined || s.coins < cost) return false;
  s.coins -= cost;
  const tier = (v.tier + 1) as BallTier;
  s.volley[index] = { element: v.element, tier }; // nouvel objet : jamais de mutation d'une entrée partagée
  s.volley.sort(ctx.cmpVolley);
  emit(ctx, { type: 'shop:upgraded', element: v.element, tier, cost });
  return true;
}

/** Pièces rendues par la vente d'une balle (base : byTier, hybride : hybridByTier, Divine : divine). */
export function sellPrice(ctx: Ctx, v: VolleyBall): number {
  const sell = ctx.cfg.economy.sell;
  const fam = familyOf(ctx, v.element);
  if (fam === 'divine') return sell.divine;
  const table = fam === 'hybrid' ? sell.hybridByTier : sell.byTier;
  return table[v.tier - 1] ?? 0;
}

/** Vend volley[index] (jamais la dernière balle) : crédite, retrie, émet shop:sold. Renvoie les pièces, 0 si refusé. */
export function sell(ctx: Ctx, index: number): number {
  const s = ctx.s;
  if (s.phase !== 'shop' || s.volley.length <= 1) return 0;
  const v = s.volley[index];
  if (!v) return 0;
  const coins = sellPrice(ctx, v);
  s.volley.splice(index, 1);
  s.volley.sort(ctx.cmpVolley);
  s.coins += coins;
  emit(ctx, { type: 'shop:sold', element: v.element, tier: v.tier, coins });
  return coins;
}

/**
 * Recettes « ouvertes » : la volée contient un parent (n'importe quel rang) et la forge n'est pas encore possible
 * (aucun exemplaire de l'autre parent au rang ≥ II, et pas de paire « parent ≥ II + autre ≥ I »).
 * Renvoie le partenaire manquant de chacune (débloqué uniquement : la boutique ne propose jamais un élément verrouillé).
 */
export function catalystCandidates(ctx: Ctx): BallElement[] {
  const v = ctx.s.volley;
  const has = (el: BallElement): boolean => v.some((b) => b.element === el && b.tier >= HYBRID_PARENT_MIN_TIER);
  const any = (el: BallElement): boolean => v.some((b) => b.element === el);
  const out: BallElement[] = [];
  for (const d of ctx.cfg.balls.defs) {
    const r = d.recipe;
    if (!r || familyOf(ctx, d.id) !== 'hybrid') continue;
    for (let k = 0; k < 2; k++) {
      const mine = r[k] as BallElement;
      const other = r[1 - k] as BallElement;
      if (any(mine) && !has(other) && !(has(mine) && any(other)) && elementAllowed(ctx, other) && !out.includes(other)) out.push(other);
    }
  }
  return out;
}

/** Catalyseur : remplace le dernier article normal (balle ou relique) par le partenaire manquant au rang II. */
function addCatalyst(ctx: Ctx, items: ShopItem[]): void {
  const cands = catalystCandidates(ctx);
  if (cands.length === 0) return;
  let idx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    const k = (items[i] as ShopItem).option.kind;
    if (k === 'ball' || k === 'relic' || k === 'coins') {
      idx = i;
      break;
    }
  }
  if (idx < 0) return;
  // choix sans consommer le flux aléatoire principal : un catalyseur ne change pas la run d'un joueur qui l'ignore
  const k = ctx.s.depth + (ctx.s.shop?.rerollsUsed ?? 0) + ctx.s.wave;
  const el = cands[k % cands.length] as BallElement;
  items[idx] = { option: { kind: 'ball', element: el, tier: 2 }, price: ctx.cfg.economy.forge.catalystCost, sold: false, catalyst: true };
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
  applyOption(ctx, item.option, 'shop');
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
