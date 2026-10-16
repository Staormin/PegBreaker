// Sanity d'économie méta : bot « vise le bloc le plus bas » (sim réelle), achats gloutons
// du nœud le moins cher après chaque run. Cibles (brief T10) : 1er achat après 1-2 runs,
// arbre complet en ~25-30 runs (J3 : 16 nœuds, total 1 790).
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config';
import type { GameConfig, RunSummary } from '../core/types';
import { createRng } from '../core/rng';
import { createSim } from '../sim/index';
import { FRAME, lowestBlockDir, settle } from '../sim/test-helpers';
import { createMemoryStorage, createMeta, nextCost } from './index';

function playRun(cfg: GameConfig, seed: string, meta: ReturnType<typeof createMeta>): RunSummary {
  const sim = createSim(cfg, { seed, meta: meta.getModifiers() });
  const rng = createRng(seed);
  let lastWave = 0;
  let sinceWave = 0;
  for (let shots = 0; shots < 800; shots++) {
    settle(sim);
    if (sim.state.phase === 'gameover') break;
    if (sim.state.wave !== lastWave) {
      lastWave = sim.state.wave;
      sinceWave = 0;
    }
    // Anti-blocage : après 20 tirs dans la même vague, visée aléatoire (voir rapport :
    // un bloc blindé gelé en rangée 8 peut bloquer indéfiniment le bot « plus bas »).
    const a = rng.range(0.2, Math.PI - 0.2);
    sim.aim(++sinceWave > 20 ? { x: Math.cos(a), y: -Math.sin(a) } : lowestBlockDir(sim));
    sim.fire();
    for (let f = 0; f < 5000; f++) {
      for (const e of sim.step(FRAME)) if (e.type === 'run:over') return e.summary;
      const p = sim.state.phase;
      if (p !== 'firing' && p !== 'advancing') break;
    }
  }
  throw new Error(`run ${seed} sans fin : vague ${sim.state.wave}, profondeur ${sim.state.depth}`);
}

/** Achète le nœud achetable le moins cher, tant que possible. Renvoie le nombre d'achats. */
function buyGreedy(cfg: GameConfig, meta: ReturnType<typeof createMeta>): number {
  let n = 0;
  for (;;) {
    const opts = cfg.meta.nodes
      .filter((x) => meta.canBuyNode(x.id))
      .map((x) => ({ id: x.id, cost: nextCost(x, meta.data.meta.nodes[x.id] ?? 0) ?? Infinity }))
      .sort((a, b) => a.cost - b.cost);
    const best = opts[0];
    if (!best || !meta.buyNode(best.id)) return n;
    n++;
  }
}

const complete = (cfg: GameConfig, meta: ReturnType<typeof createMeta>): boolean =>
  cfg.meta.nodes.every((n) => (meta.data.meta.nodes[n.id] ?? 0) >= n.costs.length);

describe('économie méta', () => {
  it('1er achat après ≤ 2 runs, arbre complet en 20-35 runs, moyenne 24-31 (5 joueurs simulés)', () => {
    const cfg = structuredClone(loadConfig());
    const firstBuy: number[] = [];
    const full: number[] = [];
    const perRun: number[] = [];
    for (let p = 0; p < 5; p++) {
      const meta = createMeta(createMemoryStorage(), cfg, () => new Date(2026, 9, 16));
      let first = 0;
      let runs = 0;
      while (!complete(cfg, meta) && runs < 60) {
        const s = playRun(cfg, `eco-${p}-${runs}`, meta);
        runs++;
        perRun.push(s.stats.fragmentsEarned);
        meta.onRunEnd(s);
        if (buyGreedy(cfg, meta) > 0 && first === 0) first = runs;
      }
      firstBuy.push(first);
      full.push(runs);
    }
    const mean = perRun.reduce((a, b) => a + b, 0) / perRun.length;
    console.log(`[economy] 1er achat: run ${firstBuy.join(',')} | arbre complet: ${full.join(',')} runs | fragments/run moyen ${mean.toFixed(1)} (min ${Math.min(...perRun)}, max ${Math.max(...perRun)})`);
    for (const f of firstBuy) expect(f).toBeGreaterThanOrEqual(1);
    for (const f of firstBuy) expect(f).toBeLessThanOrEqual(2);
    for (const r of full) {
      expect(r).toBeGreaterThanOrEqual(20);
      expect(r).toBeLessThanOrEqual(35);
    }
    const avgFull = full.reduce((a, b) => a + b, 0) / full.length;
    expect(avgFull).toBeGreaterThanOrEqual(24);
    expect(avgFull).toBeLessThanOrEqual(31);
  }, 120_000);
});
