// ui/hints.ts — indices iconographiques « une seule fois » (jamais de phrase).
// Persistance : localStorage['pegbreaker.hints'] (clé propre à l'UI), tolérant aux erreurs.
const KEY = 'pegbreaker.hints';

export type HintId = 'reward' | 'combo' | 'fuse';

export interface Hints {
  /** true si l'indice n'a jamais été montré ; le marque alors comme vu */
  take(id: HintId): boolean;
}

export function createHints(): Hints {
  let seen: Record<string, boolean> = {};
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') seen = parsed as Record<string, boolean>;
  } catch {
    seen = {};
  }
  return {
    take(id) {
      if (seen[id]) return false;
      seen[id] = true;
      try {
        localStorage.setItem(KEY, JSON.stringify(seen));
      } catch {
        /* stockage indisponible : l'indice pourra réapparaître, sans gravité */
      }
      return true;
    },
  };
}
