// ui/hybrids.test.ts — hybrides et Divine : couleurs des parents, effet propre, prix, codex.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config';
import { elementTable } from './elements';
import { catalystRecipe, codexEntries, isForged, ownEffect, recipeHint, recipeLabel, sellPrice, upgradeCost } from './hybrids';

const config = loadConfig();
const t = elementTable(config);

describe('hybrides', () => {
  it('13 hybrides + Divine au codex, hybrides avant la Divine', () => {
    const ids = codexEntries(config);
    expect(ids.length).toBe(14);
    expect(ids[ids.length - 1]).toBe('divine');
    for (const id of ids) expect(isForged(config, id)).toBe(true);
    expect(isForged(config, 'fire')).toBe(false);
  });
  it('une hybride porte les couleurs de ses deux parents', () => {
    const steam = t.get('steam');
    expect(steam.family).toBe('hybrid');
    expect(steam.recipe).toEqual(['fire', 'ice']);
    expect(steam.colors).toEqual([t.get('fire').color, t.get('ice').color]);
    expect(t.get('divine').family).toBe('divine');
  });
  it('effet propre non vide et ≤ 60 caractères à chaque rang', () => {
    for (const id of codexEntries(config)) {
      for (const tier of [1, 2, 3] as const) {
        const e = ownEffect(config, id, tier);
        expect(e.length).toBeGreaterThan(5);
        expect(e.length).toBeLessThanOrEqual(60);
        expect(e).not.toMatch(/undefined|NaN/);
      }
    }
    const ratio = config.balls.defs.find((d) => d.id === 'steam')?.params?.['cloudRatio'];
    const pctOf = (r: number): string => `${String(Math.round(r * 10000) / 100).replace('.', ',')} %`;
    if (ratio) {
      expect(ownEffect(config, 'steam', 1)).toContain(pctOf(ratio[0]));
      expect(ownEffect(config, 'steam', 3)).toContain(pctOf(ratio[2]));
    }
  });
  it('prix de vente et coût d’upgrade depuis economy', () => {
    const { sell, forge } = config.economy;
    expect(sellPrice(config, { element: 'fire', tier: 2 })).toBe(sell.byTier[1]);
    expect(sellPrice(config, { element: 'steam', tier: 3 })).toBe(sell.hybridByTier[2]);
    expect(sellPrice(config, { element: 'divine', tier: 1 })).toBe(sell.divine);
    expect(upgradeCost(config, { element: 'steam', tier: 1 })).toBe(forge.upgradeCost[0]);
    expect(upgradeCost(config, { element: 'steam', tier: 2 })).toBe(forge.upgradeCost[1]);
    expect(upgradeCost(config, { element: 'steam', tier: 3 })).toBeNull();
    expect(upgradeCost(config, { element: 'fire', tier: 1 })).toBeNull();
    expect(upgradeCost(config, { element: 'divine', tier: 1 })).toBeNull();
  });
  it('indices du codex : familles des parents', () => {
    expect(recipeHint(config, 'steam')).toBe('élémentaire + élémentaire');
    expect(recipeHint(config, 'divine')).toBe('hybride III + hybride III');
    expect(recipeLabel(config, 'steam')).toBe(`${t.get('fire').name} III + ${t.get('ice').name} III`);
  });
});

describe('catalyseur', () => {
  it('déduit partenaire et hybride, en préférant le partenaire présent dans la volée', () => {
    expect(catalystRecipe(config, 'ice', [{ element: 'fire', tier: 3 }])).toEqual({ partner: 'fire', result: 'steam' });
    // acide : abysse (vide) ou peste (vampire) ; vampire dans la volée → peste
    expect(catalystRecipe(config, 'acid', [{ element: 'vampire', tier: 3 }])).toEqual({ partner: 'vampire', result: 'plague' });
    expect(catalystRecipe(config, 'acid', [{ element: 'void', tier: 2 }])).toEqual({ partner: 'void', result: 'abyss' });
    expect(catalystRecipe(config, 'stone', [])).toBeNull();
  });
});
