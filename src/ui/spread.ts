// ui/spread.ts — sélecteur explicite d'ouverture de la volée (F1-02).
// 3 niveaux : 0 rafale (spread 0), 1 moyen (0,5), 2 large (1). La valeur est mémorisée par l'UI,
// persistante d'un tir à l'autre, renvoyée à chaque `sim.aim(dir, spread)` et remise à 0 au
// début d'une run. Le geste de visée ne la modifie jamais.

export type SpreadLevel = 0 | 1 | 2;

export const SPREAD_VALUES: readonly [number, number, number] = [0, 0.5, 1];
export const SPREAD_LABELS: readonly [string, string, string] = ['rafale', 'moyen', 'large'];
export const SPREAD_ICONS: readonly [string, string, string] = ['⫶', '⋔', '⫛'];

/** niveau suivant (dir = +1) ou précédent (dir = −1), en boucle */
export function cycleLevel(level: SpreadLevel, dir: 1 | -1 = 1): SpreadLevel {
  return (((level + dir) % 3) + 3) % 3 as SpreadLevel;
}

export interface SpreadControl {
  readonly level: SpreadLevel;
  /** ouverture 0..1 à passer à sim.aim */
  readonly value: number;
  cycle(dir?: 1 | -1): void;
  reset(): void;
  /** notifié à chaque changement de niveau */
  onChange(fn: (level: SpreadLevel) => void): void;
}

export function createSpreadControl(): SpreadControl {
  let level: SpreadLevel = 0;
  const subs: ((l: SpreadLevel) => void)[] = [];
  const set = (l: SpreadLevel): void => {
    if (l === level) return;
    level = l;
    for (const f of subs) f(l);
  };
  return {
    get level() {
      return level;
    },
    get value() {
      return SPREAD_VALUES[level];
    },
    cycle(dir = 1) {
      set(cycleLevel(level, dir));
    },
    reset() {
      set(0);
    },
    onChange(fn) {
      subs.push(fn);
    },
  };
}
