// ui/shopModel.ts — modèle pur de la boutique (docs/SHOP-UI.md) : groupes de tuiles, tri, sélection,
// options de forge dédoublonnées et actions du panneau détail. Aucune dépendance au DOM (testable).
import type { BallElement, BallFamily, BallTier, GameConfig, VolleyBall } from '../core/types';
import { elementTable } from './elements';
import { sellPrice, upgradeCost } from './hybrids';

export interface ShopGroup {
  element: BallElement;
  tier: BallTier;
  family: BallFamily;
  /** index dans la volée, croissants */
  indices: number[];
}

export interface ForgeOpt {
  i: number;
  j: number;
  result: BallElement;
  cost: number;
}

/** clé stable d'un groupe (sélection conservée entre deux rendus) */
export const groupKey = (g: { element: BallElement; tier: BallTier }): string => `${g.element}|${g.tier}`;

const FAMILY_RANK = (f: BallFamily): number => (f === 'divine' ? 0 : f === 'hybrid' ? 1 : 2);

/** groupes (élément, rang) triés : Divine, hybrides, puis rang décroissant, puis ordre du JSON */
export function shopGroups(config: GameConfig, volley: readonly Readonly<VolleyBall>[]): ShopGroup[] {
  const t = elementTable(config);
  const map = new Map<string, ShopGroup>();
  volley.forEach((b, i) => {
    const k = groupKey(b);
    const g = map.get(k);
    if (g) g.indices.push(i);
    else map.set(k, { element: b.element, tier: b.tier, family: t.get(b.element).family, indices: [i] });
  });
  return [...map.values()].sort(
    (a, b) => FAMILY_RANK(a.family) - FAMILY_RANK(b.family) || b.tier - a.tier || t.index(a.element) - t.index(b.element),
  );
}

/** une option par paire d'éléments (3 × Feu II + Glace I ne donnent qu'une rangée) */
export function dedupForge(volley: readonly Readonly<VolleyBall>[], options: readonly ForgeOpt[]): ForgeOpt[] {
  const seen = new Set<string>();
  const out: ForgeOpt[] = [];
  for (const o of options) {
    const a = volley[o.i];
    const b = volley[o.j];
    if (!a || !b) continue;
    const key = [a.element, b.element].sort().join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

/** groupe sélectionné : la clé précédente si elle existe encore, sinon même position (bornée), sinon le premier */
export function pickSelection(groups: readonly ShopGroup[], prevKey: string | null, prevPos: number): number {
  if (groups.length === 0) return -1;
  if (prevKey !== null) {
    const k = groups.findIndex((g) => groupKey(g) === prevKey);
    if (k >= 0) return k;
  }
  return Math.max(0, Math.min(prevPos, groups.length - 1));
}

export interface DetailActions {
  sell: { index: number; gain: number; disabled: boolean };
  /** N ≥ 2 : vend `count` balles (jamais la dernière de la volée) */
  sellAll: { count: number; gain: number; all: boolean } | null;
  /** hybride de rang < III */
  upgrade: { index: number; cost: number } | null;
  /** première recette ouverte avec une autre tuile */
  forgeWith: { option: ForgeOpt; partner: BallElement } | null;
}

/** actions du panneau détail pour un groupe */
export function detailActions(
  config: GameConfig,
  g: Readonly<ShopGroup>,
  volley: readonly Readonly<VolleyBall>[],
  forge: readonly ForgeOpt[],
): DetailActions {
  const first = g.indices[0] ?? 0;
  const n = g.indices.length;
  const total = volley.length;
  const gain = sellPrice(config, g);
  const k = Math.min(n, total - 1);
  const up = upgradeCost(config, g);
  let forgeWith: DetailActions['forgeWith'] = null;
  for (const o of forge) {
    const a = volley[o.i];
    const b = volley[o.j];
    if (!a || !b) continue;
    const mine = (x: Readonly<VolleyBall>): boolean => x.element === g.element && x.tier === g.tier;
    if (mine(a)) forgeWith = { option: o, partner: b.element };
    else if (mine(b)) forgeWith = { option: o, partner: a.element };
    if (forgeWith) break;
  }
  return {
    sell: { index: first, gain, disabled: total <= 1 },
    sellAll: n >= 2 && k >= 1 ? { count: k, gain: k * gain, all: k === n } : null,
    upgrade: up === null ? null : { index: first, cost: up },
    forgeWith,
  };
}

const ROMAN: Record<BallTier, string> = { 1: 'I', 2: 'II', 3: 'III' };
export const roman = (t: BallTier): string => ROMAN[t];
