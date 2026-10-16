// render/sprites.ts — sprites pré-rendus (canvas hors écran), régénérés au resize uniquement.
// Tout est dessiné par code : aucune image, aucune police externe.
import type { GameConfig } from '../core/types';
import type { Layout } from './layout';
import { ELEMENTS, KIND_INDEX, KINDS, PALETTE, shade, type Colors } from './palette';

/** Marge intérieure d'un bloc dans sa cellule (unités plateau). */
export const BLOCK_INSET = 0.05;
/** Rayon d'un peg (unités plateau), cf. conventions de collision. */
export const PEG_RADIUS = 0.3;
/** Demi-étendue d'un sprite de balle, en multiples du rayon. */
export const BALL_EXTENT = 2.4;
/** Demi-étendue d'un sprite de drop (unités plateau). */
export const DROP_EXTENT = 0.26;
/** Demi-étendue du halo (unités plateau). */
export const HALO_EXTENT = 0.5;

export interface Sprites {
  /** fond plein canvas (pixels physiques) */
  bg: HTMLCanvasElement;
  /** grille du plateau (cols × rows unités) */
  grid: HTMLCanvasElement;
  /** blocs : [kindIndex][largeur] */
  block: (HTMLCanvasElement | undefined)[][];
  /** surcouche gelée : [largeur] */
  frozen: (HTMLCanvasElement | undefined)[];
  /** balles : elementIndex * 3 + (tier − 1) */
  ball: HTMLCanvasElement[];
  coin: HTMLCanvasElement;
  fragment: HTMLCanvasElement;
  heart: HTMLCanvasElement;
  halo: HTMLCanvasElement;
  /** plein canvas */
  vignette: HTMLCanvasElement;
  redEdge: HTMLCanvasElement;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d');
  if (!g) throw new Error('render: contexte 2D indisponible');
  return [c, g];
}

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

/** Cœur centré en (cx, cy), demi-largeur s : deux arcs + triangle. */
export function heartPath(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const r = s * 0.5;
  g.beginPath();
  g.moveTo(cx, cy + s * 0.95);
  g.lineTo(cx - s * 0.98, cy - s * 0.02);
  g.arc(cx - r, cy - s * 0.25, r * 1.02, Math.PI * 0.8, Math.PI * 1.98, false);
  g.arc(cx + r, cy - s * 0.25, r * 1.02, Math.PI * 1.02, Math.PI * 0.2, false);
  g.lineTo(cx, cy + s * 0.95);
  g.closePath();
}

function diamondPath(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  g.beginPath();
  g.moveTo(cx, cy - ry);
  g.lineTo(cx + rx, cy);
  g.lineTo(cx, cy + ry);
  g.lineTo(cx - rx, cy);
  g.closePath();
}

function makeBlock(kind: number, width: number, cell: number, colors: Colors): HTMLCanvasElement {
  const [c, g] = makeCanvas(width * cell, cell);
  const color = colors.kind[kind] ?? PALETTE.block;
  const ins = BLOCK_INSET * cell;
  const x = ins, y = ins, w = c.width - 2 * ins, h = c.height - 2 * ins;
  const r = cell * 0.12;
  const px = Math.max(1, cell / 40);

  if (kind === KIND_INDEX.peg) {
    const cx = c.width / 2, cy = c.height / 2, pr = PEG_RADIUS * cell;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(cx, cy + px * 2, pr, 0, Math.PI * 2); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(cx, cy, pr, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath(); g.arc(cx - pr * 0.3, cy - pr * 0.3, pr * 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = PALETTE.bg1;
    g.beginPath(); g.arc(cx, cy, pr * 0.22, 0, Math.PI * 2); g.fill();
    return c;
  }

  if (kind === KIND_INDEX.heart) {
    const cx = c.width / 2, cy = c.height / 2 + h * 0.02, s = h * 0.5;
    g.fillStyle = shade(color, -0.45);
    heartPath(g, cx, cy + px * 2, s); g.fill();
    g.fillStyle = color;
    heartPath(g, cx, cy, s); g.fill();
    g.strokeStyle = shade(color, 0.45); g.lineWidth = px * 1.5;
    g.beginPath(); g.arc(cx - s * 0.5, cy - s * 0.25, s * 0.32, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
    return c;
  }

  // ombre portée sous le bloc
  g.fillStyle = 'rgba(0,0,0,0.35)';
  roundRectPath(g, x, y + px * 2, w, h, r); g.fill();
  // corps
  g.fillStyle = color;
  roundRectPath(g, x, y, w, h, r); g.fill();
  // liseré clair en haut, ombre en bas
  g.save();
  roundRectPath(g, x, y, w, h, r); g.clip();
  g.fillStyle = shade(color, -0.35);
  g.fillRect(x, y + h - h * 0.14, w, h * 0.14);
  g.fillStyle = shade(color, 0.45);
  g.fillRect(x, y, w, Math.max(px, h * 0.06));
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.fillRect(x, y, w, h * 0.45);

  if (kind === KIND_INDEX.armored) {
    // face protégée (haut + côtés) : bande hachurée ; le dessous reste nu (vulnérable)
    const band = h * 0.24;
    g.fillStyle = shade(color, -0.5);
    g.fillRect(x, y, w, band);
    g.fillRect(x, y, w * 0.1, h * 0.8);
    g.fillRect(x + w * 0.9, y, w * 0.1, h * 0.8);
    g.strokeStyle = shade(color, 0.55);
    g.lineWidth = Math.max(1, cell * 0.035);
    g.beginPath();
    const step = cell * 0.14;
    for (let i = -band; i < w + band; i += step) {
      g.moveTo(x + i, y + band);
      g.lineTo(x + i + band, y);
    }
    g.stroke();
    g.fillStyle = shade(color, 0.5);
    g.fillRect(x, y + band - px, w, px);
  } else if (kind === KIND_INDEX.explosive) {
    // triangle « ! » en négatif, discret en coin pour laisser les PV lisibles
    const tx = x + w * 0.8, ty = y + h * 0.2, ts = h * 0.17;
    g.fillStyle = shade(color, -0.55);
    g.beginPath(); g.moveTo(tx, ty - ts); g.lineTo(tx + ts, ty + ts * 0.8); g.lineTo(tx - ts, ty + ts * 0.8); g.closePath(); g.fill();
    g.fillStyle = color;
    g.fillRect(tx - ts * 0.11, ty - ts * 0.45, ts * 0.22, ts * 0.75);
    g.fillRect(tx - ts * 0.11, ty + ts * 0.42, ts * 0.22, ts * 0.22);
    // bordure crantée
    g.strokeStyle = shade(color, -0.4); g.lineWidth = Math.max(1, cell * 0.03);
    g.setLineDash([cell * 0.08, cell * 0.06]);
    roundRectPath(g, x + cell * 0.06, y + cell * 0.06, w - cell * 0.12, h - cell * 0.12, r * 0.6); g.stroke();
    g.setLineDash([]);
  } else if (kind === KIND_INDEX.boss) {
    // motif : bandes sombres + bouche
    g.fillStyle = shade(color, -0.3);
    for (let i = 0; i < width; i++) g.fillRect(x + (i + 0.5) * (w / width) - px, y + h * 0.1, px * 2, h * 0.15);
  }
  g.restore();
  return c;
}

function makeFrozen(width: number, cell: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(width * cell, cell);
  const ins = BLOCK_INSET * cell;
  const w = c.width - 2 * ins, h = c.height - 2 * ins;
  g.fillStyle = 'rgba(127,228,255,0.38)';
  roundRectPath(g, ins, ins, w, h, cell * 0.12); g.fill();
  g.strokeStyle = 'rgba(220,250,255,0.9)';
  g.lineWidth = Math.max(1, cell * 0.03);
  roundRectPath(g, ins, ins, w, h, cell * 0.12); g.stroke();
  // cristaux en coin
  g.fillStyle = 'rgba(235,252,255,0.85)';
  for (let i = 0; i < width; i++) {
    const bx = ins + i * cell;
    diamondPath(g, bx + cell * 0.16, ins + cell * 0.2, cell * 0.05, cell * 0.12); g.fill();
    diamondPath(g, bx + cell * 0.8, ins + h - cell * 0.2, cell * 0.04, cell * 0.1); g.fill();
  }
  return c;
}

function makeBall(color: string, tier: number, radius: number, cell: number): HTMLCanvasElement {
  const ext = radius * BALL_EXTENT * cell;
  const [c, g] = makeCanvas(ext * 2, ext * 2);
  const cx = c.width / 2, cy = c.height / 2, r = radius * cell;
  if (tier === 3) {
    g.shadowColor = color;
    g.shadowBlur = r * 1.6;
  }
  g.fillStyle = color;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = shade(color, -0.45); g.lineWidth = Math.max(1, r * 0.14);
  g.beginPath(); g.arc(cx, cy, r * 0.93, 0, Math.PI * 2); g.stroke();
  // reflet décalé (−30 %, −30 %)
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.beginPath(); g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.32, 0, Math.PI * 2); g.fill();
  if (tier >= 2) {
    g.strokeStyle = shade(color, 0.5); g.lineWidth = Math.max(1, r * 0.18);
    g.beginPath(); g.arc(cx, cy, r * 1.45, 0, Math.PI * 2); g.stroke();
  }
  if (tier >= 3) {
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, r * 0.14);
    g.beginPath(); g.arc(cx, cy, r * 1.85, 0, Math.PI * 2); g.stroke();
  }
  return c;
}

function makeDrop(kind: 'coin' | 'fragment' | 'heart', cell: number): HTMLCanvasElement {
  const ext = DROP_EXTENT * cell;
  const [c, g] = makeCanvas(ext * 2, ext * 2);
  const cx = c.width / 2, cy = c.height / 2, s = ext * 0.72;
  const lw = Math.max(1, cell * 0.025);
  if (kind === 'coin') {
    g.fillStyle = shade(PALETTE.coin, -0.45);
    g.beginPath(); g.arc(cx, cy + lw, s, 0, Math.PI * 2); g.fill();
    g.fillStyle = PALETTE.coin;
    g.beginPath(); g.arc(cx, cy, s, 0, Math.PI * 2); g.fill();
    g.strokeStyle = shade(PALETTE.coin, -0.3); g.lineWidth = lw;
    g.beginPath(); g.arc(cx, cy, s * 0.62, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(cx - s * 0.35, cy - s * 0.35, s * 0.2, 0, Math.PI * 2); g.fill();
  } else if (kind === 'fragment') {
    g.fillStyle = PALETTE.fragment;
    diamondPath(g, cx, cy, s * 0.7, s * 1.05); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    diamondPath(g, cx - s * 0.17, cy - s * 0.25, s * 0.25, s * 0.42); g.fill();
    g.strokeStyle = shade(PALETTE.fragment, -0.5); g.lineWidth = lw;
    diamondPath(g, cx, cy, s * 0.7, s * 1.05); g.stroke();
  } else {
    g.fillStyle = shade(PALETTE.heart, -0.45);
    heartPath(g, cx, cy + lw, s); g.fill();
    g.fillStyle = PALETTE.heart;
    heartPath(g, cx, cy, s); g.fill();
  }
  return c;
}

function makeHalo(cell: number): HTMLCanvasElement {
  const ext = HALO_EXTENT * cell;
  const [c, g] = makeCanvas(ext * 2, ext * 2);
  const grad = g.createRadialGradient(ext, ext, 0, ext, ext, ext);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export function buildSprites(l: Layout, colors: Colors, config: GameConfig): Sprites {
  const cell = l.cellPx;
  const W = Math.round(l.cssW * l.dpr), H = Math.round(l.cssH * l.dpr);

  // fond : dégradé vertical bg0 → bg1
  const [bg, gb] = makeCanvas(W, H);
  const grad = gb.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, PALETTE.bg0);
  grad.addColorStop(1, PALETTE.bg1);
  gb.fillStyle = grad;
  gb.fillRect(0, 0, W, H);

  // grille du plateau, alpha 0,06
  const [grid, gg] = makeCanvas(l.cols * cell, l.rows * cell);
  gg.fillStyle = 'rgba(11,15,26,0.55)';
  gg.fillRect(0, 0, grid.width, grid.height);
  gg.strokeStyle = 'rgba(232,236,245,0.06)';
  gg.lineWidth = Math.max(1, cell / 50);
  gg.beginPath();
  for (let i = 1; i < l.cols; i++) { gg.moveTo(i * cell + 0.5, 0); gg.lineTo(i * cell + 0.5, grid.height); }
  for (let j = 1; j < l.rows; j++) { gg.moveTo(0, j * cell + 0.5); gg.lineTo(grid.width, j * cell + 0.5); }
  gg.stroke();
  // rangée du joueur : teinte danger très discrète
  gg.fillStyle = 'rgba(255,94,94,0.05)';
  gg.fillRect(0, (l.rows - 1) * cell, grid.width, cell);

  // largeurs nécessaires : 1 + largeurs des boss de la config
  const widths: number[] = [1];
  for (const b of config.waves.bosses) if (!widths.includes(b.width)) widths.push(b.width);

  const block: (HTMLCanvasElement | undefined)[][] = [];
  for (let k = 0; k < KINDS.length; k++) {
    const row: (HTMLCanvasElement | undefined)[] = [];
    for (const w of widths) row[w] = makeBlock(k, w, cell, colors);
    block.push(row);
  }
  const frozen: (HTMLCanvasElement | undefined)[] = [];
  for (const w of widths) frozen[w] = makeFrozen(w, cell);

  const radius = config.blocks.board.ballRadius;
  const ball: HTMLCanvasElement[] = [];
  for (let e = 0; e < ELEMENTS.length; e++) {
    for (let t = 1; t <= 3; t++) ball.push(makeBall(colors.element[e] ?? PALETTE.stone, t, radius, cell));
  }

  // vignette (combo niv. 3) et bords rouges (dégâts joueur)
  const [vignette, gv] = makeCanvas(W, H);
  const vr = Math.hypot(W, H) / 2;
  const vg = gv.createRadialGradient(W / 2, H / 2, vr * 0.45, W / 2, H / 2, vr);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.75)');
  gv.fillStyle = vg; gv.fillRect(0, 0, W, H);
  const vg2 = gv.createRadialGradient(W / 2, H / 2, vr * 0.6, W / 2, H / 2, vr);
  vg2.addColorStop(0, 'rgba(255,233,92,0)');
  vg2.addColorStop(1, 'rgba(255,233,92,0.22)');
  gv.fillStyle = vg2; gv.fillRect(0, 0, W, H);

  const [redEdge, gr] = makeCanvas(W, H);
  const e = Math.min(W, H) * 0.14;
  const sides: [number, number, number, number][] = [[0, 0, 0, e], [0, H, 0, H - e], [0, 0, e, 0], [W, 0, W - e, 0]];
  for (const [x0, y0, x1, y1] of sides) {
    const lg = gr.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, 'rgba(255,94,94,0.85)');
    lg.addColorStop(1, 'rgba(255,94,94,0)');
    gr.fillStyle = lg;
    gr.fillRect(0, 0, W, H);
  }

  return {
    bg, grid, block, frozen, ball,
    coin: makeDrop('coin', cell), fragment: makeDrop('fragment', cell), heart: makeDrop('heart', cell),
    halo: makeHalo(cell), vignette, redEdge,
  };
}
