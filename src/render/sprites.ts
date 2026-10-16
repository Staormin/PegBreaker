// render/sprites.ts — sprites pré-rendus (canvas hors écran), régénérés au resize uniquement.
// Tout est dessiné par code : aucune image, aucune police externe.
import type { GameConfig } from '../core/types';
import type { Layout } from './layout';
import { ELEMENT_INDEX, ELEMENTS, KIND_INDEX, KINDS, PALETTE, shade, type Colors } from './palette';

/** Marge intérieure d'un bloc dans sa cellule (unités plateau). */
export const BLOCK_INSET = 0.05;
/** Rayon d'un peg (unités plateau), cf. conventions de collision. */
export const PEG_RADIUS = 0.3;
/** Demi-étendue d'un sprite de balle, en multiples du rayon. */
export const BALL_EXTENT = 2.4;
/**
 * Demi-étendue serrée par sprite (en multiples du rayon visuel) : un sprite plus petit = moins
 * de pixels à blitter. Le glow (feu, rang 3) a besoin de marge, le reste non.
 */
export function ballExtent(element: number, tier: number): number {
  if (tier === 3 || element === ELEMENT_INDEX.fire) return BALL_EXTENT;
  if (tier === 2) return 1.75;
  return element === ELEMENT_INDEX.lightning ? 1.7 : 1.3;
}
/** niveaux d'endommagement pré-composés et assombrissement associé */
export const DMG_LEVELS = 5;
const DMG_DARK: readonly number[] = [0, 0.1, 0.2, 0.3, 0.42];
/** niveau d'endommagement pour un ratio de PV (le dernier = fissures, PV < 30 %) */
export function damageLevel(ratio: number): number {
  return ratio >= 0.9 ? 0 : ratio >= 0.7 ? 1 : ratio >= 0.5 ? 2 : ratio >= 0.3 ? 3 : 4;
}
/** Demi-étendue d'un sprite de drop (unités plateau). */
export const DROP_EXTENT = 0.26;
/** Demi-étendue du halo (unités plateau). */
export const HALO_EXTENT = 0.5;

export interface Sprites {
  /** blocs : [kindIndex][largeur] */
  block: (HTMLCanvasElement | undefined)[][];
  /**
   * Accesseurs paresseux (créés au premier usage, puis en cache jusqu'au prochain resize) :
   * une bascule de qualité en pleine volée ne régénère que le strict nécessaire.
   */
  /** bloc endommagé pré-composé (teinte assombrie, fissures au dernier niveau) : un seul blit */
  damagedAt(kind: number, width: number, level: number): HTMLCanvasElement | undefined;
  /** silhouette blanche (flash d'impact, respiration) */
  whiteAt(kind: number, width: number): HTMLCanvasElement | undefined;
  /** surcouche gelée */
  frozenAt(width: number): HTMLCanvasElement | undefined;
  /** balle : elementIndex * 3 + (tier − 1) */
  ballAt(index: number): HTMLCanvasElement | undefined;
  /** demi-étendue de chaque sprite de balle (unités plateau), même index que ballAt */
  ballExt: number[];
  /** balle dorée (dernière de la volée) : même index que ballAt ; l'élément reste lisible par un anneau */
  goldenAt(index: number): HTMLCanvasElement | undefined;
  /** demi-étendue des sprites dorés (unités plateau) */
  goldenExt: number[];
  coin: HTMLCanvasElement;
  fragment: HTMLCanvasElement;
  heart: HTMLCanvasElement;
  halo: HTMLCanvasElement;
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

/** Contour extérieur d'un bloc (même géométrie que makeBlock). */
function blockShapePath(g: CanvasRenderingContext2D, kind: number, width: number, cell: number): void {
  const ins = BLOCK_INSET * cell;
  const W = width * cell, H = cell;
  const h = H - 2 * ins;
  if (kind === KIND_INDEX.peg) {
    g.beginPath(); g.arc(W / 2, H / 2, PEG_RADIUS * cell, 0, Math.PI * 2);
  } else if (kind === KIND_INDEX.heart) {
    heartPath(g, W / 2, H / 2 + h * 0.02, h * 0.5);
  } else {
    roundRectPath(g, ins, ins, W - 2 * ins, h, cell * 0.12);
  }
}

function makeMask(kind: number, width: number, cell: number, color: string): HTMLCanvasElement {
  const [c, g] = makeCanvas(width * cell, cell);
  g.fillStyle = color;
  blockShapePath(g, kind, width, cell);
  g.fill();
  return c;
}

/** Fissures pseudo-aléatoires mais stables (même dessin à chaque resize). */
function makeCracks(kind: number, width: number, cell: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(width * cell, cell);
  let seed = 1234 + kind * 97 + width * 13;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.save();
  blockShapePath(g, kind, width, cell);
  g.clip();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const branches = 2 + width;
  for (let pass = 0; pass < 2; pass++) {
    seed = 1234 + kind * 97 + width * 13;
    g.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.28)';
    g.lineWidth = Math.max(1, cell * (pass === 0 ? 0.035 : 0.015));
    const off = pass === 0 ? 0 : -Math.max(1, cell * 0.02);
    g.beginPath();
    for (let b = 0; b < branches; b++) {
      // part d'un bord, zigzague vers l'intérieur
      let x = (b + 0.5) * (c.width / branches) + (rnd() - 0.5) * cell * 0.3;
      let y = rnd() < 0.5 ? cell * 0.06 : cell * 0.94;
      const dir = y < cell / 2 ? 1 : -1;
      g.moveTo(x, y + off);
      for (let s = 0; s < 4; s++) {
        x += (rnd() - 0.5) * cell * 0.3;
        y += dir * cell * (0.08 + rnd() * 0.12);
        g.lineTo(x, y + off);
      }
    }
    g.stroke();
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

/** Rayon visuel d'une balle (unités plateau) selon l'élément et le rang. Visuel seulement. */
export const TIER_SCALE: readonly number[] = [1, 1.25, 1.5];
export function ballVisualRadius(radius: number, element: number, tier: number): number {
  return radius * (TIER_SCALE[tier - 1] ?? 1) * (element === ELEMENT_INDEX.lead ? 1.12 : 1);
}

/** Silhouette par élément : on doit reconnaître la balle sans la couleur. */
function makeBall(element: number, color: string, tier: number, radius: number, cell: number): HTMLCanvasElement {
  const vr = ballVisualRadius(radius, element, tier);
  const ext = vr * ballExtent(element, tier) * cell;
  const [c, g] = makeCanvas(ext * 2, ext * 2);
  const cx = c.width / 2, cy = c.height / 2, r = vr * cell;
  const lw = Math.max(1, r * 0.14);
  const dark = shade(color, -0.5);
  const light = shade(color, 0.55);
  const TAU = Math.PI * 2;

  if (tier === 3 || element === ELEMENT_INDEX.fire) {
    g.shadowColor = color;
    g.shadowBlur = r * (element === ELEMENT_INDEX.fire ? 1.4 : 1.6);
  }

  switch (element) {
    case ELEMENT_INDEX.fire: {
      // couronne de flammèches irrégulières + cœur chaud
      g.fillStyle = color;
      g.beginPath();
      const spikes = 9;
      for (let i = 0; i <= spikes * 2; i++) {
        const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
        const rr = i % 2 === 0 ? r * (1.38 + 0.18 * Math.sin(i * 2.1)) : r * 0.92;
        if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = shade(color, 0.35);
      g.beginPath(); g.arc(cx, cy, r * 0.78, 0, TAU); g.fill();
      g.fillStyle = '#fff3b0';
      g.beginPath(); g.arc(cx, cy + r * 0.1, r * 0.42, 0, TAU); g.fill();
      break;
    }
    case ELEMENT_INDEX.lightning: {
      // disque + 4 arcs électriques en croix + éclair sombre
      g.strokeStyle = light; g.lineWidth = lw; g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        const ca = Math.cos(a), sa = Math.sin(a);
        g.moveTo(cx + ca * r * 1.1, cy + sa * r * 1.1);
        g.lineTo(cx + ca * r * 1.35 - sa * r * 0.18, cy + sa * r * 1.35 + ca * r * 0.18);
        g.lineTo(cx + ca * r * 1.6, cy + sa * r * 1.6);
      }
      g.stroke();
      g.fillStyle = color;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.fillStyle = dark;
      g.beginPath();
      g.moveTo(cx + r * 0.15, cy - r * 0.75); g.lineTo(cx - r * 0.35, cy + r * 0.08); g.lineTo(cx - r * 0.02, cy + r * 0.08);
      g.lineTo(cx - r * 0.18, cy + r * 0.75); g.lineTo(cx + r * 0.38, cy - r * 0.12); g.lineTo(cx + r * 0.05, cy - r * 0.12);
      g.closePath(); g.fill();
      break;
    }
    case ELEMENT_INDEX.ice: {
      // hexagone facetté
      g.fillStyle = color;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU - Math.PI / 2;
        const x = cx + Math.cos(a) * r * 1.12, y = cy + Math.sin(a) * r * 1.12;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath();
      g.moveTo(cx, cy);
      for (let i = 4; i <= 6; i++) {
        const a = (i / 6) * TAU - Math.PI / 2;
        g.lineTo(cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 1.12);
      }
      g.closePath(); g.fill();
      g.strokeStyle = shade(color, -0.35); g.lineWidth = Math.max(1, lw * 0.7);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU - Math.PI / 2;
        g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 1.12);
      }
      g.stroke();
      break;
    }
    case ELEMENT_INDEX.ghost: {
      // silhouette de fantôme : dôme + bas ondulé + deux yeux
      g.fillStyle = color;
      g.beginPath();
      g.arc(cx, cy - r * 0.1, r * 1.0, Math.PI, 0);
      g.lineTo(cx + r, cy + r * 0.9);
      for (let i = 0; i < 4; i++) {
        const x0 = cx + r - (i + 0.5) * (r / 2);
        g.quadraticCurveTo(x0, cy + r * (i % 2 === 0 ? 0.45 : 1.2), cx + r - (i + 1) * (r / 2), cy + r * 0.9);
      }
      g.closePath(); g.fill();
      g.fillStyle = PALETTE.bg0;
      g.beginPath(); g.arc(cx - r * 0.35, cy - r * 0.15, r * 0.18, 0, TAU); g.fill();
      g.beginPath(); g.arc(cx + r * 0.35, cy - r * 0.15, r * 0.18, 0, TAU); g.fill();
      break;
    }
    case ELEMENT_INDEX.lead: {
      // sombre, lourd : contour épais, reflet terne, rivets
      g.fillStyle = color;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.strokeStyle = '#1a1e26'; g.lineWidth = Math.max(1.5, r * 0.26);
      g.beginPath(); g.arc(cx, cy, r * 0.8, 0, TAU); g.stroke();
      // liseré clair extérieur : lisible sur fond sombre malgré la teinte plomb
      g.strokeStyle = 'rgba(232,236,245,0.55)'; g.lineWidth = Math.max(1, r * 0.1);
      g.beginPath(); g.arc(cx, cy, r * 0.97, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.beginPath(); g.arc(cx - r * 0.28, cy - r * 0.28, r * 0.24, 0, TAU); g.fill();
      g.fillStyle = '#1a1e26';
      g.beginPath(); g.arc(cx + r * 0.3, cy + r * 0.25, r * 0.1, 0, TAU); g.fill();
      break;
    }
    case ELEMENT_INDEX.split: {
      // deux demi-disques séparés par une fente
      const gap = r * 0.2;
      g.fillStyle = color;
      g.beginPath(); g.arc(cx - gap, cy, r, Math.PI / 2, Math.PI * 1.5); g.closePath(); g.fill();
      g.beginPath(); g.arc(cx + gap, cy, r, -Math.PI / 2, Math.PI / 2); g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath(); g.arc(cx - gap - r * 0.35, cy - r * 0.35, r * 0.22, 0, TAU); g.fill();
      g.beginPath(); g.arc(cx + gap + r * 0.3, cy - r * 0.35, r * 0.18, 0, TAU); g.fill();
      break;
    }
    default: {
      // pierre : disque + reflet décalé (−30 %, −30 %)
      g.fillStyle = color;
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = shade(color, -0.45); g.lineWidth = lw;
      g.beginPath(); g.arc(cx, cy, r * 0.93, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath(); g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.32, 0, TAU); g.fill();
    }
  }
  g.shadowBlur = 0;
  if (tier >= 2) {
    g.strokeStyle = light; g.lineWidth = Math.max(1, r * 0.16);
    g.beginPath(); g.arc(cx, cy, r * 1.5, 0, TAU); g.stroke();
  }
  if (tier >= 3) {
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, r * 0.12);
    g.beginPath(); g.arc(cx, cy, r * 1.85, 0, TAU); g.stroke();
  }
  return c;
}

/** Demi-étendue d'un sprite de balle dorée, en multiples du rayon visuel (halo compris). */
export const GOLDEN_EXTENT = 2.6;

/**
 * Balle dorée : disque or avec dégradé et reflet, anneau de la couleur de l'élément, étoile de
 * reflet et halo doux pré-rendu (le dégradé et le flou sont faits ici, une fois par resize).
 */
function makeGoldenBall(element: number, elemColor: string, tier: number, radius: number, cell: number): HTMLCanvasElement {
  const vr = ballVisualRadius(radius, element, tier);
  const ext = vr * GOLDEN_EXTENT * cell;
  const [c, g] = makeCanvas(ext * 2, ext * 2);
  // un peu plus grosse qu'une balle normale du même rang : on la repère dans la volée
  const cx = c.width / 2, cy = c.height / 2, r = vr * cell * 1.12;
  const TAU = Math.PI * 2;
  // halo doux
  const halo = g.createRadialGradient(cx, cy, r * 0.8, cx, cy, ext);
  halo.addColorStop(0, 'rgba(255,194,61,0.55)');
  halo.addColorStop(0.45, 'rgba(255,194,61,0.2)');
  halo.addColorStop(1, 'rgba(255,194,61,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, c.width, c.height);
  // anneau élément (épais, lisible), légèrement lumineux
  g.shadowColor = PALETTE.gold;
  g.shadowBlur = r * 0.9;
  g.strokeStyle = elemColor;
  g.lineWidth = Math.max(1.5, r * 0.26);
  g.beginPath(); g.arc(cx, cy, r * 1.32, 0, TAU); g.stroke();
  g.shadowBlur = 0;
  // corps or : dégradé radial décalé (reflet en haut à gauche)
  const body = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  body.addColorStop(0, PALETTE.goldLight);
  body.addColorStop(0.45, PALETTE.gold);
  body.addColorStop(1, PALETTE.goldDark);
  g.fillStyle = body;
  g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  g.strokeStyle = shade(PALETTE.goldDark, -0.3);
  g.lineWidth = Math.max(1, r * 0.1);
  g.beginPath(); g.arc(cx, cy, r * 0.95, 0, TAU); g.stroke();
  // étoile de reflet (4 branches)
  const sx = cx - r * 0.3, sy = cy - r * 0.32, sl = r * 0.42, sw = r * 0.1;
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.moveTo(sx, sy - sl); g.lineTo(sx + sw, sy - sw); g.lineTo(sx + sl, sy); g.lineTo(sx + sw, sy + sw);
  g.lineTo(sx, sy + sl); g.lineTo(sx - sw, sy + sw); g.lineTo(sx - sl, sy); g.lineTo(sx - sw, sy - sw);
  g.closePath(); g.fill();
  // rangs : petits points de la couleur de l'élément sur l'anneau
  if (tier >= 2) {
    g.fillStyle = '#ffffff';
    for (let i = 0; i < tier; i++) {
      const a = -Math.PI / 2 + (i - (tier - 1) / 2) * 0.5;
      g.beginPath(); g.arc(cx + Math.cos(a) * r * 1.32, cy + Math.sin(a) * r * 1.32, r * 0.12, 0, TAU); g.fill();
    }
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

  // largeurs nécessaires : 1 + largeurs des boss de la config
  const widths: number[] = [1];
  for (const b of config.waves.bosses) if (!widths.includes(b.width)) widths.push(b.width);

  const block: (HTMLCanvasElement | undefined)[][] = [];
  for (let k = 0; k < KINDS.length; k++) {
    const row: (HTMLCanvasElement | undefined)[] = [];
    for (const w of widths) row[w] = makeBlock(k, w, cell, colors);
    block.push(row);
  }
  const damaged: (HTMLCanvasElement | undefined)[] = [];
  const white: (HTMLCanvasElement | undefined)[] = [];
  const darkMasks: (HTMLCanvasElement | undefined)[] = [];
  const crackMasks: (HTMLCanvasElement | undefined)[] = [];
  const frozen: (HTMLCanvasElement | undefined)[] = [];
  const maxW = widths.reduce((a, b) => (b > a ? b : a), 1) + 1;
  const keyKW = (k: number, w: number): number => k * maxW + w;

  function damagedAt(kind: number, width: number, lv: number): HTMLCanvasElement | undefined {
    if (kind === KIND_INDEX.peg || width >= maxW) return undefined;
    const key = keyKW(kind, width) * DMG_LEVELS + lv;
    const hit = damaged[key];
    if (hit) return hit;
    const base = block[kind]?.[width];
    if (!base) return undefined;
    const dk = keyKW(kind, width);
    const dark = darkMasks[dk] ?? (darkMasks[dk] = makeMask(kind, width, cell, '#000000'));
    const [c, g] = makeCanvas(base.width, base.height);
    g.drawImage(base, 0, 0);
    g.globalAlpha = DMG_DARK[lv] ?? 0;
    g.drawImage(dark, 0, 0);
    g.globalAlpha = 1;
    if (lv === DMG_LEVELS - 1) {
      const cr = crackMasks[dk] ?? (crackMasks[dk] = makeCracks(kind, width, cell));
      g.drawImage(cr, 0, 0);
    }
    damaged[key] = c;
    return c;
  }
  function whiteAt(kind: number, width: number): HTMLCanvasElement | undefined {
    if (width >= maxW) return undefined;
    const key = keyKW(kind, width);
    return white[key] ?? (white[key] = makeMask(kind, width, cell, '#ffffff'));
  }
  function frozenAt(width: number): HTMLCanvasElement | undefined {
    if (width >= maxW) return undefined;
    return frozen[width] ?? (frozen[width] = makeFrozen(width, cell));
  }

  const radius = config.blocks.board.ballRadius;
  const balls: (HTMLCanvasElement | undefined)[] = [];
  const ballExt: number[] = [];
  for (let e = 0; e < ELEMENTS.length; e++) {
    for (let t = 1; t <= 3; t++) ballExt.push(ballVisualRadius(radius, e, t) * ballExtent(e, t));
  }
  function ballAt(i: number): HTMLCanvasElement | undefined {
    const hit = balls[i];
    if (hit) return hit;
    if (i < 0 || i >= ELEMENTS.length * 3) return undefined;
    const e = Math.floor(i / 3), t = (i % 3) + 1;
    const c = makeBall(e, colors.element[e] ?? PALETTE.stone, t, radius, cell);
    balls[i] = c;
    return c;
  }
  const golden: (HTMLCanvasElement | undefined)[] = [];
  const goldenExt: number[] = [];
  for (let e = 0; e < ELEMENTS.length; e++) {
    for (let t = 1; t <= 3; t++) goldenExt.push(ballVisualRadius(radius, e, t) * GOLDEN_EXTENT);
  }
  function goldenAt(i: number): HTMLCanvasElement | undefined {
    const hit = golden[i];
    if (hit) return hit;
    if (i < 0 || i >= ELEMENTS.length * 3) return undefined;
    const e = Math.floor(i / 3), t = (i % 3) + 1;
    const c = makeGoldenBall(e, colors.element[e] ?? PALETTE.stone, t, radius, cell);
    golden[i] = c;
    return c;
  }

  return {
    block, damagedAt, whiteAt, frozenAt, ballAt, ballExt, goldenAt, goldenExt,
    coin: makeDrop('coin', cell), fragment: makeDrop('fragment', cell), heart: makeDrop('heart', cell),
    halo: makeHalo(cell),
  };
}
