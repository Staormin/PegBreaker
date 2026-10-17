// render/sprites.ts — sprites pré-rendus (canvas hors écran), régénérés au resize uniquement.
// Tout est dessiné par code : aucune image, aucune police externe.
import type { BallElement, GameConfig } from '../core/types';
import type { Layout } from './layout';
import { ELEMENT_INDEX, ELEMENTS, KIND_INDEX, KINDS, PALETTE, shade, type Colors } from './palette';


/** Marge intérieure d'un bloc dans sa cellule (unités plateau). */
export const BLOCK_INSET = 0.05;
/** Rayon d'un peg (unités plateau), cf. conventions de collision. */
export const PEG_RADIUS = 0.3;
/** Demi-étendue d'un sprite de balle, en multiples du rayon. */
export const BALL_EXTENT = 2.4;
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

/** budget de créations de sprites par frame, partagé entre générations de Sprites (remis à zéro par le dessin) */
export interface SpriteBudget { n: number; }
/** sprites (tous types confondus) créés au plus par frame quand une génération précédente peut servir de repli */
export const SPRITE_BUILD_BUDGET = 2;

export interface Sprites {
  /** taille d'une cellule (px physiques) de cette génération */
  readonly cell: number;
  /**
   * Échelle à appliquer au dernier sprite renvoyé : 1 pour un sprite de cette génération, sinon
   * rapport de cellules quand le sprite vient de la génération précédente (repli pendant la
   * régénération étalée après un resize / changement de qualité). Lu juste après l'accesseur.
   */
  scale: number;
  /** bloc pré-composé : base + assombrissement (niveau) + fissures (dernier niveau) + acide (0/1) : un seul blit */
  blockAt(kind: number, width: number, level: number, acid: number): HTMLCanvasElement | undefined;
  /** silhouette blanche (flash d'impact, respiration) */
  whiteAt(kind: number, width: number): HTMLCanvasElement | undefined;
  /** surcouche gelée */
  frozenAt(width: number): HTMLCanvasElement | undefined;
  /**
   * balle : index = elementIndex * 3 + (tier − 1) ; rq = rayon quantifié (RQ_ONE = rayon de config,
   * cf. quantizeRadius) ; rot = cran d'orientation 0..ROT_STEPS-1 (ignoré pour les éléments fixes).
   */
  ball(index: number, rq: number, rot: number): HTMLCanvasElement | undefined;
  /** pré-chauffe les sprites (tous les crans) d'une balle dans la limite du budget ; true = complet */
  warm(index: number, rq: number): boolean;
  /** balle de taille standard, orientée vers le haut (lancement, galerie, drops, fusion) */
  ballAt(index: number): HTMLCanvasElement | undefined;
  /** demi-étendue de chaque sprite de balle à rq = RQ_ONE (unités plateau), même index que ballAt ; × rq / RQ_ONE sinon.
   *  Exception : la Divine, mesurée à rq = divineRq (× rq / divineRq). */
  ballExt: number[];
  /** rayon quantifié minimal de la Divine (rayon de config × radiusMult) : ball() ne descend jamais en dessous */
  readonly divineRq: number;
  /** balle dorée (dernière de la volée) : même index que ballAt ; l'élément reste lisible par un anneau */
  goldenAt(index: number): HTMLCanvasElement | undefined;
  /** demi-étendue des sprites dorés (unités plateau) */
  goldenExt: number[];
  /** lecture seule du cache (repli d'une génération suivante) */
  peek(key: number): HTMLCanvasElement | undefined;
  /** une frame sans repli de plus : libère la génération précédente quand elle ne sert plus */
  endFrame(): void;
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
const EL_GIANT = ELEMENT_INDEX.giant, EL_LEAD = ELEMENT_INDEX.lead;
export const EL_DIVINE = ELEMENT_INDEX.divine;
export function ballVisualRadius(radius: number, element: number, tier: number): number {
  // géante : son rayon de sim grandit déjà avec le rang (radiusMult) ; le rang se lit aux anneaux.
  // Divine : rayon ×1,3 (radiusMult) ; le rendu impose ce minimum via Sprites.divineRq (cf. ball()).
  if (element === EL_GIANT || element === EL_DIVINE) return radius;
  return radius * (TIER_SCALE[tier - 1] ?? 1) * (element === EL_LEAD ? 1.12 : 1);
}

/**
 * Orientation des sprites : 0 = fixe, 1 = suit la vitesse (comète, perforante, traqueuse),
 * 2 = tourne sur elle-même (boomerang). Les sprites orientés sont pré-rendus en ROT_STEPS crans.
 */
export const ORIENT_NONE = 0;
export const ORIENT_VELOCITY = 1;
export const ORIENT_SPIN = 2;
export const ROT_STEPS = 16;
/** cran « vers le haut » (affichage statique : point de lancement, galerie, drops) */
export const ROT_UP = (ROT_STEPS * 3) / 4;
const ORIENT_BY_ID: Partial<Record<BallElement, number>> = {
  comet: ORIENT_VELOCITY, pierce: ORIENT_VELOCITY, homing: ORIENT_VELOCITY, boomerang: ORIENT_SPIN,
  // hybrides héritières : le missile suit sa vitesse (flèche), l'orbite tourne (satellite)
  missile: ORIENT_VELOCITY, orbit: ORIENT_SPIN,
};
export const ELEMENT_ORIENT: Uint8Array = new Uint8Array(ELEMENTS.length);
for (let i = 0; i < ELEMENTS.length; i++) ELEMENT_ORIENT[i] = ORIENT_BY_ID[ELEMENTS[i]!] ?? ORIENT_NONE;

/** Rayon quantifié : RQ_ONE = rayon de config ; mini-balles et géante ont leur propre sprite. */
export const RQ_ONE = 20;
export const RQ_MAX = 63;
export function quantizeRadius(radius: number, base: number): number {
  const q = Math.round((radius / base) * RQ_ONE);
  return q < 1 ? 1 : q > RQ_MAX ? RQ_MAX : q;
}

/** Demi-étendue propre à la forme (multiples du rayon visuel), sans anneau de rang ni glow. */
const SHAPE_EXT: Partial<Record<BallElement, number>> = {
  fire: BALL_EXTENT, lightning: 1.7, comet: 2.75, acid: 1.75, bomb: 1.7, shock: 1.8, nova: 1.5,
  prism: 1.4, boomerang: 1.5, pierce: 1.5, echo: 1.5, lucky: 1.4, magnet: 1.35,
  divine: 2.35,
};
/**
 * Demi-étendue serrée par sprite (en multiples du rayon visuel) : un sprite plus petit = moins
 * de pixels à blitter. Le glow (feu, rang 3) et les queues ont besoin de marge, le reste non.
 */
export function ballExtent(element: number, tier: number): number {
  const shape = SHAPE_EXT[ELEMENTS[element] ?? 'stone'] ?? 1.3;
  if (tier === 3) return shape > BALL_EXTENT ? shape : BALL_EXTENT;
  if (tier === 2) return shape > 1.75 ? shape : 1.75;
  return shape;
}

const TAU = Math.PI * 2;
function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}
function ring(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
}
/** étoile à n branches (rayons ro / ri), première branche vers a0 */
function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, n: number, ro: number, ri: number, a0: number): void {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = a0 + (i / (n * 2)) * TAU;
    const rr = i % 2 === 0 ? ro : ri;
    if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}
/** petit éclair en zigzag de (x0,y0) vers l'extérieur selon l'angle a, longueur len */
function zigzag(g: CanvasRenderingContext2D, x0: number, y0: number, a: number, len: number, jag: number): void {
  const ca = Math.cos(a), sa = Math.sin(a);
  g.moveTo(x0, y0);
  g.lineTo(x0 + ca * len * 0.4 - sa * jag, y0 + sa * len * 0.4 + ca * jag);
  g.lineTo(x0 + ca * len * 0.6 + sa * jag, y0 + sa * len * 0.6 - ca * jag);
  g.lineTo(x0 + ca * len, y0 + sa * len);
}
/** reflet standard (−30 %, −30 %) */
function gloss(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number): void {
  g.fillStyle = `rgba(255,255,255,${alpha})`;
  disc(g, cx - r * 0.3, cy - r * 0.3, r * 0.26);
}

/**
 * Rune centrale d'une hybride (13 glyphes distincts), tracée dans un carré de demi-côté s.
 * Les glyphes orientés (missile) pointent vers +x, comme les autres formes orientées.
 */
function hybridGlyph(g: CanvasRenderingContext2D, id: BallElement, cx: number, cy: number, s: number): void {
  g.beginPath();
  switch (id) {
    case 'steam': // volute qui monte et s'enroule
      g.moveTo(cx - s * 0.75, cy + s * 0.85);
      g.quadraticCurveTo(cx + s * 0.95, cy + s * 0.55, cx + s * 0.4, cy - s * 0.3);
      g.arc(cx, cy - s * 0.3, s * 0.4, 0, -Math.PI * 1.35, true);
      g.stroke();
      return;
    case 'laser': // croix + point central
      g.moveTo(cx, cy - s); g.lineTo(cx, cy + s);
      g.moveTo(cx - s, cy); g.lineTo(cx + s, cy);
      g.stroke();
      disc(g, cx, cy, s * 0.26);
      return;
    case 'cluster': // trois points
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i / 3) * TAU;
        disc(g, cx + Math.cos(a) * s * 0.58, cy + Math.sin(a) * s * 0.58, s * 0.33);
      }
      return;
    case 'wraith': // œil fendu
      g.moveTo(cx - s, cy);
      g.quadraticCurveTo(cx, cy - s * 0.95, cx + s, cy);
      g.quadraticCurveTo(cx, cy + s * 0.95, cx - s, cy);
      g.closePath(); g.stroke();
      g.beginPath(); g.ellipse(cx, cy, s * 0.15, s * 0.42, 0, 0, TAU); g.fill();
      return;
    case 'abyss': // spirale (2,25 tours)
      for (let i = 0; i <= 44; i++) {
        const t = i / 44, a = t * TAU * 2.25 - Math.PI / 2, rr = s * (0.06 + t * 0.94);
        if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.stroke();
      return;
    case 'jackpot': // « 7 »
      g.moveTo(cx - s * 0.62, cy - s * 0.78); g.lineTo(cx + s * 0.62, cy - s * 0.78); g.lineTo(cx - s * 0.12, cy + s * 0.9);
      g.moveTo(cx - s * 0.2, cy + s * 0.02); g.lineTo(cx + s * 0.42, cy + s * 0.02);
      g.stroke();
      return;
    case 'quake': // zigzag sismographe
      g.moveTo(cx - s, cy);
      g.lineTo(cx - s * 0.6, cy - s * 0.55); g.lineTo(cx - s * 0.2, cy + s * 0.6);
      g.lineTo(cx + s * 0.2, cy - s * 0.6); g.lineTo(cx + s * 0.6, cy + s * 0.55); g.lineTo(cx + s, cy);
      g.stroke();
      return;
    case 'missile': // flèche (+x) avec empennage
      g.moveTo(cx - s * 0.95, cy); g.lineTo(cx + s * 0.85, cy);
      g.moveTo(cx + s * 0.2, cy - s * 0.62); g.lineTo(cx + s, cy); g.lineTo(cx + s * 0.2, cy + s * 0.62);
      g.moveTo(cx - s * 0.95, cy - s * 0.42); g.lineTo(cx - s * 0.55, cy);
      g.moveTo(cx - s * 0.95, cy + s * 0.42); g.lineTo(cx - s * 0.55, cy);
      g.stroke();
      return;
    case 'supernova': // étoile à 8 branches
      starPath(g, cx, cy, 8, s * 1.08, s * 0.42, -Math.PI / 2); g.fill();
      return;
    case 'plague': // goutte barrée
      g.moveTo(cx, cy - s);
      g.quadraticCurveTo(cx + s * 0.72, cy - s * 0.15, cx + s * 0.66, cy + s * 0.3);
      g.arc(cx, cy + s * 0.3, s * 0.66, 0, Math.PI);
      g.quadraticCurveTo(cx - s * 0.72, cy - s * 0.15, cx, cy - s);
      g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(cx - s * 0.95, cy + s * 0.85); g.lineTo(cx + s * 0.95, cy - s * 0.6); g.stroke();
      return;
    case 'choir': // trois traits (celui du milieu plus haut)
      g.moveTo(cx - s * 0.58, cy - s * 0.5); g.lineTo(cx - s * 0.58, cy + s * 0.75);
      g.moveTo(cx, cy - s * 0.9); g.lineTo(cx, cy + s * 0.75);
      g.moveTo(cx + s * 0.58, cy - s * 0.5); g.lineTo(cx + s * 0.58, cy + s * 0.75);
      g.stroke();
      return;
    case 'orbit': // anneau + satellite
      g.arc(cx, cy, s * 0.72, 0, TAU); g.stroke();
      disc(g, cx + Math.cos(-Math.PI / 4) * s * 0.72, cy + Math.sin(-Math.PI / 4) * s * 0.72, s * 0.3);
      disc(g, cx, cy, s * 0.18);
      return;
    case 'hammer': // T
      g.moveTo(cx - s * 0.9, cy - s * 0.6); g.lineTo(cx + s * 0.9, cy - s * 0.6);
      g.moveTo(cx, cy - s * 0.6); g.lineTo(cx, cy + s * 0.95);
      g.stroke();
      return;
    default: // hybride inconnue : losange
      diamondPath(g, cx, cy, s * 0.6, s * 0.9); g.stroke();
  }
}

/**
 * Hybride : disque coupé en diagonale en deux moitiés aux couleurs des parents (recette), cerclé
 * de la couleur de l'hybride, avec une pastille sombre portant la rune propre à l'hybride.
 */
function drawHybrid(g: CanvasRenderingContext2D, id: BallElement, color: string, pa: string, pb: string, cx: number, cy: number, r: number): void {
  // liseré extérieur (et glow de rang III, réglé par l'appelant) à la couleur de l'hybride
  g.fillStyle = color;
  disc(g, cx, cy, r);
  g.shadowBlur = 0;
  g.strokeStyle = shade(color, -0.5); g.lineWidth = Math.max(1, r * 0.07);
  ring(g, cx, cy, r * 0.97);
  const a = -Math.PI / 4, ri = r * 0.84;
  g.fillStyle = pa;
  g.beginPath(); g.arc(cx, cy, ri, a + Math.PI, a + TAU); g.closePath(); g.fill();
  g.fillStyle = pb;
  g.beginPath(); g.arc(cx, cy, ri, a, a + Math.PI); g.closePath(); g.fill();
  // couture sombre le long de la coupe
  g.strokeStyle = 'rgba(11,15,26,0.7)'; g.lineWidth = Math.max(1, r * 0.08); g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri);
  g.lineTo(cx - Math.cos(a) * ri, cy - Math.sin(a) * ri);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.6)';
  disc(g, cx - r * 0.5, cy - r * 0.18, r * 0.14);
  // pastille de la rune
  g.fillStyle = 'rgba(11,15,26,0.82)';
  disc(g, cx, cy, r * 0.52);
  g.strokeStyle = color; g.lineWidth = Math.max(1, r * 0.07);
  ring(g, cx, cy, r * 0.52);
  const glyph = shade(color, 0.7);
  g.strokeStyle = glyph; g.fillStyle = glyph;
  g.lineWidth = Math.max(1, r * (id === 'jackpot' || id === 'hammer' ? 0.12 : 0.09));
  g.lineCap = 'round'; g.lineJoin = 'round';
  hybridGlyph(g, id, cx, cy, r * 0.33);
}

/** Divine : disque blanc-or radiant, halo pré-rendu et 8 rayons (alternés long / court). */
function drawDivine(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.shadowBlur = 0;
  const hr = r * 2.3;
  const halo = g.createRadialGradient(cx, cy, r * 0.5, cx, cy, hr);
  halo.addColorStop(0, 'rgba(255,230,140,0.6)');
  halo.addColorStop(0.4, 'rgba(255,194,61,0.22)');
  halo.addColorStop(1, 'rgba(255,194,61,0)');
  g.fillStyle = halo;
  disc(g, cx, cy, hr);
  // rayons
  g.fillStyle = 'rgba(255,242,184,0.9)';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const len = r * (i % 2 === 0 ? 2.2 : 1.6), w = r * (i % 2 === 0 ? 0.2 : 0.14);
    const ca = Math.cos(a), sa = Math.sin(a);
    g.moveTo(cx + ca * r * 0.7 - sa * w, cy + sa * r * 0.7 + ca * w);
    g.lineTo(cx + ca * len, cy + sa * len);
    g.lineTo(cx + ca * r * 0.7 + sa * w, cy + sa * r * 0.7 - ca * w);
    g.closePath();
  }
  g.fill();
  // corps blanc-or lumineux
  g.shadowColor = PALETTE.gold;
  g.shadowBlur = r * 0.9;
  const body = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.05, cx, cy, r);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.5, PALETTE.goldLight);
  body.addColorStop(1, PALETTE.gold);
  g.fillStyle = body;
  disc(g, cx, cy, r);
  g.shadowBlur = 0;
  g.strokeStyle = PALETTE.goldDark; g.lineWidth = Math.max(1, r * 0.08);
  ring(g, cx, cy, r * 0.95);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, r * 0.06);
  ring(g, cx, cy, r * 0.62);
  g.fillStyle = '#ffffff';
  starPath(g, cx, cy, 4, r * 0.42, r * 0.11, -Math.PI / 2); g.fill();
}

/**
 * Silhouette par élément : on doit reconnaître la balle sans la couleur (une forme par balle,
 * une parenté par famille). `rot` (radians) n'est utilisé que pour les éléments orientés ; les
 * formes orientées sont dessinées « vers +x » puis tournées.
 */
function makeBall(element: number, color: string, tier: number, radius: number, cell: number, rot: number, pa: string | null, pb: string | null): HTMLCanvasElement {
  const id: BallElement = ELEMENTS[element] ?? 'stone';
  const vr = ballVisualRadius(radius, element, tier);
  const ext = vr * ballExtent(element, tier) * cell;
  const [c, g] = makeCanvas(ext * 2, ext * 2);
  const cx = c.width / 2, cy = c.height / 2, r = vr * cell;
  const lw = Math.max(1, r * 0.14);
  const dark = shade(color, -0.5);
  const light = shade(color, 0.55);

  if (tier === 3 || id === 'fire' || id === 'comet' || id === 'nova') {
    g.shadowColor = color;
    g.shadowBlur = r * (id === 'fire' ? 1.4 : tier === 3 ? 1.6 : 0.9);
  }
  if ((ELEMENT_ORIENT[element] ?? 0) !== ORIENT_NONE) {
    g.translate(cx, cy); g.rotate(rot); g.translate(-cx, -cy);
  }

  if (id === 'divine') drawDivine(g, cx, cy, r);
  else if (pa !== null && pb !== null) drawHybrid(g, id, color, pa, pb, cx, cy, r);
  else switch (id) {
    case 'fire': {
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
      disc(g, cx, cy, r * 0.78);
      g.fillStyle = '#fff3b0';
      disc(g, cx, cy + r * 0.1, r * 0.42);
      break;
    }
    case 'lightning': {
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
      disc(g, cx, cy, r);
      g.fillStyle = dark;
      g.beginPath();
      g.moveTo(cx + r * 0.15, cy - r * 0.75); g.lineTo(cx - r * 0.35, cy + r * 0.08); g.lineTo(cx - r * 0.02, cy + r * 0.08);
      g.lineTo(cx - r * 0.18, cy + r * 0.75); g.lineTo(cx + r * 0.38, cy - r * 0.12); g.lineTo(cx + r * 0.05, cy - r * 0.12);
      g.closePath(); g.fill();
      break;
    }
    case 'ice': {
      // hexagone facetté (pointe en haut, rayons depuis le centre)
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
    case 'ghost': {
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
      disc(g, cx - r * 0.35, cy - r * 0.15, r * 0.18);
      disc(g, cx + r * 0.35, cy - r * 0.15, r * 0.18);
      break;
    }
    case 'lead': {
      // sombre, lourd : contour épais, reflet terne, rivets
      g.fillStyle = color;
      disc(g, cx, cy, r);
      g.strokeStyle = '#1a1e26'; g.lineWidth = Math.max(1.5, r * 0.26);
      ring(g, cx, cy, r * 0.8);
      // liseré clair extérieur : lisible sur fond sombre malgré la teinte plomb
      g.strokeStyle = 'rgba(232,236,245,0.55)'; g.lineWidth = Math.max(1, r * 0.1);
      ring(g, cx, cy, r * 0.97);
      g.fillStyle = 'rgba(255,255,255,0.28)';
      disc(g, cx - r * 0.28, cy - r * 0.28, r * 0.24);
      g.fillStyle = '#1a1e26';
      disc(g, cx + r * 0.3, cy + r * 0.25, r * 0.1);
      break;
    }
    case 'split': {
      // deux demi-disques séparés par une fente
      const gap = r * 0.2;
      g.fillStyle = color;
      g.beginPath(); g.arc(cx - gap, cy, r, Math.PI / 2, Math.PI * 1.5); g.closePath(); g.fill();
      g.beginPath(); g.arc(cx + gap, cy, r, -Math.PI / 2, Math.PI / 2); g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.6)';
      disc(g, cx - gap - r * 0.35, cy - r * 0.35, r * 0.22);
      disc(g, cx + gap + r * 0.3, cy - r * 0.35, r * 0.18);
      break;
    }

    // ---------------- elemental ----------------
    case 'acid': {
      // goutte (pointe en haut) qui dégouline : deux coulures pendent sous le corps
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(cx, cy - r * 1.3);
      g.quadraticCurveTo(cx + r * 0.95, cy - r * 0.4, cx + r * 0.95, cy + r * 0.12);
      g.arc(cx, cy + r * 0.12, r * 0.95, 0, Math.PI);
      g.quadraticCurveTo(cx - r * 0.95, cy - r * 0.4, cx, cy - r * 1.3);
      g.closePath(); g.fill();
      // coulures
      g.fillRect(cx + r * 0.26, cy + r * 0.8, r * 0.2, r * 0.6);
      disc(g, cx + r * 0.36, cy + r * 1.42, r * 0.17);
      g.fillRect(cx - r * 0.42, cy + r * 0.8, r * 0.14, r * 0.32);
      disc(g, cx - r * 0.35, cy + r * 1.14, r * 0.12);
      g.shadowBlur = 0;
      // bulles sombres + reflet
      g.fillStyle = shade(color, -0.45);
      disc(g, cx + r * 0.25, cy + r * 0.25, r * 0.17);
      disc(g, cx - r * 0.2, cy + r * 0.5, r * 0.1);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath(); g.ellipse(cx - r * 0.35, cy - r * 0.2, r * 0.13, r * 0.28, 0.35, 0, TAU); g.fill();
      break;
    }
    case 'comet': {
      // queue orange longue (vers −x, la balle file vers +x) + noyau chaud
      const tail = g.createLinearGradient(cx, cy, cx - r * 2.7, cy);
      tail.addColorStop(0, color);
      tail.addColorStop(1, 'rgba(255,140,66,0)');
      g.fillStyle = tail;
      g.beginPath();
      g.moveTo(cx + r * 0.2, cy - r * 0.95);
      g.quadraticCurveTo(cx - r * 1.2, cy - r * 0.75, cx - r * 2.7, cy);
      g.quadraticCurveTo(cx - r * 1.2, cy + r * 0.75, cx + r * 0.2, cy + r * 0.95);
      g.closePath(); g.fill();
      const inner = g.createLinearGradient(cx, cy, cx - r * 1.9, cy);
      inner.addColorStop(0, '#fff3b0');
      inner.addColorStop(1, 'rgba(255,243,176,0)');
      g.fillStyle = inner;
      g.beginPath();
      g.moveTo(cx, cy - r * 0.45);
      g.quadraticCurveTo(cx - r * 0.9, cy - r * 0.3, cx - r * 1.9, cy);
      g.quadraticCurveTo(cx - r * 0.9, cy + r * 0.3, cx, cy + r * 0.45);
      g.closePath(); g.fill();
      g.fillStyle = color;
      disc(g, cx, cy, r * 0.92);
      g.shadowBlur = 0;
      g.fillStyle = '#fff3b0';
      disc(g, cx + r * 0.18, cy, r * 0.5);
      g.fillStyle = '#ffffff';
      disc(g, cx + r * 0.3, cy - r * 0.1, r * 0.18);
      break;
    }

    // ---------------- heavy ----------------
    case 'bomb': {
      // sphère sombre à mèche (capuchon en haut à droite, étincelle au bout)
      const ca = Math.cos(-Math.PI / 4), sa = Math.sin(-Math.PI / 4);
      g.fillStyle = '#3a3f4b';
      g.save(); g.translate(cx + ca * r * 0.9, cy + sa * r * 0.9); g.rotate(Math.PI / 4);
      g.fillRect(-r * 0.28, -r * 0.22, r * 0.56, r * 0.36);
      g.restore();
      g.strokeStyle = '#d9c9a3'; g.lineWidth = Math.max(1, r * 0.11); g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx + ca * r * 1.05, cy + sa * r * 1.05);
      g.quadraticCurveTo(cx + r * 1.15, cy - r * 1.35, cx + r * 1.3, cy - r * 1.05);
      g.stroke();
      g.fillStyle = PALETTE.accent;
      starPath(g, cx + r * 1.32, cy - r * 1.1, 4, r * 0.34, r * 0.11, 0); g.fill();
      g.fillStyle = color;
      disc(g, cx + r * 1.32, cy - r * 1.1, r * 0.12);
      g.fillStyle = shade(color, -0.78);
      disc(g, cx, cy, r);
      g.shadowBlur = 0;
      g.strokeStyle = color; g.lineWidth = Math.max(1, r * 0.1);
      ring(g, cx, cy, r * 0.95);
      g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = Math.max(1, r * 0.14);
      g.beginPath(); g.arc(cx, cy, r * 0.62, Math.PI * 1.05, Math.PI * 1.45); g.stroke();
      break;
    }
    case 'giant': {
      // grand disque strié (bandes de planète)
      g.fillStyle = color;
      disc(g, cx, cy, r);
      g.shadowBlur = 0;
      g.save();
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip();
      g.fillStyle = shade(color, -0.3);
      g.fillRect(cx - r, cy - r * 0.62, r * 2, r * 0.2);
      g.fillRect(cx - r, cy - r * 0.08, r * 2, r * 0.28);
      g.fillRect(cx - r, cy + r * 0.52, r * 2, r * 0.18);
      g.fillStyle = shade(color, 0.35);
      g.fillRect(cx - r, cy - r * 0.32, r * 2, r * 0.1);
      g.fillRect(cx - r, cy + r * 0.3, r * 2, r * 0.08);
      g.restore();
      g.strokeStyle = shade(color, -0.55); g.lineWidth = Math.max(1.5, r * 0.08);
      ring(g, cx, cy, r * 0.97);
      gloss(g, cx, cy, r, 0.55);
      break;
    }
    case 'shock': {
      // disque sombre cerclé de jaune + éclairs jaunes courts tout autour + onde intérieure
      g.strokeStyle = color; g.lineWidth = Math.max(1, r * 0.16); g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.PI / 6;
        zigzag(g, cx + Math.cos(a) * r * 1.0, cy + Math.sin(a) * r * 1.0, a, r * 0.72, r * 0.14);
      }
      g.stroke();
      g.fillStyle = shade(color, -0.68);
      disc(g, cx, cy, r);
      g.shadowBlur = 0;
      g.strokeStyle = color; g.lineWidth = Math.max(1.5, r * 0.17);
      ring(g, cx, cy, r * 0.9);
      g.lineWidth = Math.max(1, r * 0.09);
      ring(g, cx, cy, r * 0.45);
      g.fillStyle = color;
      disc(g, cx, cy, r * 0.16);
      break;
    }

    // ---------------- tricky ----------------
    case 'pierce': {
      // pointe de flèche blanche (vers +x), arête centrale
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(cx + r * 1.4, cy);
      g.lineTo(cx - r * 0.85, cy - r * 0.95);
      g.lineTo(cx - r * 0.35, cy);
      g.lineTo(cx - r * 0.85, cy + r * 0.95);
      g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(11,15,26,0.55)'; g.lineWidth = Math.max(1, r * 0.1); g.lineJoin = 'round';
      g.stroke();
      g.fillStyle = 'rgba(138,148,168,0.6)';
      g.beginPath(); g.moveTo(cx + r * 1.4, cy); g.lineTo(cx - r * 0.35, cy); g.lineTo(cx - r * 0.85, cy + r * 0.95); g.closePath(); g.fill();
      break;
    }
    case 'homing': {
      // œil rose : sclère claire cerclée de rose, iris et pupille tournés vers l'avant (+x)
      g.fillStyle = shade(color, 0.85);
      disc(g, cx, cy, r);
      g.shadowBlur = 0;
      g.strokeStyle = color; g.lineWidth = Math.max(1.5, r * 0.2);
      ring(g, cx, cy, r * 0.92);
      g.fillStyle = color;
      disc(g, cx + r * 0.3, cy, r * 0.52);
      g.fillStyle = PALETTE.bg0;
      disc(g, cx + r * 0.42, cy, r * 0.25);
      g.fillStyle = '#ffffff';
      disc(g, cx + r * 0.22, cy - r * 0.2, r * 0.12);
      break;
    }
    case 'echo': {
      // disque translucide en double contour (onde d'écho)
      g.fillStyle = color;
      g.globalAlpha = 0.35;
      disc(g, cx, cy, r);
      g.globalAlpha = 1;
      g.shadowBlur = 0;
      g.strokeStyle = color; g.lineWidth = Math.max(1.5, r * 0.18);
      ring(g, cx, cy, r * 0.9);
      g.globalAlpha = 0.5; g.lineWidth = Math.max(1, r * 0.12);
      ring(g, cx, cy, r * 1.32);
      g.globalAlpha = 1;
      g.fillStyle = light;
      disc(g, cx, cy, r * 0.32);
      break;
    }
    case 'boomerang': {
      // forme en V épaisse (pointe vers −x), tourne sur elle-même
      const w = r * 0.55;
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(cx + r * 0.62, cy - r * 0.92); g.lineTo(cx - r * 0.42, cy); g.lineTo(cx + r * 0.62, cy + r * 0.92);
      g.strokeStyle = shade(color, -0.55); g.lineWidth = w + Math.max(2, r * 0.16); g.stroke();
      g.shadowBlur = 0;
      g.strokeStyle = color; g.lineWidth = w; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(1, w * 0.22);
      g.beginPath(); g.moveTo(cx + r * 0.55, cy - r * 0.98); g.lineTo(cx - r * 0.5, cy - r * 0.08); g.stroke();
      break;
    }

    // ---------------- swarm ----------------
    case 'swarm': {
      // grappe de 3 points
      const d = r * 0.5, pr = r * 0.52;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + (i / 3) * TAU;
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
          if (pass === 0) { g.fillStyle = shade(color, -0.55); disc(g, x, y, pr + Math.max(1, r * 0.08)); }
          else { g.fillStyle = color; disc(g, x, y, pr); g.fillStyle = 'rgba(255,255,255,0.65)'; disc(g, x - pr * 0.3, y - pr * 0.3, pr * 0.3); }
        }
        g.shadowBlur = 0;
      }
      break;
    }
    case 'twin': {
      // deux demi-lunes dos à dos : deux disques décalés, remplissage pair-impair
      g.fillStyle = color;
      g.beginPath();
      g.arc(cx - r * 0.28, cy, r * 0.9, 0, TAU);
      g.moveTo(cx + r * 0.28 + r * 0.9, cy);
      g.arc(cx + r * 0.28, cy, r * 0.9, 0, TAU);
      g.fill('evenodd');
      g.shadowBlur = 0;
      g.strokeStyle = shade(color, -0.5); g.lineWidth = Math.max(1, r * 0.08);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      disc(g, cx - r * 0.85, cy - r * 0.25, r * 0.13);
      disc(g, cx + r * 0.85, cy - r * 0.25, r * 0.13);
      break;
    }

    // ---------------- greed ----------------
    case 'gold': {
      // pièce avec « $ » et tranche crantée
      g.fillStyle = shade(color, -0.4);
      disc(g, cx, cy, r);
      g.shadowBlur = 0;
      g.strokeStyle = shade(color, 0.3); g.lineWidth = Math.max(1, r * 0.1);
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        g.moveTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86);
        g.lineTo(cx + Math.cos(a) * r * 0.99, cy + Math.sin(a) * r * 0.99);
      }
      g.stroke();
      g.fillStyle = color;
      disc(g, cx, cy, r * 0.82);
      g.fillStyle = shade(color, -0.55);
      g.font = `900 ${Math.max(6, Math.round(r * 1.3))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('$', cx, cy + r * 0.06);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      disc(g, cx - r * 0.42, cy - r * 0.42, r * 0.14);
      break;
    }
    case 'lucky': {
      // trèfle à quatre feuilles (chaque feuille = deux lobes) + tige
      g.strokeStyle = shade(color, -0.4); g.lineWidth = Math.max(1, r * 0.2); g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + r * 0.2, cy + r * 0.9, cx + r * 0.75, cy + r * 1.15); g.stroke();
      for (let pass = 0; pass < 2; pass++) {
        g.fillStyle = pass === 0 ? shade(color, -0.55) : color;
        const grow = pass === 0 ? Math.max(1, r * 0.08) : 0;
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i / 4) * TAU;
          const ca = Math.cos(a), sa = Math.sin(a);
          const lx = cx + ca * r * 0.5, ly = cy + sa * r * 0.5;
          disc(g, lx - sa * r * 0.2, ly + ca * r * 0.2, r * 0.34 + grow);
          disc(g, lx + sa * r * 0.2, ly - ca * r * 0.2, r * 0.34 + grow);
        }
        g.shadowBlur = 0;
      }
      g.strokeStyle = shade(color, -0.35); g.lineWidth = Math.max(1, r * 0.07);
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i / 4) * TAU;
        g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
      }
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      disc(g, cx - r * 0.55, cy - r * 0.3, r * 0.1);
      break;
    }
    case 'magnet': {
      // fer à cheval rose, pointes argentées en bas
      const R0 = r * 0.62, w = r * 0.52, top = cy - r * 0.12, bot = cy + r * 0.82;
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(cx - R0, bot); g.lineTo(cx - R0, top); g.arc(cx, top, R0, Math.PI, 0); g.lineTo(cx + R0, bot);
      g.strokeStyle = shade(color, -0.55); g.lineWidth = w + Math.max(2, r * 0.16); g.stroke();
      g.shadowBlur = 0;
      g.strokeStyle = color; g.lineWidth = w; g.stroke();
      g.fillStyle = '#dfe5f0';
      g.fillRect(cx - R0 - w / 2, bot - r * 0.36, w, r * 0.36);
      g.fillRect(cx + R0 - w / 2, bot - r * 0.36, w, r * 0.36);
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = Math.max(1, w * 0.22);
      g.beginPath(); g.arc(cx, top, R0 + w * 0.2, Math.PI * 1.1, Math.PI * 1.5); g.stroke();
      break;
    }
    case 'vampire': {
      // disque rouge + bouche sombre et deux crocs blancs
      g.fillStyle = color;
      disc(g, cx, cy, r);
      g.shadowBlur = 0;
      g.strokeStyle = shade(color, 0.4); g.lineWidth = Math.max(1, r * 0.08);
      ring(g, cx, cy, r * 0.96);
      g.strokeStyle = shade(color, -0.65); g.lineWidth = Math.max(1, r * 0.14); g.lineCap = 'round';
      g.beginPath(); g.arc(cx, cy - r * 0.35, r * 0.6, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
      g.fillStyle = '#ffffff';
      for (let s = -1; s <= 1; s += 2) {
        const fx = cx + s * r * 0.27, fy = cy + r * 0.17;
        g.beginPath(); g.moveTo(fx - r * 0.14, fy); g.lineTo(fx + r * 0.14, fy); g.lineTo(fx + s * r * 0.02, fy + r * 0.5); g.closePath(); g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.5)';
      disc(g, cx - r * 0.38, cy - r * 0.42, r * 0.15);
      break;
    }

    // ---------------- arcane ----------------
    case 'prism': {
      // triangle irisé (dégradé arc-en-ciel pré-rendu) + facettes
      const p0x = cx, p0y = cy - r * 1.25;
      const p1x = cx + r * 1.1, p1y = cy + r * 0.65;
      const p2x = cx - r * 1.1, p2y = cy + r * 0.65;
      const iri = g.createLinearGradient(p2x, p2y, p1x, p0y);
      iri.addColorStop(0, PALETTE.heart);
      iri.addColorStop(0.35, color);
      iri.addColorStop(0.65, '#ffe95c');
      iri.addColorStop(1, '#5cff9d');
      g.fillStyle = iri;
      g.beginPath(); g.moveTo(p0x, p0y); g.lineTo(p1x, p1y); g.lineTo(p2x, p2y); g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, r * 0.1); g.lineJoin = 'round';
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(1, r * 0.06);
      g.beginPath();
      g.moveTo(cx, cy); g.lineTo(p0x, p0y); g.moveTo(cx, cy); g.lineTo(p1x, p1y); g.moveTo(cx, cy); g.lineTo(p2x, p2y);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath(); g.moveTo(p0x, p0y); g.lineTo(cx, cy); g.lineTo(p2x, p2y); g.closePath(); g.fill();
      break;
    }
    case 'void': {
      // disque violet à bord sombre et centre noir, liseré clair pour rester lisible sur le fond
      g.fillStyle = shade(color, 0.5);
      disc(g, cx, cy, r * 1.04);
      g.fillStyle = shade(color, -0.65);
      disc(g, cx, cy, r * 0.97);
      g.shadowBlur = 0;
      g.fillStyle = color;
      disc(g, cx, cy, r * 0.74);
      g.strokeStyle = shade(color, 0.35); g.lineWidth = Math.max(1, r * 0.08);
      g.beginPath(); g.arc(cx, cy, r * 0.58, Math.PI * 0.1, Math.PI * 0.9); g.stroke();
      g.beginPath(); g.arc(cx, cy, r * 0.58, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.fillStyle = '#000000';
      disc(g, cx, cy, r * 0.4);
      break;
    }
    case 'crystal': {
      // gemme hexagonale allongée, taille « brillant » : table centrale + facettes
      const ox = r * 0.82, oyT = r * 1.22, oyS = r * 0.5;
      const ix = r * 0.36, iyT = r * 0.55, iyS = r * 0.22;
      const OX = [cx, cx + ox, cx + ox, cx, cx - ox, cx - ox];
      const OY = [cy - oyT, cy - oyS, cy + oyS, cy + oyT, cy + oyS, cy - oyS];
      const IX = [cx, cx + ix, cx + ix, cx, cx - ix, cx - ix];
      const IY = [cy - iyT, cy - iyS, cy + iyS, cy + iyT, cy + iyS, cy - iyS];
      g.fillStyle = color;
      g.beginPath();
      for (let i = 0; i < 6; i++) { if (i === 0) g.moveTo(OX[i]!, OY[i]!); else g.lineTo(OX[i]!, OY[i]!); }
      g.closePath(); g.fill();
      g.shadowBlur = 0;
      // facettes sombres à droite
      g.fillStyle = 'rgba(80,140,190,0.45)';
      for (let i = 1; i <= 2; i++) {
        g.beginPath(); g.moveTo(OX[i]!, OY[i]!); g.lineTo(OX[i + 1]!, OY[i + 1]!); g.lineTo(IX[i + 1]!, IY[i + 1]!); g.lineTo(IX[i]!, IY[i]!); g.closePath(); g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      for (let i = 0; i < 6; i++) { if (i === 0) g.moveTo(IX[i]!, IY[i]!); else g.lineTo(IX[i]!, IY[i]!); }
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(70,120,170,0.8)'; g.lineWidth = Math.max(1, r * 0.06);
      g.beginPath();
      for (let i = 0; i < 6; i++) { g.moveTo(OX[i]!, OY[i]!); g.lineTo(IX[i]!, IY[i]!); }
      for (let i = 0; i <= 6; i++) { const j = i % 6; if (i === 0) g.moveTo(OX[j]!, OY[j]!); else g.lineTo(OX[j]!, OY[j]!); }
      g.stroke();
      g.fillStyle = '#ffffff';
      starPath(g, cx + r * 0.5, cy - r * 0.75, 4, r * 0.3, r * 0.07, 0); g.fill();
      break;
    }
    case 'rust': {
      // disque brun au bord rongé, écailles plus sombres et taches orangées
      let seed = 97;
      const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      g.fillStyle = color;
      g.beginPath();
      const n = 15;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const rr = r * (0.86 + rnd() * 0.16);
        if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = shade(color, -0.55); g.lineWidth = Math.max(1, r * 0.09);
      g.stroke();
      g.strokeStyle = shade(color, -0.45); g.lineWidth = Math.max(1, r * 0.08);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const sx = cx + (rnd() - 0.5) * r * 1.1, sy = cy + (rnd() - 0.5) * r * 1.1;
        g.moveTo(sx + r * 0.22, sy); g.arc(sx, sy, r * 0.22, 0, Math.PI);
      }
      g.stroke();
      g.fillStyle = shade(color, 0.4);
      for (let i = 0; i < 4; i++) disc(g, cx + (rnd() - 0.5) * r * 1.2, cy + (rnd() - 0.5) * r * 1.2, r * (0.07 + rnd() * 0.07));
      break;
    }
    case 'nova': {
      // étoile rose à 5 branches, cœur blanc
      g.fillStyle = color;
      starPath(g, cx, cy, 5, r * 1.32, r * 0.6, -Math.PI / 2); g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = shade(color, 0.5); g.lineWidth = Math.max(1, r * 0.08); g.lineJoin = 'round';
      g.stroke();
      g.fillStyle = shade(color, 0.6);
      disc(g, cx, cy, r * 0.42);
      g.fillStyle = '#ffffff';
      disc(g, cx, cy, r * 0.22);
      break;
    }
    default: {
      // pierre : disque + reflet décalé (−30 %, −30 %)
      g.fillStyle = color;
      disc(g, cx, cy, r);
      g.shadowBlur = 0;
      g.strokeStyle = shade(color, -0.45); g.lineWidth = lw;
      ring(g, cx, cy, r * 0.93);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      disc(g, cx - r * 0.3, cy - r * 0.3, r * 0.32);
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  if (tier >= 2) {
    g.strokeStyle = light; g.lineWidth = Math.max(1, r * 0.16);
    ring(g, cx, cy, r * 1.5);
  }
  if (tier >= 3) {
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, r * 0.12);
    ring(g, cx, cy, r * 1.85);
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

/** surcouche acide : voile vert + coulures et bulles (forme du bloc) */
function makeAcid(kind: number, width: number, cell: number, color: string): HTMLCanvasElement {
  const [c, g] = makeCanvas(width * cell, cell);
  g.save();
  blockShapePath(g, kind, width, cell);
  g.clip();
  g.globalAlpha = 0.32;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalAlpha = 0.9;
  // coulures depuis le haut (rideau irrégulier) et bulles
  let seed = 31 + kind * 7 + width;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const ins = BLOCK_INSET * cell;
  g.fillRect(0, 0, c.width, ins + cell * 0.07);
  const n = 3 + width * 2;
  for (let i = 0; i < n; i++) {
    const x = ins + ((i + 0.3 + rnd() * 0.4) / n) * (c.width - 2 * ins);
    const len = cell * (0.12 + rnd() * 0.22), w = cell * (0.04 + rnd() * 0.03);
    g.fillRect(x - w / 2, ins, w, len);
    g.beginPath(); g.arc(x, ins + len, w * 0.9, 0, TAU); g.fill();
  }
  g.globalAlpha = 0.55;
  g.fillStyle = shade(color, 0.5);
  for (let i = 0; i < 2 + width; i++) {
    g.beginPath(); g.arc(ins + rnd() * (c.width - 2 * ins), cell * (0.55 + rnd() * 0.3), cell * (0.025 + rnd() * 0.03), 0, TAU); g.fill();
  }
  g.restore();
  return c;
}

// espaces de clés du cache unique (Map<number>) : type × K_SPAN + sous-clé
const K_SPAN = 1e7;
const K_BLOCK = 0, K_WHITE = 1, K_FROZEN = 2, K_BALL = 3, K_GOLDEN = 4, K_PART = 5;
/** frames consécutives sans repli avant de libérer la génération précédente */
const PREV_RELEASE_FRAMES = 90;

/**
 * Sprites d'une résolution donnée. Tout est paresseux et mis en cache par clé numérique.
 * `prev` (génération précédente, résolution différente) sert de repli : quand le budget de la
 * frame est épuisé, un sprite manquant est remplacé par celui de `prev`, blitté à l'échelle
 * (`scale`). Sans `prev` (premier affichage), on construit toujours.
 */
export function buildSprites(l: Layout, colors: Colors, config: GameConfig, prev: Sprites | null = null, budget: SpriteBudget = { n: Infinity }): Sprites {
  const cell = l.cellPx;
  let fallback: Sprites | null = prev;
  const ratio = prev ? cell / prev.cell : 1;
  let fallbackUsed = false;
  let quiet = 0;
  const cache = new Map<number, HTMLCanvasElement>();
  const acidColor = colors.element[ELEMENT_INDEX.acid] ?? PALETTE.good;

  // largeurs nécessaires : 1 + largeurs des boss de la config
  let maxW = 2;
  for (const b of config.waves.bosses) if (b.width + 1 > maxW) maxW = b.width + 1;
  const keyKW = (k: number, w: number): number => k * maxW + w;

  /** repli : sprite de la génération précédente (sans construire), ou undefined */
  function fromPrev(key: number): HTMLCanvasElement | undefined {
    if (!fallback || budget.n > 0) return undefined;
    const f = fallback.peek(key);
    if (f) { api.scale = ratio; fallbackUsed = true; }
    return f;
  }
  function store(key: number, c: HTMLCanvasElement): HTMLCanvasElement {
    cache.set(key, c);
    budget.n--;
    api.scale = 1;
    return c;
  }
  /** pièces intermédiaires (base, masques) : pas comptées dans le budget, toujours reconstruites */
  function part(key: number, make: (k: number, w: number) => HTMLCanvasElement, k: number, w: number): HTMLCanvasElement {
    const full = K_PART * K_SPAN + key;
    let c = cache.get(full);
    if (!c) { c = make(k, w); cache.set(full, c); }
    return c;
  }
  const mkBase = (k: number, w: number): HTMLCanvasElement => makeBlock(k, w, cell, colors);
  const mkDark = (k: number, w: number): HTMLCanvasElement => makeMask(k, w, cell, '#000000');
  const mkCracks = (k: number, w: number): HTMLCanvasElement => makeCracks(k, w, cell);
  const mkAcid = (k: number, w: number): HTMLCanvasElement => makeAcid(k, w, cell, acidColor);

  function blockAt(kind: number, width: number, lv: number, acid: number): HTMLCanvasElement | undefined {
    if (width >= maxW || width < 1) return undefined;
    if (kind === KIND_INDEX.peg) lv = 0;
    const kw = keyKW(kind, width);
    const key = K_BLOCK * K_SPAN + (kw * DMG_LEVELS + lv) * 2 + (acid ? 1 : 0);
    const hit = cache.get(key);
    if (hit) { api.scale = 1; return hit; }
    const f = fromPrev(key);
    if (f) return f;
    const base = part(kw * 4, mkBase, kind, width);
    if (lv === 0 && !acid) return store(key, base);
    const [c, g] = makeCanvas(base.width, base.height);
    g.drawImage(base, 0, 0);
    if (lv > 0) {
      g.globalAlpha = DMG_DARK[lv] ?? 0;
      g.drawImage(part(kw * 4 + 1, mkDark, kind, width), 0, 0);
      g.globalAlpha = 1;
      if (lv === DMG_LEVELS - 1) g.drawImage(part(kw * 4 + 2, mkCracks, kind, width), 0, 0);
    }
    if (acid) g.drawImage(part(kw * 4 + 3, mkAcid, kind, width), 0, 0);
    return store(key, c);
  }
  function whiteAt(kind: number, width: number): HTMLCanvasElement | undefined {
    if (width >= maxW || width < 1) return undefined;
    const key = K_WHITE * K_SPAN + keyKW(kind, width);
    const hit = cache.get(key);
    if (hit) { api.scale = 1; return hit; }
    return fromPrev(key) ?? store(key, makeMask(kind, width, cell, '#ffffff'));
  }
  function frozenAt(width: number): HTMLCanvasElement | undefined {
    if (width >= maxW || width < 1) return undefined;
    const key = K_FROZEN * K_SPAN + width;
    const hit = cache.get(key);
    if (hit) { api.scale = 1; return hit; }
    return fromPrev(key) ?? store(key, makeFrozen(width, cell));
  }

  const radius = config.blocks.board.ballRadius;
  const nIdx = ELEMENTS.length * 3;
  // Divine : rayon visuel minimal = rayon de config × radiusMult (la sim peut déjà l'appliquer)
  const divMult = config.balls.defs.find((d) => d.id === 'divine')?.params?.radiusMult?.[0] ?? 1.3;
  const divineRq = quantizeRadius(radius * divMult, radius);
  const ballExt: number[] = [];
  for (let e = 0; e < ELEMENTS.length; e++) {
    const rBase = e === EL_DIVINE ? (radius * divineRq) / RQ_ONE : radius;
    for (let t = 1; t <= 3; t++) ballExt.push(ballVisualRadius(rBase, e, t) * ballExtent(e, t));
  }
  const ballKey = (i: number, rq: number, rr: number): number => K_BALL * K_SPAN + (i * (RQ_MAX + 1) + rq) * ROT_STEPS + rr;
  function buildBall(i: number, rq: number, rr: number, key: number): HTMLCanvasElement {
    const e = (i / 3) | 0, t = (i % 3) + 1;
    const ia = colors.recipeA[e] ?? -1, ib = colors.recipeB[e] ?? -1;
    const pa = ia >= 0 ? colors.element[ia] ?? null : null, pb = ib >= 0 ? colors.element[ib] ?? null : null;
    return store(key, makeBall(e, colors.element[e] ?? PALETTE.stone, t, (radius * rq) / RQ_ONE, cell, (rr / ROT_STEPS) * TAU, pa, pb));
  }
  function ball(i: number, rq: number, rot: number): HTMLCanvasElement | undefined {
    if (i < 0 || i >= nIdx) return undefined;
    const e = (i / 3) | 0;
    if (e === EL_DIVINE && rq < divineRq) rq = divineRq;
    const oriented = (ELEMENT_ORIENT[e] ?? 0) !== ORIENT_NONE;
    const rr = oriented ? ((rot % ROT_STEPS) + ROT_STEPS) % ROT_STEPS : 0;
    const key = ballKey(i, rq, rr);
    const hit = cache.get(key);
    if (hit) { api.scale = 1; return hit; }
    if (budget.n <= 0) {
      const f = fromPrev(key);
      if (f) return f;
      if (oriented) {
        // cran voisin déjà en cache (ici, puis dans la génération précédente)
        const base = key - rr;
        for (let d = 1; d <= ROT_STEPS / 2; d++) {
          const a = cache.get(base + ((rr + d) % ROT_STEPS)) ?? cache.get(base + ((rr - d + ROT_STEPS) % ROT_STEPS));
          if (a) { api.scale = 1; return a; }
        }
      }
    }
    return buildBall(i, rq, rr, key);
  }
  function warm(i: number, rq: number): boolean {
    if (i < 0 || i >= nIdx || budget.n <= 0) return false;
    const e = (i / 3) | 0;
    if (e === EL_DIVINE && rq < divineRq) rq = divineRq;
    const steps = (ELEMENT_ORIENT[e] ?? 0) === ORIENT_NONE ? 1 : ROT_STEPS;
    for (let r = 0; r < steps; r++) {
      const key = ballKey(i, rq, r);
      if (cache.has(key)) continue;
      buildBall(i, rq, r, key);
      if (budget.n <= 0) return false;
    }
    return true;
  }
  function ballAt(i: number): HTMLCanvasElement | undefined {
    return ball(i, RQ_ONE, ROT_UP);
  }
  const goldenExt: number[] = [];
  for (let e = 0; e < ELEMENTS.length; e++) {
    for (let t = 1; t <= 3; t++) goldenExt.push(ballVisualRadius(radius, e, t) * GOLDEN_EXTENT);
  }
  function goldenAt(i: number): HTMLCanvasElement | undefined {
    if (i < 0 || i >= nIdx) return undefined;
    const key = K_GOLDEN * K_SPAN + i;
    const hit = cache.get(key);
    if (hit) { api.scale = 1; return hit; }
    const e = (i / 3) | 0, t = (i % 3) + 1;
    return fromPrev(key) ?? store(key, makeGoldenBall(e, colors.element[e] ?? PALETTE.stone, t, radius, cell));
  }

  const api: Sprites = {
    cell, scale: 1, divineRq,
    blockAt, whiteAt, frozenAt, ball, ballAt, ballExt, warm, goldenAt, goldenExt,
    peek(key) { return cache.get(key); },
    endFrame() {
      if (!fallback) return;
      if (fallbackUsed) { quiet = 0; fallbackUsed = false; return; }
      if (++quiet > PREV_RELEASE_FRAMES) fallback = null; // la génération précédente peut être collectée
    },
    coin: makeDrop('coin', cell), fragment: makeDrop('fragment', cell), heart: makeDrop('heart', cell),
    halo: makeHalo(cell),
  };
  return api;
}
