// sim/rewards.ts — tirages : éléments, reliques, offres de récompense, application d'une option.
import type { BallElement, DropKind, RewardOption } from '../core/types';
import type { Ctx } from './ctx';
import { emit } from './ctx';
import { addRelic } from './relics';
import { addVolleyBall } from './volley';

function elementAllowed(ctx: Ctx, el: BallElement): boolean {
  return el === 'stone' || ctx.meta.unlockedElements.includes(el);
}

/** Élément tiré parmi les débloqués (+ stone), pondéré par weight (> 0). */
export function pickBallElement(ctx: Ctx): BallElement {
  let total = 0;
  for (const d of ctx.cfg.balls.defs) if (d.weight > 0 && elementAllowed(ctx, d.id)) total += d.weight;
  if (total <= 0) return 'stone';
  let r = ctx.rng.next() * total;
  for (const d of ctx.cfg.balls.defs) {
    if (d.weight <= 0 || !elementAllowed(ctx, d.id)) continue;
    r -= d.weight;
    if (r < 0) return d.id;
  }
  return 'stone';
}

export function pickDropKind(ctx: Ctx): DropKind {
  const w = ctx.cfg.blocks.drops.weights;
  let total = 0;
  for (const e of w) total += Math.max(0, e.weight);
  if (total <= 0) return 'coin';
  let r = ctx.rng.next() * total;
  for (const e of w) {
    r -= Math.max(0, e.weight);
    if (r < 0) return e.kind;
  }
  return 'coin';
}

function sameOption(a: RewardOption, b: RewardOption): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'ball':
      return b.kind === 'ball' && a.element === b.element && a.tier === b.tier;
    case 'relic':
      return b.kind === 'relic' && a.relicId === b.relicId;
    default:
      return true;
  }
}

function hasOption(list: readonly RewardOption[], o: RewardOption): boolean {
  for (const x of list) if (sameOption(x, o)) return true;
  return false;
}

/** Relique tirée parmi les débloquées, non possédées, absentes de `exclude`. */
function pickRelic(ctx: Ctx, exclude: readonly RewardOption[]): RewardOption | null {
  const rw = ctx.cfg.relics.rarityWeights;
  let total = 0;
  const ok = (id: string): boolean =>
    ctx.meta.unlockedRelics.includes(id) &&
    !ctx.s.relics.includes(id) &&
    !hasOption(exclude, { kind: 'relic', relicId: id });
  for (const d of ctx.cfg.relics.defs) if (ok(d.id)) total += d.weight * (rw[d.rarity] ?? 1);
  if (total <= 0) return null;
  let r = ctx.rng.next() * total;
  for (const d of ctx.cfg.relics.defs) {
    if (!ok(d.id)) continue;
    r -= d.weight * (rw[d.rarity] ?? 1);
    if (r < 0) return { kind: 'relic', relicId: d.id };
  }
  return null;
}

const MAX_ATTEMPTS = 12;

/**
 * Génère `count` options distinctes : relique avec `relicChance`, sinon balle (rang 1) d'un élément débloqué.
 * Repli si le pool est épuisé : pièces (si autorisé), puis soin.
 */
export function makeOptions(ctx: Ctx, count: number, allowCoins: boolean): RewardOption[] {
  const out: RewardOption[] = [];
  const eco = ctx.cfg.economy;
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let a = 0; a < MAX_ATTEMPTS && !placed; a++) {
      let o: RewardOption | null = null;
      if (ctx.rng.chance(eco.reward.relicChance)) o = pickRelic(ctx, out);
      if (!o) o = { kind: 'ball', element: pickBallElement(ctx), tier: 1 };
      if (!hasOption(out, o)) {
        out.push(o);
        placed = true;
      }
    }
    if (placed) continue;
    const coins: RewardOption = { kind: 'coins', amount: eco.reward.skipCoins };
    const heal: RewardOption = { kind: 'heal', amount: eco.shop.healAmount };
    if (allowCoins && !hasOption(out, coins)) out.push(coins);
    else if (!hasOption(out, heal)) out.push(heal);
  }
  return out;
}

export function heal(ctx: Ctx, amount: number): void {
  const s = ctx.s;
  const before = s.hp;
  s.hp = Math.min(s.maxHp, s.hp + amount);
  const gained = s.hp - before;
  if (gained > 0) emit(ctx, { type: 'player:healed', amount: gained, hpLeft: s.hp });
}

export function applyOption(ctx: Ctx, o: RewardOption): void {
  switch (o.kind) {
    case 'ball':
      addVolleyBall(ctx, o.element, o.tier);
      break;
    case 'relic':
      addRelic(ctx, o.relicId);
      break;
    case 'coins':
      ctx.s.coins += o.amount;
      break;
    case 'heal':
      heal(ctx, o.amount);
      break;
  }
}
