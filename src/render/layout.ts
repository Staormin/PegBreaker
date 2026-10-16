// render/layout.ts — layout portrait : plus grand rectangle 7:10 dans la zone de jeu,
// bandes HUD réservées en haut (~10 %) et en bas (~12 %). Calculé au resize uniquement.
import type { Vec2 } from '../core/types';

export const HUD_TOP = 0.10;
export const HUD_BOTTOM = 0.12;
export const MAX_DPR = 2;

export interface Layout {
  /** taille CSS du canvas */
  cssW: number;
  cssH: number;
  dpr: number;
  /** pixels CSS par unité plateau */
  scale: number;
  /** coin haut-gauche du plateau en pixels CSS */
  offX: number;
  offY: number;
  cols: number;
  rows: number;
  /** taille d'une cellule en pixels physiques (pour les sprites) */
  cellPx: number;
}

export function createLayout(cols: number, rows: number): Layout {
  return { cssW: 1, cssH: 1, dpr: 1, scale: 1, offX: 0, offY: 0, cols, rows, cellPx: 1 };
}

/** Lit la taille du parent du canvas et met à jour le canvas et le layout. */
export function computeLayout(l: Layout, canvas: HTMLCanvasElement, maxDpr: number = MAX_DPR): void {
  const parent = canvas.parentElement;
  const w = Math.max(1, parent ? parent.clientWidth : canvas.clientWidth || 360);
  const h = Math.max(1, parent ? parent.clientHeight : canvas.clientHeight || 640);
  const dprRaw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const dpr = Math.min(maxDpr, Math.max(1, dprRaw));
  l.cssW = w;
  l.cssH = h;
  l.dpr = dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const top = h * HUD_TOP;
  const availH = h * (1 - HUD_TOP - HUD_BOTTOM);
  const scale = Math.max(1, Math.min(w / l.cols, availH / l.rows));
  l.scale = scale;
  l.offX = (w - scale * l.cols) / 2;
  l.offY = top + (availH - scale * l.rows) / 2;
  l.cellPx = Math.max(4, Math.round(scale * dpr));
}

/** Pixels CSS relatifs au canvas → unités plateau. Écrit dans out si fourni. */
export function screenToBoard(l: Layout, px: number, py: number, out?: Vec2): Vec2 {
  const o = out ?? { x: 0, y: 0 };
  o.x = (px - l.offX) / l.scale;
  o.y = (py - l.offY) / l.scale;
  return o;
}

export function boardToScreen(l: Layout, p: Vec2, out?: Vec2): Vec2 {
  const o = out ?? { x: 0, y: 0 };
  o.x = l.offX + p.x * l.scale;
  o.y = l.offY + p.y * l.scale;
  return o;
}
