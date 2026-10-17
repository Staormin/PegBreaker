// ui/balls.test.ts — tables par élément dérivées de config.balls.defs (27 balles + 13 hybrides + Divine).
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config';
import { BALL_FAMILIES, type GameConfig, type RewardOption } from '../core/types';
import { clip } from './dom';
import { elementTable, FAMILY_LABELS, FAMILY_PATHS, groupVolley } from './elements';
import { describeOption } from './options';

const config = loadConfig();

describe('table des éléments', () => {
  it('suit l’ordre du JSON, sans doublon, avec nom, couleur et famille', () => {
    const t = elementTable(config);
    expect(t.list.map((e) => e.id)).toEqual(config.balls.defs.map((d) => d.id));
    expect(t.list.length).toBe(config.balls.defs.length);
    t.list.forEach((e, i) => {
      expect(t.index(e.id)).toBe(i);
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(BALL_FAMILIES).toContain(e.family);
    });
  });
  it('élément inconnu : repli sans planter, rangé après les autres', () => {
    const t = elementTable(config);
    const unknown = 'nope' as never;
    expect(t.index(unknown)).toBe(t.list.length);
    expect(t.get(unknown).name).toBe('nope');
  });
  it('une silhouette et un libellé par famille', () => {
    for (const f of BALL_FAMILIES) {
      expect(FAMILY_PATHS[f].length).toBeGreaterThan(10);
      expect(FAMILY_LABELS[f].length).toBeGreaterThan(0);
    }
    expect(new Set(BALL_FAMILIES.map((f) => FAMILY_PATHS[f])).size).toBe(BALL_FAMILIES.length);
  });
});

describe('descriptions ≤ 60 caractères', () => {
  it('toutes les balles, en carte de récompense', () => {
    for (const d of config.balls.defs) {
      for (const tier of [1, 2, 3] as const) {
        const v = describeOption(config, { kind: 'ball', element: d.id, tier } satisfies RewardOption);
        expect(v.desc.length).toBeLessThanOrEqual(60);
        expect(v.name.startsWith(d.name)).toBe(true);
      }
      const f = describeOption(config, { kind: 'fuse', element: d.id, tier: 3 });
      expect(f.desc.length).toBeLessThanOrEqual(60);
    }
  });
  it('une description trop longue est tronquée sur un mot, avec …', () => {
    const long = 'Le bloc touché perd 6 % de ses PV max au début de chacun des 3 tirs suivants.';
    const cfg: GameConfig = { ...config, balls: { ...config.balls, defs: config.balls.defs.map((d) => (d.id === 'acid' ? { ...d, description: long } : d)) } };
    const desc = elementTable(cfg).get('acid').desc;
    expect(desc.length).toBeLessThanOrEqual(60);
    expect(desc.endsWith('…')).toBe(true);
    expect(long.startsWith(desc.slice(0, -1))).toBe(true);
    expect(clip(long)).toBe(desc);
  });
});

describe('regroupement de la volée', () => {
  it('par (élément, rang), rang décroissant puis ordre du JSON', () => {
    const g = groupVolley(config, [
      { element: 'lucky', tier: 1 },
      { element: 'fire', tier: 1 },
      { element: 'lucky', tier: 1 },
      { element: 'acid', tier: 2 },
      { element: 'stone', tier: 1 },
    ]);
    expect(g).toEqual([
      { element: 'acid', tier: 2, count: 1 },
      { element: 'stone', tier: 1, count: 1 },
      { element: 'fire', tier: 1, count: 1 },
      { element: 'lucky', tier: 1, count: 2 },
    ]);
  });
});
