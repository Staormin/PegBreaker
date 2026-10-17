// ui/shopModel.test.ts — boutique (docs/SHOP-UI.md) : tri des tuiles, sélection, forge, actions du détail.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config';
import type { BallElement, BallTier, VolleyBall } from '../core/types';
import { sellPrice, upgradeCost } from './hybrids';
import { dedupForge, detailActions, groupKey, pickSelection, roman, shopGroups } from './shopModel';

const config = loadConfig();
const B = (element: BallElement, tier: BallTier, n = 1): VolleyBall[] => Array.from({ length: n }, () => ({ element, tier }));

describe('tuiles de la volée', () => {
  it('groupées par (élément, rang) ; Divine, hybrides, puis rang décroissant, puis ordre du JSON', () => {
    const volley = [...B('stone', 1, 3), ...B('fire', 1), ...B('steam', 1), ...B('ice', 3), ...B('divine', 1), ...B('fire', 2), ...B('laser', 3), ...B('stone', 1)];
    const g = shopGroups(config, volley);
    expect(g.map((x) => groupKey(x))).toEqual(['divine|1', 'laser|3', 'steam|1', 'ice|3', 'fire|2', 'stone|1', 'fire|1']);
    const stone = g.find((x) => x.element === 'stone');
    expect(stone?.indices).toEqual([0, 1, 2, 9]);
    expect(g.reduce((n, x) => n + x.indices.length, 0)).toBe(volley.length);
  });
  it('29 balles mélangées : chaque balle dans exactement un groupe', () => {
    const volley = [...B('divine', 1), ...B('supernova', 2), ...B('steam', 1, 2), ...B('fire', 3), ...B('ice', 2, 2), ...B('lightning', 1, 3), ...B('stone', 1, 5), ...B('split', 1, 2), ...B('acid', 1, 12)];
    expect(volley.length).toBe(29);
    const seen = shopGroups(config, volley).flatMap((x) => x.indices).sort((a, b) => a - b);
    expect(seen).toEqual(volley.map((_, i) => i));
  });
});

describe('sélection', () => {
  const groups = shopGroups(config, [...B('fire', 2), ...B('ice', 1), ...B('stone', 1)]);
  it('par défaut la première tuile', () => {
    expect(pickSelection(groups, null, 0)).toBe(0);
    expect(pickSelection([], null, 0)).toBe(-1);
  });
  it('conserve la clé si le groupe existe encore, sinon la même position bornée', () => {
    expect(groups.map((x) => groupKey(x))).toEqual(['fire|2', 'stone|1', 'ice|1']);
    expect(pickSelection(groups, 'ice|1', 0)).toBe(2);
    expect(pickSelection(groups, 'bomb|1', 1)).toBe(1);
    expect(pickSelection(groups, 'bomb|1', 9)).toBe(2);
  });
});

describe('forge', () => {
  it('une rangée par paire d’éléments', () => {
    const v = [...B('fire', 2, 3), ...B('ice', 1)];
    const opts = [
      { i: 0, j: 3, result: 'steam' as BallElement, cost: 25 },
      { i: 1, j: 3, result: 'steam' as BallElement, cost: 25 },
      { i: 2, j: 9, result: 'steam' as BallElement, cost: 25 },
    ];
    expect(dedupForge(v, opts)).toEqual([opts[0]]);
  });
});

describe('panneau détail', () => {
  it('vendre, vendre tout (N ≥ 2), pas d’upgrade sur une balle de base', () => {
    const v = [...B('stone', 1, 3), ...B('fire', 1)];
    const g = shopGroups(config, v).find((x) => x.element === 'stone');
    if (!g) throw new Error('groupe');
    const a = detailActions(config, g, v, []);
    const p = sellPrice(config, { element: 'stone', tier: 1 });
    expect(a.sell).toEqual({ index: 0, gain: p, disabled: false });
    expect(a.sellAll).toEqual({ count: 3, gain: 3 * p, all: true });
    expect(a.upgrade).toBeNull();
    expect(a.forgeWith).toBeNull();
  });
  it('toute la volée dans un groupe : la dernière balle reste', () => {
    const v = B('stone', 1, 3);
    const g = shopGroups(config, v)[0];
    if (!g) throw new Error('groupe');
    const a = detailActions(config, g, v, []);
    expect(a.sellAll?.count).toBe(2);
    expect(a.sellAll?.all).toBe(false);
  });
  it('dernière balle : vente désactivée, pas de « vendre tout »', () => {
    const v = B('stone', 1);
    const g = shopGroups(config, v)[0];
    if (!g) throw new Error('groupe');
    const a = detailActions(config, g, v, []);
    expect(a.sell.disabled).toBe(true);
    expect(a.sellAll).toBeNull();
  });
  it('hybride < III : « Rang +1 » ; III : non', () => {
    const v = [...B('steam', 2), ...B('laser', 3)];
    const [laser, steam] = shopGroups(config, v);
    if (!laser || !steam) throw new Error('groupes');
    expect(detailActions(config, steam, v, []).upgrade).toEqual({ index: 0, cost: upgradeCost(config, { element: 'steam', tier: 2 }) });
    expect(detailActions(config, laser, v, []).upgrade).toBeNull();
  });
  it('« Forger avec … » : partenaire de la recette ouverte', () => {
    const v = [...B('fire', 2), ...B('ice', 1), ...B('stone', 1)];
    const opts = [{ i: 0, j: 1, result: 'steam' as BallElement, cost: 25 }];
    const groups = shopGroups(config, v);
    const fire = groups.find((x) => x.element === 'fire');
    const ice = groups.find((x) => x.element === 'ice');
    const stone = groups.find((x) => x.element === 'stone');
    if (!fire || !ice || !stone) throw new Error('groupes');
    expect(detailActions(config, fire, v, opts).forgeWith?.partner).toBe('ice');
    expect(detailActions(config, ice, v, opts).forgeWith?.partner).toBe('fire');
    expect(detailActions(config, stone, v, opts).forgeWith).toBeNull();
  });
  it('rangs en chiffres romains', () => {
    expect([roman(1), roman(2), roman(3)]).toEqual(['I', 'II', 'III']);
  });
});
