// render/palette.ts — palette imposée (skill procedural-assets). La config JSON fait foi
// pour les couleurs des éléments et des blocs ; la palette sert au reste et aux replis.
import type { BallElement, BlockKind, GameConfig } from '../core/types';

export const PALETTE = {
  bg0: '#0b0f1a', bg1: '#121a2b', grid: '#1b2740', wall: '#2a3a5c',
  text: '#e8ecf5', textDim: '#8a94a8', accent: '#ffe95c', danger: '#ff5e5e', good: '#5cff9d',
  stone: '#cfd6e6', fire: '#ff7a3d', lightning: '#ffe95c', ice: '#7fe4ff', ghost: '#c08cff', lead: '#6b7280', split: '#5cff9d',
  block: '#4f7cff', peg: '#e8ecf5', explosive: '#ff5e5e', heart: '#ff7ab8', armored: '#8a94a8', boss: '#b23cff',
  outline: '#0b0f1a', fragment: '#7fe4ff', coin: '#ffe95c',
} as const;

export const ELEMENTS: readonly BallElement[] = ['stone', 'fire', 'lightning', 'ice', 'ghost', 'lead', 'split'];
export const KINDS: readonly BlockKind[] = ['normal', 'armored', 'explosive', 'peg', 'heart', 'boss'];

export const ELEMENT_INDEX: Readonly<Record<BallElement, number>> = {
  stone: 0, fire: 1, lightning: 2, ice: 3, ghost: 4, lead: 5, split: 6,
};
export const KIND_INDEX: Readonly<Record<BlockKind, number>> = {
  normal: 0, armored: 1, explosive: 2, peg: 3, heart: 4, boss: 5,
};

const KIND_FALLBACK: Readonly<Record<BlockKind, string>> = {
  normal: PALETTE.block, armored: PALETTE.armored, explosive: PALETTE.explosive,
  peg: PALETTE.peg, heart: PALETTE.heart, boss: PALETTE.boss,
};

export interface Colors {
  /** couleur par élément (indexé par ELEMENT_INDEX) */
  element: string[];
  /** couleur par type de bloc (indexé par KIND_INDEX) */
  kind: string[];
}

export function buildColors(config: GameConfig): Colors {
  const element: string[] = [];
  for (const el of ELEMENTS) {
    const def = config.balls.defs.find((d) => d.id === el);
    element.push(def ? def.color : PALETTE[el]);
  }
  const kind: string[] = [];
  for (const k of KINDS) {
    const def = config.blocks.defs.find((d) => d.kind === k);
    kind.push(def ? def.color : KIND_FALLBACK[k]);
  }
  return { element, kind };
}

/** Éclaircit (+) ou assombrit (−) une couleur #rrggbb. Usage hors boucle uniquement. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amount >= 0) {
    r += (255 - r) * amount; g += (255 - g) * amount; b += (255 - b) * amount;
  } else {
    r *= 1 + amount; g *= 1 + amount; b *= 1 + amount;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

/** Mélange linéaire de deux couleurs #rrggbb → 'rgb(r,g,b)'. Usage hors boucle uniquement. */
export function mixHex(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const ch = (sh: number): number => Math.round(((na >> sh) & 255) * (1 - t) + ((nb >> sh) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
