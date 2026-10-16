// core/rng.ts — propriétaire : architecte. PRNG déterministe (mulberry32).
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** entier dans [lo, hi] inclus */
  int(lo: number, hi: number): number;
  /** flottant dans [lo, hi) */
  range(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
  /** état sérialisable (uint32) */
  getState(): number;
  setState(s: number): void;
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function createRng(seed: number | string): Rng {
  let a = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 0x9e3779b9;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    pick: (arr) => {
      if (arr.length === 0) throw new Error('rng.pick: tableau vide');
      return arr[Math.floor(next() * arr.length)] as (typeof arr)[number];
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i] as (typeof arr)[number];
        arr[i] = arr[j] as (typeof arr)[number];
        arr[j] = t;
      }
      return arr;
    },
    getState: () => a,
    setState: (s) => {
      a = s >>> 0;
    },
  };
  return rng;
}
