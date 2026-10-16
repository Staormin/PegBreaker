// ui/lot1.test.ts — fonctions pures du lot 1 (éventail, défi, texte de contrat).
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config';
import { contractText } from './contract';
import { createSpreadControl, cycleLevel, SPREAD_VALUES } from './spread';
import { readChallenge } from './share';

describe('sélecteur d’ouverture (3 positions)', () => {
  it('valeurs 0 / 0,5 / 1 et cycle en boucle dans les deux sens', () => {
    expect(SPREAD_VALUES).toEqual([0, 0.5, 1]);
    expect(cycleLevel(0)).toBe(1);
    expect(cycleLevel(2)).toBe(0);
    expect(cycleLevel(0, -1)).toBe(2);
  });
  it('persistant entre les tirs, remis à 0 par reset, notifie les changements', () => {
    const c = createSpreadControl();
    const seen: number[] = [];
    c.onChange((l) => seen.push(l));
    expect(c.value).toBe(0);
    c.cycle();
    c.cycle();
    expect(c.level).toBe(2);
    expect(c.value).toBe(1);
    c.reset();
    expect(c.value).toBe(0);
    c.reset(); // déjà à 0 : pas de notification
    expect(seen).toEqual([1, 2, 0]);
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
