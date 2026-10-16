// Non-infini (garde-fous de fin de partie) : plafonds par touche des effets en % (balls.json → cap),
// brèche croissante et rangée supplémentaire après waves.json → lateWave. Méta complète, 27 éléments.
import { describe, expect, it } from 'vitest';
import type { BallElement, MetaModifiers, Sim } from '../core/types';
import { FRAME, config, createRng, lowestBlockDir, newSim, settle, shoot } from './test-helpers';

const ALL: BallElement[] = config().balls.defs.map((d) => d.id);
const FULL: Partial<MetaModifiers> = { bonusHp: 3, bonusStartBalls: 2, coinMultiplier: 1.3, unlockedElements: ALL };
/** Temps de visée joueur supposé par tir (s). */
const AIM_S = 1.5;
const MAX_SHOTS = 3000;

/** Bot « bon » : récompense = toujours une balle (ou une fusion) si proposée ; quitte la boutique. */
function settleGood(sim: Sim): void {
  for (let g = 0; g < 10; g++) {
    const s = sim.state;
    if (s.phase === 'reward' && s.rewardOffer) {
      const i = s.rewardOffer.findIndex((o) => o.kind === 'ball' || o.kind === 'fuse');
      sim.chooseReward(Math.max(0, i));
    } else if (s.phase === 'shop') sim.leaveShop();
    else break;
    sim.step(0);
  }
}

/** Éventail conditionnel : ouvert (0,6) si la rangée la plus basse compte au moins 3 blocs cassables. */
function spreadFor(sim: Sim): number {
  let low = -1;
  let n = 0;
  for (const b of sim.state.blocks) {
    if (b.kind === 'peg' || b.hp <= 0) continue;
    if (b.row > low) {
      low = b.row;
      n = 0;
    }
    if (b.row === low) n++;
  }
  return n >= 3 ? 0.6 : 0;
}

function play(seed: string, good: boolean): { wave: number; minutes: number } {
  const sim = newSim(seed, config(), FULL);
  let shots = 0;
  for (; shots < MAX_SHOTS && sim.state.phase !== 'gameover'; shots++) {
    if (good) settleGood(sim);
    else settle(sim);
    if (sim.state.phase !== 'aiming') break;
    if (good) sim.aim(lowestBlockDir(sim), spreadFor(sim));
    shoot(sim, lowestBlockDir(sim));
  }
  expect(sim.state.phase).toBe('gameover');
  return { wave: sim.state.wave, minutes: (sim.state.stats.durationMs / 1000 + AIM_S * shots) / 60 };
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

describe('fin de partie : pas de run infinie', () => {
  it('bot « bon », méta complète, 27 éléments, 20 seeds : aucune run au-delà de v35, médiane ≤ 20, médiane ≤ 12 min joueur', () => {
    const runs = Array.from({ length: 20 }, (_, i) => play(`late-good-${i}`, true));
    const waves = runs.map((r) => r.wave);
    expect(Math.max(...waves)).toBeLessThanOrEqual(35);
    expect(median(waves)).toBeLessThanOrEqual(20);
    expect(median(runs.map((r) => r.minutes))).toBeLessThanOrEqual(12);
  }, 120_000);

  it('bot naïf, méta complète, 27 éléments, 20 seeds : aucune run au-delà de v25', () => {
    const waves = Array.from({ length: 20 }, (_, i) => play(`late-naive-${i}`, false).wave);
    expect(Math.max(...waves)).toBeLessThanOrEqual(25);
  }, 120_000);

  it('régression eco-3-65 (harnais systems : vague 158 avant les garde-fous) : meurt avant v25', () => {
    // MetaModifiers du joueur simulé 3 avant sa run 65 (src/systems/economy.test.ts, config 2026-10-17)
    const meta: MetaModifiers = {"bonusHp":3,"bonusStartBalls":2,"coinMultiplier":1.3,"fragmentMultiplier":1,"freeRerolls":1,"unlockedElements":["stone","fire","lightning","ice","ghost","lead","split","acid","magnet","pierce","bomb","homing","giant","swarm","vampire","gold","prism","void","echo","boomerang","crystal","shock","twin","rust","nova","comet","lucky"],"unlockedRelics":["bouncy","piggy","magnet","ricochet","flipper","gourmand","pactole","firstblood","bigboom","pyromane","paratonnerre","permafrost","spectre","enclume","catalyseur","safetynet","mitose","alchimie","radar","berserk"],"runMods":[]};
    const cfg = config();
    const seed = 'eco-3-65';
    const sim = newSim(seed, cfg, meta);
    const rng = createRng(seed);
    let lastWave = 0;
    let sinceWave = 0;
    for (let shots = 0; shots < 2700 && sim.state.phase !== 'gameover'; shots++) {
      settle(sim);
      if (sim.state.phase !== 'aiming') break;
      if (sim.state.wave !== lastWave) {
        lastWave = sim.state.wave;
        sinceWave = 0;
      }
      const a = rng.range(0.2, Math.PI - 0.2);
      if (shots >= 1200) sim.aim({ x: Math.cos(0.05), y: -Math.sin(0.05) });
      else sim.aim(++sinceWave > 20 ? { x: Math.cos(a), y: -Math.sin(a) } : lowestBlockDir(sim));
      sim.fire();
      for (let f = 0; f < 5000; f++) {
        sim.step(FRAME);
        const p: string = sim.state.phase;
        if (p !== 'firing' && p !== 'advancing') break;
      }
    }
    expect(sim.state.phase).toBe('gameover');
    expect(sim.state.wave).toBeLessThan(25);
  }, 60_000);
});
