import { describe, expect, it } from 'vitest';
import { lowestBlockDir, newSim, playRun } from './test-helpers';

describe('sanity d équilibrage', () => {
  it('bot « vise le bloc le plus bas » : la run 1 meurt en moyenne entre la vague 2 et la vague 6', () => {
    const deaths: number[] = [];
    const dmg = new Map<number, number[]>();
    let shots = 0;
    let duration = 0;
    for (let i = 0; i < 10; i++) {
      const sim = newSim(`balance-${i}`);
      const r = playRun(sim, lowestBlockDir, 400);
      expect(sim.state.phase).toBe('gameover');
      deaths.push(r.deathWave);
      shots += r.shots;
      duration += sim.state.stats.durationMs;
      for (const [w, a] of r.dmgByWave) dmg.set(w, [...(dmg.get(w) ?? []), ...a]);
    }
    const avg = deaths.reduce((a, b) => a + b, 0) / deaths.length;
    const mean = (w: number): string => {
      const a = dmg.get(w) ?? [];
      return a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
    };
    console.log(
      `[balance] vagues de mort: ${deaths.join(',')} | moyenne ${avg.toFixed(1)} | tirs/run ${(shots / 10).toFixed(1)} | ` +
        `durée simulée/run ${(duration / 10000).toFixed(0)} s | dégâts/tir v1 ${mean(1)} v3 ${mean(3)} v5 ${mean(5)}`,
    );
    expect(avg).toBeGreaterThanOrEqual(2);
    expect(avg).toBeLessThanOrEqual(6);
  }, 60_000);
});
