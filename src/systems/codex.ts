// systems/codex.ts — Codex des hybrides et de la Divine (HYBRIDS.md) : ids valides, fusion, résumé.
// Valide = élément défini dans balls.json de famille 'hybrid' ou 'divine'. Ordre conservé :
// ordre de découverte (premier forgeage), sans doublon.
import type { BallElement, GameConfig } from '../core/types';

const CODEX_FAMILIES: readonly string[] = ['hybrid', 'divine'];

/** Ids éligibles au codex, dans l'ordre de balls.json. */
export function codexIds(config: GameConfig): BallElement[] {
  return config.balls.defs.filter((d) => CODEX_FAMILIES.includes(d.family)).map((d) => d.id);
}

/** Ajoute `incoming` (non validé : sauvegarde brute, résumé de run) à `base` : ids valides, sans doublon. */
export function mergeCodex(base: readonly unknown[], incoming: readonly unknown[], config: GameConfig): BallElement[] {
  const valid = new Set<string>(codexIds(config));
  const out: BallElement[] = [];
  for (const v of [...base, ...incoming]) {
    if (typeof v !== 'string' || !valid.has(v) || out.includes(v as BallElement)) continue;
    out.push(v as BallElement);
  }
  return out;
}

export interface CodexProgress {
  /** hybrides distinctes découvertes */
  hybrids: number;
  /** la Divine a été forgée */
  divine: boolean;
  /** entrées découvertes (hybrides + Divine) */
  total: number;
  /** entrées possibles (14 avec le contenu HYBRIDS.md) */
  size: number;
}

export function codexProgress(codex: readonly BallElement[], config: GameConfig): CodexProgress {
  const fam = new Map(config.balls.defs.map((d) => [d.id as string, d.family as string]));
  let hybrids = 0;
  let divine = false;
  for (const id of codex) {
    const f = fam.get(id);
    if (f === 'hybrid') hybrids++;
    else if (f === 'divine') divine = true;
  }
  return { hybrids, divine, total: hybrids + (divine ? 1 : 0), size: codexIds(config).length };
}
