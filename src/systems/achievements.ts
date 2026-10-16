// systems/achievements.ts — conditions des succès de meta.json → achievements.
// Priorité à `AchievementDef.condition` (déclaratif, seuils dans le JSON) ; à défaut, table
// par id ci-dessous (pour les mesures absentes de l'union `condition.stat`). Sinon : jamais.
import type { AchievementDef, GlobalStats, RunSummary } from '../core/types';

export interface AchievementContext {
  summary: RunSummary;
  /** stats globales APRÈS intégration de la run */
  stats: GlobalStats;
}

type Stat = NonNullable<AchievementDef['condition']>['stat'];

const maxTier = (s: RunSummary): number => s.volley.reduce((m, v) => Math.max(m, v.tier), 0);

/** Valeur mesurée pour une condition déclarative. Records : globaux ; le reste : la run. */
export function statValue(stat: Stat, c: AchievementContext): number {
  switch (stat) {
    case 'bestCombo':
      return c.stats.bestCombo;
    case 'bestShotDamage':
      return c.stats.bestShotDamage;
    case 'bestDepth':
      return c.stats.bestDepth;
    case 'bestWave':
      return c.stats.bestWave;
    case 'bossesKilled':
      return c.summary.stats.bossesKilled;
    case 'wave':
      return c.summary.wave;
    case 'maxTier':
      return maxTier(c.summary);
    case 'isDaily':
      return c.summary.isDaily ? 1 : 0;
    case 'perfectWaves':
      return c.summary.stats.perfectWaves ?? 0; // vieux résumés sans le champ
  }
}

type Predicate = (c: AchievementContext) => boolean;

/** Repli par id (succès sans `condition`). Seuils de contenu = ceux du nom du succès. */
export const ACHIEVEMENT_RULES: Readonly<Record<string, Predicate>> = {
  relic6: (c) => c.summary.relics.length >= 6,
  volley24: (c) => c.summary.volley.length >= 24,
  score20k: (c) => c.stats.bestScore >= 20000,
};

export function isMet(def: AchievementDef, ctx: AchievementContext): boolean {
  if (def.condition) return statValue(def.condition.stat, ctx) >= def.condition.gte;
  const rule = ACHIEVEMENT_RULES[def.id];
  return rule ? rule(ctx) : false;
}

/** Succès nouvellement remplis (ordre de meta.json), hors ceux déjà acquis. */
export function checkAchievements(defs: readonly AchievementDef[], owned: readonly string[], ctx: AchievementContext): string[] {
  const out: string[] = [];
  for (const d of defs) if (!owned.includes(d.id) && isMet(d, ctx)) out.push(d.id);
  return out;
}
