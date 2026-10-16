// ui/lot1.test.ts — fonctions pures du lot 1 (éventail, défi, texte de contrat).
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config';
import { contractText } from './contract';
import { spreadFromDrag, SPREAD_DEAD_PX, SPREAD_RANGE_PX } from './input';
import { readChallenge } from './share';

describe('éventail : longueur du geste → spread', () => {
  it('0 sous 150 px, 1 au-delà de 370 px, linéaire entre', () => {
    expect(spreadFromDrag(0)).toBe(0);
    expect(spreadFromDrag(120)).toBe(0);
    expect(spreadFromDrag(SPREAD_DEAD_PX)).toBe(0);
    expect(spreadFromDrag(SPREAD_DEAD_PX + SPREAD_RANGE_PX / 2)).toBeCloseTo(0.5);
    expect(spreadFromDrag(SPREAD_DEAD_PX + SPREAD_RANGE_PX)).toBe(1);
    expect(spreadFromDrag(1000)).toBe(1);
  });
});

describe('mode défi : lecture de ?seed=&goal=', () => {
  it('lit seed et goal', () => {
    expect(readChallenge('?seed=a%20b&goal=12')).toEqual({ seed: 'a b', goal: 12 });
  });
  it('goal absent ou invalide → null', () => {
    expect(readChallenge('?seed=x').goal).toBeNull();
    expect(readChallenge('?goal=abc').goal).toBeNull();
    expect(readChallenge('').seed).toBeNull();
  });
});

describe('contrats : texte ≤ 40 caractères', () => {
  it('remplace {n} et tient en 40 caractères pour toutes les définitions', () => {
    const cfg = loadConfig();
    for (const d of cfg.contracts.defs) {
      const t = contractText(d, d.target);
      expect(t).not.toContain('{n}');
      expect(t.length).toBeLessThanOrEqual(40);
    }
  });
});
