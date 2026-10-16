import { describe, expect, it } from 'vitest';
import type { MetaModifiers } from '../core/types';
import { lowestBlockDir, newSim, ofType, settle, shoot, config } from './test-helpers';

const FULL_META: Partial<MetaModifiers> = {
  bonusHp: 3,
  bonusStartBalls: 2,
  coinMultiplier: 1.3,
  unlockedElements: ['stone', 'fire', 'lightning', 'ice', 'ghost', 'lead', 'split'],
};

/** Temps de visée humain supposé par tir (méthode QA j1). */
const AIM_MS = 1500;

describe('sanity d équilibrage', () => {
  it('sans méta, bot « vise le bloc le plus bas », 10 seeds : mort v4-5, 6-8 tirs/vague, boss v5 tué ≥ 50 %, 1er tir ≥ 2 blocs ≥ 70 %', () => {
    const deaths: number[] = [];
    const dmg = new Map<number, number[]>();
    let bossSeen = 0;
    let bossKilled = 0;
    let firstTwo = 0;
    let cleared = 0;
    let shotsInCleared = 0;
    const firstChoice: number[] = [];
    for (let i = 0; i < 10; i++) {
      const sim = newSim(`balance-${i}`);
      let shots = 0;
      let waveShots = 0;
      let sawBoss = false;
      while (shots < 400 && sim.state.phase !== 'gameover') {
        settle(sim);
        const w = sim.state.wave;
        if (w === 5 && !sawBoss && sim.state.blocks.some((b) => b.kind === 'boss')) {
          sawBoss = true;
          bossSeen++;
        }
        const evs = shoot(sim, lowestBlockDir(sim));
        shots++;
        waveShots++;
        if (shots === 1 && ofType(evs, 'block:destroyed').length >= 2) firstTwo++;
        for (const e of ofType(evs, 'volley:end')) {
          expect(Number.isInteger(e.shotDamage)).toBe(true);
          const a = dmg.get(w) ?? [];
          a.push(e.shotDamage);
          dmg.set(w, a);
        }
        if (w === 5 && ofType(evs, 'boss:killed').length > 0) bossKilled++;
        if (ofType(evs, 'wave:cleared').length > 0) {
          cleared++;
          shotsInCleared += waveShots;
          waveShots = 0;
          if (firstChoice.length === i) firstChoice.push((sim.state.stats.durationMs + AIM_MS * shots) / 1000);
        }
      }
      expect(sim.state.phase).toBe('gameover');
      expect(Number.isInteger(sim.state.stats.totalDamage)).toBe(true);
      deaths.push(sim.state.wave);
    }
    const avg = deaths.reduce((a, b) => a + b, 0) / deaths.length;
    const mean = (w: number): string => {
      const a = dmg.get(w) ?? [];
      return a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
    };
    const shotsPerWave = shotsInCleared / cleared;
    const choice = firstChoice.reduce((a, b) => a + b, 0) / firstChoice.length;
    console.log(
      `[balance] vagues de mort: ${deaths.join(',')} | moyenne ${avg.toFixed(1)} | tirs/vague ${shotsPerWave.toFixed(1)} | ` +
        `dégâts/tir v1 ${mean(1)} v3 ${mean(3)} v5 ${mean(5)} | boss v5 tués ${bossKilled}/${bossSeen} | ` +
        `1er tir ≥ 2 blocs ${firstTwo}/10 | 1er choix ${choice.toFixed(1)} s (joueur)`,
    );
    expect(avg).toBeGreaterThanOrEqual(4);
    expect(avg).toBeLessThanOrEqual(5);
    expect(shotsPerWave).toBeGreaterThanOrEqual(6);
    expect(shotsPerWave).toBeLessThanOrEqual(8);
    expect(bossKilled / Math.max(1, bossSeen)).toBeGreaterThanOrEqual(0.5);
    expect(firstTwo).toBeGreaterThanOrEqual(7);
    expect(choice).toBeLessThan(25);
  }, 60_000);

  it('méta complète (bonusHp 3, +2 balles, pièces ×1,3, tous éléments) : mort moyenne v9-12', () => {
    const cfg = config();
    const deaths: number[] = [];
    for (let i = 0; i < 10; i++) {
      const sim = newSim(`balance-${i}`, cfg, FULL_META);
      for (let shots = 0; shots < 600 && sim.state.phase !== 'gameover'; shots++) {
        settle(sim);
        shoot(sim, lowestBlockDir(sim));
      }
      expect(sim.state.phase).toBe('gameover');
      deaths.push(sim.state.wave);
    }
    const avg = deaths.reduce((a, b) => a + b, 0) / deaths.length;
    console.log(`[balance méta] vagues de mort: ${deaths.join(',')} | moyenne ${avg.toFixed(1)}`);
    expect(avg).toBeGreaterThanOrEqual(9);
    expect(avg).toBeLessThanOrEqual(12);
  }, 120_000);
});
