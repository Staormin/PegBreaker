// systems/achievements.ts — conditions des succès de meta.json → achievements.
// AchievementDef ne porte pas de condition (demande core/ : champ `condition`) : la table
// ci-dessous associe chaque id à un prédicat. Id inconnu → jamais débloqué.
import type { GlobalStats, RunSummary } from '../core/types';

export interface AchievementContext {
  summary: RunSummary;
  /** stats globales APRÈS intégration de la run */
  stats: GlobalStats;
}

type Predicate = (c: AchievementContext) => boolean;

const maxTier = (s: RunSummary): number => s.volley.reduce((m, v) => Math.max(m, v.tier), 1);

/** Seuils de contenu (définis par le nom du succès dans meta.json). */
export const ACHIEVEMENT_RULES: Readonly<Record<string, Predicate>> = {
  combo10: (c) => c.stats.bestCombo >= 10,
  combo30: (c) => c.stats.bestCombo >= 30,
  fusion2: (c) => maxTier(c.summary) >= 2 || c.summary.stats.fusions >= 1,
  fusion3: (c) => maxTier(c.summary) >= 3,
  wave5: (c) => c.summary.stats.bossesKilled >= 1,
  wave10: (c) => c.summary.wave >= 10,
  // « Finir une vague sans perdre de PV » : non mesurable depuis RunSummary (il faudrait
  // un compteur de vagues parfaites dans RunStats). À faire : jamais débloqué pour l'instant.
  perfectwave: () => false,
  shot1000: (c) => c.stats.bestShotDamage >= 1000,
  daily1: (c) => c.summary.isDaily,
};

/** Ids des succès nouvellement remplis (ordre de meta.json), hors ceux déjà acquis. */
export function checkAchievements(ids: readonly string[], owned: readonly string[], ctx: AchievementContext): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (owned.includes(id)) continue;
    const rule = ACHIEVEMENT_RULES[id];
    if (rule && rule(ctx)) out.push(id);
  }
  return out;
}
