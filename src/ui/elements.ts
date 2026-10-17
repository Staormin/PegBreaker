// ui/elements.ts — tout ce que l'UI affiche « par élément » est dérivé de `config.balls.defs`
// (ordre d'affichage = ordre du JSON) : index, nom, couleur, famille, description courte, et
// une silhouette par FAMILLE (8 formes) teintée de la couleur de l'élément.
// Hybride : losange à deux moitiés teintées des couleurs des deux parents (`BallDef.recipe`).
// Divine : étoile à 8 branches blanc/or avec halo.
// Les silhouettes sont des chemins SVG dans un repère 48×48 (centre 24,24, rayon utile ≈ 13),
// réutilisés tels quels par le canvas de la carte de partage (Path2D).
import type { BallDef, BallElement, BallFamily, BallTier, GameConfig } from '../core/types';
import { BALL_FAMILIES } from '../core/types';
import { clip } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FALLBACK_COLOR = '#cfd6e6';
/** liseré clair : garde lisibles les teintes sombres (vide, rouille, plomb) sur fond sombre */
const OUTLINE = 'rgba(232,236,245,0.5)';

/** libellés affichés des familles (filtre du Puits, aria) */
export const FAMILY_LABELS: Readonly<Record<BallFamily, string>> = {
  elemental: 'Élémentaires',
  heavy: 'Lourdes',
  tricky: 'Rusées',
  swarm: 'Essaims',
  greed: 'Avidité',
  arcane: 'Arcanes',
  hybrid: 'Hybrides',
  divine: 'Divine',
};

/** famille au singulier, en minuscules (indices du codex : « élémentaire + lourde ») */
export const FAMILY_SINGULAR: Readonly<Record<BallFamily, string>> = {
  elemental: 'élémentaire',
  heavy: 'lourde',
  tricky: 'rusée',
  swarm: 'essaim',
  greed: 'avidité',
  arcane: 'arcane',
  hybrid: 'hybride',
  divine: 'divine',
};

/** familles « de base » (filtre de l'Arsenal) : hybrides et Divine ne s'y débloquent pas */
export const BASE_FAMILIES: readonly BallFamily[] = BALL_FAMILIES.filter((f) => f !== 'hybrid' && f !== 'divine');

const DIVINE_GOLD = '#ffd34d';
const DIVINE_WHITE = '#fffdf2';

/** cercle en une seule sous-figure de chemin */
const circ = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** étoile à n branches centrée en (24,24) */
function star(n: number, ro: number, ri: number): string {
  let d = '';
  for (let k = 0; k < n * 2; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / n;
    const r = k % 2 === 0 ? ro : ri;
    d += `${k === 0 ? 'M' : 'L'}${(24 + Math.cos(a) * r).toFixed(2)} ${(24 + Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}

/** hybride : moitiés gauche / droite du losange (parent A / parent B) */
export const HYBRID_HALVES: readonly [string, string] = ['M24 8L8 24L24 40Z', 'M24 8L40 24L24 40Z'];
/** Divine : étoile intérieure (blanche) */
const DIVINE_INNER = star(8, 10, 5);

/** silhouette par famille (repère 48×48) */
export const FAMILY_PATHS: Readonly<Record<BallFamily, string>> = {
  // flamme / goutte
  elemental: 'M24 9C27 15 37 21 37 29A13 13 0 0 1 11 29C11 23 16 20 18 14C20 18 22 19 23 19C23 15 23 12 24 9Z',
  // bloc lourd : octogone
  heavy: 'M18.6 11H29.4L37 18.6V29.4L29.4 37H18.6L11 29.4V18.6Z',
  // étoile à 4 branches
  tricky: 'M24 9L28 20L39 24L28 28L24 39L20 28L9 24L20 20Z',
  // trois billes groupées
  swarm: `${circ(24, 16.5, 6.5)}${circ(16.5, 29.5, 6.5)}${circ(31.5, 29.5, 6.5)}`,
  // gemme (hexagone pointe en bas)
  greed: 'M17 12H31L38 20L24 38L10 20Z',
  // étoile à 6 branches (deux triangles)
  arcane: 'M24 9L28.3 16.5L37 16.5L32.7 24L37 31.5L28.3 31.5L24 39L19.7 31.5L11 31.5L15.3 24L11 16.5L19.7 16.5Z',
  // losange (deux moitiés teintées des parents)
  hybrid: 'M24 8L40 24L24 40L8 24Z',
  // étoile à 8 branches
  divine: star(8, 16, 8),
};

/** reflet / détail clair dessiné par-dessus la silhouette */
export const FAMILY_SHINE: Readonly<Record<BallFamily, string>> = {
  elemental: circ(20, 29, 3.5),
  heavy: `${circ(18, 18, 2)}${circ(30, 18, 2)}${circ(18, 30, 2)}${circ(30, 30, 2)}`,
  tricky: circ(24, 24, 3),
  swarm: `${circ(22, 14.5, 2)}${circ(14.5, 27.5, 2)}${circ(29.5, 27.5, 2)}`,
  greed: 'M17 12L24 20L31 12M10 20H38M24 20V38',
  arcane: circ(24, 24, 4),
  // petit losange central (couleur propre de l'hybride, posé par-dessus en blanc translucide)
  hybrid: 'M24 18L30 24L24 30L18 24Z',
  divine: circ(24, 24, 3),
};

export interface ElementInfo {
  id: BallElement;
  index: number;
  name: string;
  color: string;
  family: BallFamily;
  /** description ≤ 60 caractères (tronquée proprement) */
  desc: string;
  /** hybride : les deux parents (`BallDef.recipe`) */
  recipe?: readonly [BallElement, BallElement];
  /** hybride : couleurs des deux parents (moitiés du losange) */
  colors?: readonly [string, string];
}

/** Vue indexée des définitions, construite une fois à partir de la config. */
export interface ElementTable {
  readonly list: readonly ElementInfo[];
  get(e: BallElement): ElementInfo;
  /** index d'affichage (ordre du JSON) ; inconnu → après tous les autres */
  index(e: BallElement): number;
}

const tables = new WeakMap<GameConfig, ElementTable>();

function infoOf(d: BallDef, index: number): ElementInfo {
  const family: BallFamily = (BALL_FAMILIES as readonly string[]).includes(d.family) ? d.family : 'arcane';
  const info: ElementInfo = { id: d.id, index, name: d.name, color: d.color || FALLBACK_COLOR, family, desc: clip(d.description || '') };
  if (d.recipe) info.recipe = [d.recipe[0], d.recipe[1]];
  return info;
}

export function elementTable(config: GameConfig): ElementTable {
  const cached = tables.get(config);
  if (cached) return cached;
  const list: ElementInfo[] = [];
  const by = new Map<BallElement, ElementInfo>();
  for (const d of config.balls.defs) {
    if (by.has(d.id)) continue;
    const info = infoOf(d, list.length);
    list.push(info);
    by.set(d.id, info);
  }
  // couleurs des parents (après coup : un parent peut être défini après l'hybride)
  for (const info of list) {
    if (!info.recipe) continue;
    const a = by.get(info.recipe[0])?.color ?? FALLBACK_COLOR;
    const b = by.get(info.recipe[1])?.color ?? FALLBACK_COLOR;
    info.colors = [a, b];
    if (info.family !== 'divine') info.family = 'hybrid';
  }
  const t: ElementTable = {
    list,
    get(e) {
      return by.get(e) ?? { id: e, index: list.length, name: e, color: FALLBACK_COLOR, family: 'arcane', desc: '' };
    },
    index(e) {
      return by.get(e)?.index ?? list.length;
    },
  };
  tables.set(config, t);
  return t;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/** ajoute la silhouette de famille (+ anneaux de rang) dans un <svg>/<g> en repère 48×48.
 *  `colors` : couleurs des deux parents d'une hybride (moitiés du losange). */
export function appendBallShape(svg: SVGElement, family: BallFamily, color: string, tier: BallTier, colors?: readonly [string, string]): void {
  const ring = family === 'divine' ? DIVINE_GOLD : color;
  if (tier >= 3) svg.append(svgEl('circle', { cx: 24, cy: 24, r: 22.5, fill: 'none', stroke: ring, 'stroke-width': 2 }));
  if (tier >= 2) svg.append(svgEl('circle', { cx: 24, cy: 24, r: 19, fill: 'none', stroke: ring, 'stroke-width': 2.5 }));
  if (family === 'hybrid') {
    const [a, b] = colors ?? [color, color];
    svg.append(svgEl('path', { d: HYBRID_HALVES[0], fill: a }), svgEl('path', { d: HYBRID_HALVES[1], fill: b }));
    svg.append(svgEl('path', { d: FAMILY_PATHS.hybrid, fill: 'none', stroke: OUTLINE, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }));
    svg.append(svgEl('path', { d: FAMILY_SHINE.hybrid, fill: color, stroke: '#ffffff', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }));
    return;
  }
  if (family === 'divine') {
    svg.append(svgEl('circle', { cx: 24, cy: 24, r: 17, fill: DIVINE_GOLD, opacity: 0.22 }));
    svg.append(svgEl('path', { d: FAMILY_PATHS.divine, fill: DIVINE_GOLD, stroke: DIVINE_WHITE, 'stroke-width': 1, 'stroke-linejoin': 'round' }));
    svg.append(svgEl('path', { d: DIVINE_INNER, fill: DIVINE_WHITE }));
    svg.append(svgEl('path', { d: FAMILY_SHINE.divine, fill: DIVINE_GOLD }));
    return;
  }
  svg.append(svgEl('path', { d: FAMILY_PATHS[family], fill: color, stroke: OUTLINE, 'stroke-width': 1.2, 'stroke-linejoin': 'round' }));
  const shine = FAMILY_SHINE[family];
  if (family === 'greed') svg.append(svgEl('path', { d: shine, fill: 'none', stroke: '#ffffff', 'stroke-width': 1.4, opacity: 0.55, 'stroke-linejoin': 'round' }));
  else svg.append(svgEl('path', { d: shine, fill: '#ffffff', opacity: 0.6 }));
}

/** Icône SVG inline d'une balle (silhouette de sa famille, couleur de l'élément). */
export function ballIcon(config: GameConfig, element: BallElement, tier: BallTier = 1, size = 48): SVGSVGElement {
  const info = elementTable(config).get(element);
  const svg = svgEl('svg', { viewBox: '0 0 48 48', width: size, height: size, 'aria-hidden': 'true', class: 'opt-icon ball-icon' });
  svg.dataset.family = info.family;
  svg.dataset.element = element;
  appendBallShape(svg, info.family, info.color, tier, info.colors);
  return svg;
}

/** Icône de famille seule (filtre du Puits) : couleur neutre `currentColor`. */
export function familyIcon(family: BallFamily, size = 24): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 48 48', width: size, height: size, 'aria-hidden': 'true', class: 'fam-icon' });
  svg.append(svgEl('path', { d: FAMILY_PATHS[family], fill: 'currentColor' }));
  return svg;
}

const pathCache = new Map<string, Path2D>();
function path2d(d: string): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

/** Dessine la silhouette dans un canvas, centrée en (x, y), rayon apparent `r` (carte de partage).
 *  `colors` : couleurs des deux parents d'une hybride. */
export function drawBallShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  family: BallFamily,
  color: string,
  tier: BallTier,
  colors?: readonly [string, string],
): void {
  const k = r / 14; // la silhouette occupe ≈ 28 unités sur 48
  ctx.save();
  ctx.translate(x - 24 * k, y - 24 * k);
  ctx.scale(k, k);
  ctx.strokeStyle = family === 'divine' ? DIVINE_GOLD : color;
  ctx.lineWidth = 2.5;
  if (tier >= 3) {
    ctx.beginPath();
    ctx.arc(24, 24, 23, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (tier >= 2) {
    ctx.beginPath();
    ctx.arc(24, 24, 19, 0, Math.PI * 2);
    ctx.stroke();
  }
  const body = path2d(FAMILY_PATHS[family]);
  const shine = path2d(FAMILY_SHINE[family]);
  if (!body) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(24, 24, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.lineJoin = 'round';
  if (family === 'hybrid') {
    const [a, b] = colors ?? [color, color];
    const h0 = path2d(HYBRID_HALVES[0]);
    const h1 = path2d(HYBRID_HALVES[1]);
    ctx.fillStyle = a;
    if (h0) ctx.fill(h0);
    ctx.fillStyle = b;
    if (h1) ctx.fill(h1);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.2;
    ctx.stroke(body);
    if (shine) {
      ctx.fillStyle = color;
      ctx.fill(shine);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke(shine);
    }
  } else if (family === 'divine') {
    ctx.fillStyle = 'rgba(255,211,77,0.22)';
    ctx.beginPath();
    ctx.arc(24, 24, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = DIVINE_GOLD;
    ctx.fill(body);
    ctx.strokeStyle = DIVINE_WHITE;
    ctx.lineWidth = 1;
    ctx.stroke(body);
    const inner = path2d(DIVINE_INNER);
    ctx.fillStyle = DIVINE_WHITE;
    if (inner) ctx.fill(inner);
    if (shine) {
      ctx.fillStyle = DIVINE_GOLD;
      ctx.fill(shine);
    }
  } else {
    ctx.fillStyle = color;
    ctx.fill(body);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.2;
    ctx.stroke(body);
    if (shine) {
      if (family === 'greed') {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.4;
        ctx.stroke(shine);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fill(shine);
      }
    }
  }
  ctx.restore();
}

/** Regroupe une volée par (élément, rang) : rang décroissant puis ordre du JSON. */
export function groupVolley(config: GameConfig, volley: readonly { element: BallElement; tier: BallTier }[]): { element: BallElement; tier: BallTier; count: number }[] {
  const t = elementTable(config);
  const out: { element: BallElement; tier: BallTier; count: number }[] = [];
  for (const b of volley) {
    const g = out.find((x) => x.element === b.element && x.tier === b.tier);
    if (g) g.count++;
    else out.push({ element: b.element, tier: b.tier, count: 1 });
  }
  return out.sort((a, b) => b.tier - a.tier || t.index(a.element) - t.index(b.element));
}
