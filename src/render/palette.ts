// render/palette.ts — palette imposée (skill procedural-assets). La config JSON fait foi
// pour les couleurs des éléments et des blocs ; la palette sert au reste et aux replis.
import { BALL_FAMILIES, type BallElement, type BallFamily, type BlockKind, type GameConfig } from '../core/types';

export const PALETTE = {
  bg0: '#0b0f1a', bg1: '#121a2b', grid: '#1b2740', wall: '#2a3a5c',
  text: '#e8ecf5', textDim: '#8a94a8', accent: '#ffe95c', danger: '#ff5e5e', good: '#5cff9d',
  stone: '#cfd6e6', fire: '#ff7a3d', lightning: '#ffe95c', ice: '#7fe4ff', ghost: '#c08cff', lead: '#6b7280', split: '#5cff9d',
  block: '#4f7cff', peg: '#e8ecf5', explosive: '#ff5e5e', heart: '#ff7ab8', armored: '#8a94a8', boss: '#b23cff',
  outline: '#0b0f1a', fragment: '#7fe4ff', coin: '#ffe95c',
  /** balle dorée (lot 1, F3) : or plus chaud que l'accent jaune des critiques */
  gold: '#ffc23d', goldLight: '#fff2b8', goldDark: '#a86b00',
} as const;

/**
 * Repli de couleur par élément (la config fait foi). L'objet est typé `Record<BallElement, …>` :
 * le compilateur exige les 41 clés, et c'est la SEULE liste écrite à la main ; ELEMENTS et
 * ELEMENT_INDEX en sont dérivés (ordre = ordre de déclaration, identique à balls.json).
 */
const ELEMENT_FALLBACK: Readonly<Record<BallElement, string>> = {
  stone: PALETTE.stone, fire: PALETTE.fire, lightning: PALETTE.lightning, ice: PALETTE.ice,
  ghost: PALETTE.ghost, lead: PALETTE.lead, split: PALETTE.split,
  acid: PALETTE.good, magnet: PALETTE.heart, pierce: PALETTE.text, bomb: PALETTE.danger,
  homing: PALETTE.heart, giant: PALETTE.stone, swarm: PALETTE.good, vampire: PALETTE.danger,
  gold: PALETTE.gold, prism: PALETTE.ice, void: PALETTE.boss, echo: PALETTE.split,
  boomerang: PALETTE.fire, crystal: PALETTE.ice, shock: PALETTE.lightning, twin: PALETTE.split,
  rust: PALETTE.fire, nova: PALETTE.heart, comet: PALETTE.fire, lucky: PALETTE.good,
  // hybrides (forge) et Divine : la config fait foi, ces replis ne servent que sans config
  steam: '#b9e8ff', laser: '#e0ffff', cluster: '#ff6f91', wraith: '#d8ccff', abyss: '#4b1d6b',
  jackpot: '#ffe680', quake: '#c9a86a', missile: '#ff5c33', supernova: '#ff9de2', plague: '#8bc34a',
  choir: '#c8ffe6', orbit: '#ff9ad5', hammer: '#8d6e63',
  divine: '#fff6c2',
};
/** recettes de repli (la config fait foi : BallDef.recipe) */
const RECIPE_FALLBACK: Partial<Record<BallElement, [BallElement, BallElement]>> = {
  steam: ['fire', 'ice'], laser: ['lightning', 'prism'], cluster: ['bomb', 'split'], wraith: ['ghost', 'pierce'],
  abyss: ['acid', 'void'], jackpot: ['gold', 'lucky'], quake: ['giant', 'shock'], missile: ['comet', 'homing'],
  supernova: ['crystal', 'nova'], plague: ['vampire', 'acid'], choir: ['twin', 'echo'], orbit: ['boomerang', 'magnet'],
  hammer: ['lead', 'rust'],
};
/** famille de repli si la config n'en donne pas (BallDef.family est requis : simple garde-fou) */
const FAMILY_FALLBACK: BallFamily = 'arcane';

export const ELEMENTS: readonly BallElement[] = Object.keys(ELEMENT_FALLBACK) as BallElement[];
export const ELEMENT_COUNT = ELEMENTS.length;
export const KINDS: readonly BlockKind[] = ['normal', 'armored', 'explosive', 'peg', 'heart', 'boss'];

function indexOf<K extends string>(keys: readonly K[]): Readonly<Record<K, number>> {
  const out = {} as Record<K, number>;
  keys.forEach((k, i) => { out[k] = i; });
  return out;
}

export const ELEMENT_INDEX: Readonly<Record<BallElement, number>> = indexOf(ELEMENTS);
export const KIND_INDEX: Readonly<Record<BlockKind, number>> = indexOf(KINDS);
export const FAMILY_INDEX: Readonly<Record<BallFamily, number>> = indexOf(BALL_FAMILIES);
export const FAMILY_COUNT = BALL_FAMILIES.length;

const KIND_FALLBACK: Readonly<Record<BlockKind, string>> = {
  normal: PALETTE.block, armored: PALETTE.armored, explosive: PALETTE.explosive,
  peg: PALETTE.peg, heart: PALETTE.heart, boss: PALETTE.boss,
};

export interface Colors {
  /** couleur par élément (indexé par ELEMENT_INDEX) */
  element: string[];
  /** famille par élément (indexé par ELEMENT_INDEX → FAMILY_INDEX) */
  family: number[];
  /** nom affiché par élément (indexé par ELEMENT_INDEX) */
  name: string[];
  /** couleur par type de bloc (indexé par KIND_INDEX) */
  kind: string[];
  /** parents d'une hybride (ELEMENT_INDEX), −1 sinon : recipeA[e], recipeB[e] */
  recipeA: Int16Array;
  recipeB: Int16Array;
}

export function buildColors(config: GameConfig): Colors {
  const element: string[] = [];
  const family: number[] = [];
  const name: string[] = [];
  for (const el of ELEMENTS) {
    const def = config.balls.defs.find((d) => d.id === el);
    element.push(def && /^#[0-9a-fA-F]{6}$/.test(def.color) ? def.color : ELEMENT_FALLBACK[el]);
    family.push(FAMILY_INDEX[def?.family ?? FAMILY_FALLBACK] ?? FAMILY_INDEX[FAMILY_FALLBACK]);
    name.push(def ? def.name : el);
  }
  const recipeA = new Int16Array(ELEMENTS.length).fill(-1);
  const recipeB = new Int16Array(ELEMENTS.length).fill(-1);
  ELEMENTS.forEach((el, i) => {
    const def = config.balls.defs.find((d) => d.id === el);
    const r = def?.recipe ?? RECIPE_FALLBACK[el];
    if (r) { recipeA[i] = ELEMENT_INDEX[r[0]] ?? -1; recipeB[i] = ELEMENT_INDEX[r[1]] ?? -1; }
  });
  const kind: string[] = [];
  for (const k of KINDS) {
    const def = config.blocks.defs.find((d) => d.kind === k);
    kind.push(def ? def.color : KIND_FALLBACK[k]);
  }
  return { element, family, name, kind, recipeA, recipeB };
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
