// systems/stats.ts — intégration d'une run dans les stats globales.
import type { GlobalStats, RunSummary } from '../core/types';

export function applyRunStats(s: GlobalStats, r: RunSummary): GlobalStats {
  return {
    runs: s.runs + 1,
    bestDepth: Math.max(s.bestDepth, r.depth),
    bestWave: Math.max(s.bestWave, r.wave),
    bestCombo: Math.max(s.bestCombo, r.stats.bestCombo),
    bestShotDamage: Math.max(s.bestShotDamage, r.stats.bestShotDamage),
    bestScore: Math.max(s.bestScore, r.score),
    totalFragments: s.totalFragments, // crédité par createMeta (run + succès)
    totalBlocks: s.totalBlocks + r.stats.blocksDestroyed,
  };
}
