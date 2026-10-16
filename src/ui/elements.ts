// ui/elements.ts — tout ce que l'UI affiche « par élément » est dérivé de `config.balls.defs`
// (ordre d'affichage = ordre du JSON) : index, nom, couleur, famille, description courte, et
// une silhouette par FAMILLE (6 formes) teintée de la couleur de l'élément.
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
};

/** cercle en une seule sous-figure de chemin */
const circ = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

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
};

/** reflet / détail clair dessiné par-dessus la silhouette */
export const FAMILY_SHINE: Readonly<Record<BallFamily, string>> = {
  elemental: circ(20, 29, 3.5),
  heavy: `${circ(18, 18, 2)}${circ(30, 18, 2)}${circ(18, 30, 2)}${circ(30, 30, 2)}`,
  tricky: circ(24, 24, 3),
  swarm: `${circ(22, 14.5, 2)}${circ(14.5, 27.5, 2)}${circ(29.5, 27.5, 2)}`,
  greed: 'M17 12L24 20L31 12M10 20H38M24 20V38',
  arcane: circ(24, 24, 4),
};

export interface ElementInfo {
  id: BallElement;
  index: number;
  name: string;
  color: string;
  family: BallFamily;
  /** description ≤ 60 caractères (tronquée proprement) */
  desc: string;
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
  return { id: d.id, index, name: d.name, color: d.color || FALLBACK_COLOR, family, desc: clip(d.description || '') };
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

/** ajoute la silhouette de famille (+ anneaux de rang) dans un <svg>/<g> en repère 48×48 */
export function appendBallShape(svg: SVGElement, family: BallFamily, color: string, tier: BallTier): void {
  if (tier >= 3) svg.append(svgEl('circle', { cx: 24, cy: 24, r: 22.5, fill: 'none', stroke: color, 'stroke-width': 2 }));
  if (tier >= 2) svg.append(svgEl('circle', { cx: 24, cy: 24, r: 19, fill: 'none', stroke: color, 'stroke-width': 2.5 }));
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
  appendBallShape(svg, info.family, info.color, tier);
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

/** Dessine la silhouette dans un canvas, centrée en (x, y), rayon apparent `r` (carte de partage). */
export function drawBallShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, family: BallFamily, color: string, tier: BallTier): void {
  const k = r / 14; // la silhouette occupe ≈ 28 unités sur 48
  ctx.save();
  ctx.translate(x - 24 * k, y - 24 * k);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
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
  ctx.fillStyle = color;
  if (body) {
    ctx.fill(body);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.stroke(body);
  }
  else {
    ctx.beginPath();
    ctx.arc(24, 24, 13, 0, Math.PI * 2);
    ctx.fill();
  }
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
