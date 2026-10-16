// ui/lot2.test.ts — fonctions pures du lot 2 (F8 : calendrier, multiplicateurs, mutateurs).
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config';
import { fmtDays, fmtMult, lastDays, modView } from './dailyInfo';

describe('quotidien : calendrier et formats', () => {
  it('7 derniers jours, du plus ancien à aujourd’hui, à travers un changement de mois', () => {
    expect(lastDays('2026-03-03', 7)).toEqual(['2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03']);
  });
  it('multiplicateurs et jours', () => {
    expect(fmtMult(1.5 * 1.3)).toBe('×1,95');
    expect(fmtMult(2)).toBe('×2');
    expect(fmtDays(1)).toBe('1 jour');
    expect(fmtDays(4)).toBe('4 jours');
  });
  it('chaque mutateur éligible a un nom, une description et une icône', () => {
    const config = loadConfig();
    for (const m of config.meta.runMods.filter((d) => d.dailyEligible)) {
      const v = modView(config, m.id);
      expect(v.name.length).toBeGreaterThan(0);
      expect(v.description.length).toBeLessThanOrEqual(60);
      expect(v.glyph).not.toBe('✦');
    }
  });
});
