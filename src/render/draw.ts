// render/draw.ts — dessin d'une frame. AUCUNE allocation ici : pas de new / {} / [] / closures /
// map / filter / template strings. Tout l'état mutable est pré-alloué dans createFrameDrawer.
// Le fond (dégradé, panneau du plateau, lumière de puissance) est en CSS : voir backdrop.ts.
import type { Ball, Block, RunState } from '../core/types';
import { easeOutBack, easeOutCubic } from '../core/math';
import type { Layout } from './layout';
import type { Sprites } from './sprites';
import { BALL_EXTENT, ballVisualRadius, damageLevel, DMG_LEVELS, DROP_EXTENT, GOLDEN_EXTENT, HALO_EXTENT, PEG_RADIUS } from './sprites';
import type { Particles } from './particles';
import { P_CRYSTAL, P_SHARD, P_SPARK, PRIO_LOW, PRIO_NORMAL } from './particles';
import type { DamageNumbers } from './damageNumbers';
import { formatNumber } from './damageNumbers';
import type { BlockFx, Vfx } from './vfx';
import type { Fusions } from './fusion';
import { POWER_LEVELS, powerTarget } from './backdrop';
import { ELEMENT_INDEX, KIND_INDEX, PALETTE, type Colors } from './palette';

const TRAIL_CAP = 14;
const MAX_TRAILS = 96;
const DUST = 24;
const AIM_REFLECT_LEN = 1.5;
const DASH: number[] = [0.14, 0.11];
const DASH_FINE: number[] = [0.07, 0.09];
const NO_DASH: number[] = [];
/** durée du « pop » d'apparition d'un bloc (s) */
const SPAWN_DUR = 0.15;
/** au-delà, les traînées sont raccourcies (budget perf) */
const MANY_BALLS = 20;
/** longueur de traînée de base par élément (stone, fire, lightning, ice, ghost, lead, split) */
const TRAIL_BASE: readonly number[] = [6, 7, 6, 6, 12, 3, 6];
const EL_FIRE = ELEMENT_INDEX.fire, EL_LIGHTNING = ELEMENT_INDEX.lightning, EL_ICE = ELEMENT_INDEX.ice;
const EL_GHOST = ELEMENT_INDEX.ghost, EL_LEAD = ELEMENT_INDEX.lead;
/** traînée de la balle dorée (plus longue que toutes les autres) */
const GOLD_TRAIL = 12;
const GOLD_TRAIL_MANY = 9;
/** combo affiché sur la balle à partir de ce seuil ; paliers de taille */
const COMBO_SHOW = 8;
const COMBO_TIER_1 = 16;
const COMBO_TIER_2 = 32;
/** au-delà de MANY_BALLS balles vivantes, combo affiché seulement sur les COMBO_TOP meilleures */
const COMBO_TOP = 3;
/** bitmaps de combo mis en cache jusqu'à cette valeur (au-delà : texte direct, rarissime) */
const COMBO_CACHE_MAX = 512;
const COMBO_POP = 0.16;
/** éventail de visée : rayon de l'arc près du point de lancement (unités plateau) */
const FAN_ARC_R = 1.05;
/** demi-angle minimal (rad) pour dessiner l'éventail (à 0, les lignes extrêmes = la centrale) */
const FAN_MIN_RAD = 0.004;
/** voile de défaite : opacité, montée et levée (s) */
const VEIL_ALPHA = 0.5;
const VEIL_IN = 0.4;
const VEIL_OUT = 0.35;
/** onde de la seconde chance (s) */
const REVIVE_WAVE = 0.6;
const GOLD_RING = 16;
const BREACH_RING = 32;

interface Trail {
  active: boolean;
  id: number;
  seen: number;
  xs: Float32Array;
  ys: Float32Array;
  head: number;
  count: number;
  /** minuterie d'émission de particules d'ambiance (braises, étincelles, cristaux) */
  emitT: number;
  /** mode « beaucoup de balles » : élément et nombre de points à tracer cette frame (−1 = dorée) */
  el: number;
  n: number;
  /** palier de taille du combo affiché (−1 = rien) et minuterie de « pop » au changement */
  comboTier: number;
  comboPop: number;
}

/** Résultat d'un raycast (objet unique réutilisé). */
interface RayHit { t: number; nx: number; ny: number; }

export interface FrameDrawer {
  draw(state: Readonly<RunState>, dt: number, frame: number): void;
  /** à appeler après resize (fonts recalculées) */
  rebuildFonts(): void;
  clearTrails(): void;
  /** pas de « pop » d'apparition à la prochaine frame (début de run, reprise) */
  suppressSpawnPop(): void;
  /** balle dorée (ball:launched.golden) : mémorisée par id */
  markGolden(ballId: number): void;
  isGolden(b: Readonly<Ball>): boolean;
  isGoldenId(ballId: number): boolean;
  /** bloc franchi (block:breached) : sa disparition ne produit pas d'éclats */
  noteBreached(blockId: number): void;
  /** run:lost → voile progressif ; run:revived → levée + onde depuis la ligne du joueur */
  setLost(): void;
  revive(): void;
  clearOverlays(): void;
}

export interface DrawDeps {
  ctx: CanvasRenderingContext2D;
  layout: Layout;
  getSprites(): Sprites;
  particles: Particles;
  numbers: DamageNumbers;
  vfx: Vfx;
  fusions: Fusions;
  colors: Colors;
  ballRadius: number;
  /** demi-angle max de l'éventail (degrés) quand aimSpread = 1 */
  maxSpreadDeg: number;
  /** appelé quand le niveau de « lumière » (0..POWER_LEVELS-1) change */
  onPowerLevel(level: number): void;
}

export function createFrameDrawer(d: DrawDeps): FrameDrawer {
  const { ctx, layout: l, particles, numbers, vfx } = d;
  const R = d.ballRadius;
  const elColors = d.colors.element;

  const trails: Trail[] = [];
  for (let i = 0; i < MAX_TRAILS; i++) {
    trails.push({ active: false, id: -1, seen: 0, xs: new Float32Array(TRAIL_CAP), ys: new Float32Array(TRAIL_CAP), head: 0, count: 0, emitT: 0, el: 0, n: 0, comboTier: -1, comboPop: 1 });
  }
  const dust = new Float32Array(DUST * 3); // x, y, vitesse
  for (let i = 0; i < DUST; i++) {
    dust[i * 3] = Math.random() * l.cols;
    dust[i * 3 + 1] = Math.random() * l.rows;
    dust[i * 3 + 2] = 0.05 + Math.random() * 0.12;
  }

  const hit: RayHit = { t: 0, nx: 0, ny: 0 };
  const maxSpreadRad = Number.isFinite(d.maxSpreadDeg) ? (d.maxSpreadDeg * Math.PI) / 180 : 0;
  /** ids des balles dorées récentes (anneau) */
  const goldIds = new Int32Array(GOLD_RING).fill(-1);
  let goldIdx = 0;
  /** blocs franchis récemment (pas d'éclats de disparition) */
  const breachIds = new Int32Array(BREACH_RING).fill(-1);
  let breachIdx = 0;
  /** bitmaps « ×N » du combo sur balle, par valeur (créés à la 1re apparition, vidés au resize) */
  const comboImgs: (HTMLCanvasElement | undefined)[] = [];
  const comboFonts: string[] = ['', '', ''];
  /** voile de défaite : t depuis run:lost (−1 = aucun) ; levée après revive */
  let lostT = -1;
  let liftT = -1;
  let liftFrom = 0;
  let reviveT = -1;
  let suppressVanish = true;
  let curPhase = '';
  let prevPhase = '';
  /** chaînes « ×N » mises en cache (allocation uniquement à la 1re apparition de N) */
  const countLabels: string[] = [];
  let hpFont = '';
  let hpFontSmall = '';
  let bossFont = '';
  let smallFont = '';
  let time = 0;
  let power = 0;
  let powerLevel = -1;
  /** vrai jusqu'à la fin de la première frame de run : les blocs initiaux n'ont pas de « pop » */
  let suppressPop = true;
  /** transform plateau → pixels physiques de la frame courante */
  let K = 1, OX = 0, OY = 0;

  /**
   * Blit d'un sprite en pixels physiques ENTIERS, sans mise à l'échelle quand s = 1.
   * Mesuré à CPU 4× (raster logiciel) : 75 blits fractionnaires mis à l'échelle = 25,6 ms,
   * 75 blits entiers = 5,8 ms. Le contexte doit être en transform identité.
   */
  function blit(img: CanvasImageSource & { width: number; height: number }, bx: number, by: number, s: number): void {
    const px = Math.round(OX + bx * K), py = Math.round(OY + by * K);
    if (s === 1) ctx.drawImage(img, px, py);
    else ctx.drawImage(img, px, py, Math.round(img.width * s), Math.round(img.height * s));
  }
  function boardTransform(): void { ctx.setTransform(K, 0, 0, K, OX, OY); }
  function pixelTransform(): void { ctx.setTransform(1, 0, 0, 1, 0, 0); }

  function rebuildFonts(): void {
    const px = l.scale * l.dpr;
    const fam = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    hpFont = `800 ${Math.max(8, Math.round(px * 0.42))}px ${fam}`;
    hpFontSmall = `800 ${Math.max(7, Math.round(px * 0.3))}px ${fam}`;
    bossFont = `800 ${Math.max(10, Math.round(px * 0.5))}px ${fam}`;
    smallFont = `700 ${Math.max(8, Math.round(px * 0.28))}px ${fam}`;
    comboFonts[0] = `800 ${Math.max(8, Math.round(px * 0.2))}px ${fam}`;
    comboFonts[1] = `800 ${Math.max(9, Math.round(px * 0.245))}px ${fam}`;
    comboFonts[2] = `900 ${Math.max(10, Math.round(px * 0.3))}px ${fam}`;
    comboImgs.length = 0;
    powerLevel = -1; // ré-applique le fond CSS
    vfx.invalidateLabels();
  }

  function countLabel(n: number): string {
    let s = countLabels[n];
    if (s === undefined) { s = `×${n}`; countLabels[n] = s; }
    return s;
  }

  // ------------------------------------------------------------------
  // Raycast local (ligne de visée) : murs + AABB des blocs (Minkowski par R) + cercles des pegs.
  // ------------------------------------------------------------------
  function raycast(blocks: readonly Block[], ox: number, oy: number, dx: number, dy: number, maxT: number): void {
    hit.t = maxT; hit.nx = 0; hit.ny = 0;
    const cols = l.cols;
    if (dx < -1e-9) { const t = (R - ox) / dx; if (t >= 0 && t < hit.t) { hit.t = t; hit.nx = 1; hit.ny = 0; } }
    if (dx > 1e-9) { const t = (cols - R - ox) / dx; if (t >= 0 && t < hit.t) { hit.t = t; hit.nx = -1; hit.ny = 0; } }
    if (dy < -1e-9) { const t = (R - oy) / dy; if (t >= 0 && t < hit.t) { hit.t = t; hit.nx = 0; hit.ny = 1; } }
    if (dy > 1e-9) { const t = (l.rows - R - oy) / dy; if (t >= 0 && t < hit.t) { hit.t = t; hit.nx = 0; hit.ny = -1; } }
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (b.kind === 'peg') {
        const cx = b.col + 0.5, cy = b.row + 0.5, rr = PEG_RADIUS + R;
        const fx = ox - cx, fy = oy - cy;
        const bq = fx * dx + fy * dy;
        const c = fx * fx + fy * fy - rr * rr;
        const disc = bq * bq - c;
        if (disc < 0) continue;
        const t = -bq - Math.sqrt(disc);
        if (t > 1e-6 && t < hit.t) {
          hit.t = t;
          hit.nx = (ox + dx * t - cx) / rr;
          hit.ny = (oy + dy * t - cy) / rr;
        }
        continue;
      }
      const x0 = b.col - R, x1 = b.col + b.width + R, y0 = b.row - R, y1 = b.row + 1 + R;
      let tmin = -Infinity, tmax = Infinity, nx = 0, ny = 0;
      if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) continue; }
      else {
        const inv = 1 / dx;
        let ta = (x0 - ox) * inv, tb = (x1 - ox) * inv;
        let n = -1;
        if (ta > tb) { const s = ta; ta = tb; tb = s; n = 1; }
        if (ta > tmin) { tmin = ta; nx = n; ny = 0; }
        if (tb < tmax) tmax = tb;
      }
      if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) continue; }
      else {
        const inv = 1 / dy;
        let ta = (y0 - oy) * inv, tb = (y1 - oy) * inv;
        let n = -1;
        if (ta > tb) { const s = ta; ta = tb; tb = s; n = 1; }
        if (ta > tmin) { tmin = ta; nx = 0; ny = n; }
        if (tb < tmax) tmax = tb;
      }
      if (tmax < tmin || tmax < 0) continue;
      if (tmin > 1e-6 && tmin < hit.t) { hit.t = tmin; hit.nx = nx; hit.ny = ny; }
    }
  }

  function drawAim(state: Readonly<RunState>): void {
    const aim = state.aimDir;
    if (!aim) return;
    let dx = aim.x, dy = aim.y;
    const ln = Math.hypot(dx, dy);
    if (ln < 1e-9) return;
    dx /= ln; dy /= ln;
    const ox = state.launchPos.x, oy = state.launchPos.y;
    ctx.lineCap = 'round';
    drawFan(state, ox, oy, dx, dy);
    raycast(state.blocks, ox, oy, dx, dy, 30);
    const hx = ox + dx * hit.t, hy = oy + dy * hit.t;
    const nx = hit.nx, ny = hit.ny;

    ctx.setLineDash(DASH);
    ctx.lineDashOffset = -time * 0.9;
    ctx.strokeStyle = PALETTE.text;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(hx, hy); ctx.stroke();

    // fantôme de balle au premier impact
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.arc(hx, hy, R, 0, Math.PI * 2); ctx.stroke();

    // segment réfléchi, plus clair
    if (nx !== 0 || ny !== 0) {
      const dd = 2 * (dx * nx + dy * ny);
      const rx = dx - dd * nx, ry = dy - dd * ny;
      const sx = hx + nx * 1e-3, sy = hy + ny * 1e-3;
      raycast(state.blocks, sx, sy, rx, ry, AIM_REFLECT_LEN);
      ctx.setLineDash(DASH_FINE);
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 0.035;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(sx + rx * hit.t, sy + ry * hit.t); ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * F1 — éventail de visée : les deux trajectoires extrêmes (±maxSpreadDeg × aimSpread) en
   * pointillé fin jusqu'au premier mur/bloc, et un arc discret près du point de lancement.
   * À spread ≈ 0, rien (les extrêmes se confondent avec la ligne centrale).
   */
  function drawFan(state: Readonly<RunState>, ox: number, oy: number, dx: number, dy: number): void {
    const sp = state.aimSpread;
    if (!(sp > 0)) return; // undefined / NaN / 0
    const half = (sp > 1 ? 1 : sp) * maxSpreadRad;
    if (half < FAN_MIN_RAD) return;
    const base = Math.atan2(dy, dx);
    // coin très léger entre les extrêmes, près du lancement
    ctx.fillStyle = PALETTE.text;
    ctx.globalAlpha = 0.06;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, FAN_ARC_R, base - half, base + half); ctx.closePath(); ctx.fill();
    // lignes extrêmes
    ctx.setLineDash(DASH_FINE);
    ctx.lineDashOffset = -time * 0.9;
    ctx.strokeStyle = PALETTE.text;
    ctx.lineWidth = 0.028;
    ctx.globalAlpha = 0.32;
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const a = base + side * half;
      const ex = Math.cos(a), ey = Math.sin(a);
      raycast(state.blocks, ox, oy, ex, ey, 30);
      ctx.moveTo(ox + ex * R * 2, oy + ey * R * 2);
      ctx.lineTo(ox + ex * hit.t, oy + ey * hit.t);
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    // arc plein + petites butées aux extrémités
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.032;
    ctx.beginPath();
    ctx.arc(ox, oy, FAN_ARC_R, base - half, base + half);
    for (let side = -1; side <= 1; side += 2) {
      const a = base + side * half;
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.moveTo(ox + ca * (FAN_ARC_R - 0.08), oy + sa * (FAN_ARC_R - 0.08));
      ctx.lineTo(ox + ca * (FAN_ARC_R + 0.08), oy + sa * (FAN_ARC_R + 0.08));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------
  // Blocs : squash, respiration à PV bas, fissures, assombrissement, flash, PV qui « pop »
  // ------------------------------------------------------------------
  function drawBlocks(state: Readonly<RunState>, frame: number): void {
    const sp = d.getSprites();
    const blocks = state.blocks;
    const advancing = state.phase === 'advancing';
    // la sim incrémente row à la FIN de 'advancing' : on interpole row → row + 1
    const shift = advancing ? easeOutBack(state.advanceProgress < 0 ? 0 : state.advanceProgress > 1 ? 1 : state.advanceProgress) : 0;
    pixelTransform();

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      // bloc jamais vu (ex. engendré par le boss « Ruche », sans événement) : « pop » d'apparition
      const known = vfx.peekBlockFx(b.id);
      const fx = known ?? vfx.blockFx(b.id);
      if (!known && !suppressPop && !advancing) fx.spawnT = 0;
      fx.seenFrame = frame;
      if (fx.hp !== b.hp) {
        if (!Number.isNaN(fx.hp)) fx.popT = 0;
        fx.hp = b.hp;
        fx.label = formatNumber(b.hp);
        fx.labelDirty = true;
      }
      const lowNow = b.maxHp > 0 && b.hp < b.maxHp * 0.3;
      if (lowNow !== fx.labelLow) { fx.labelLow = lowNow; fx.labelDirty = true; }
      if (fx.labelDirty && b.kind !== 'peg') renderLabel(fx, b.kind === 'boss', b.width);
      const kind = KIND_INDEX[b.kind];
      // un bloc gelé ne descend pas : pas d'interpolation
      const y = b.row + (b.frozen ? 0 : shift);
      fx.x = b.col; fx.y = y; fx.w = b.width; fx.kind = kind;

      const row = sp.block[kind];
      const img = row ? (row[b.width] ?? row[1]) : undefined;
      if (!img) continue;
      const isPeg = b.kind === 'peg';
      const ratio = !isPeg && b.maxHp > 0 ? (b.hp > b.maxHp ? 1 : b.hp / b.maxHp) : 1;
      const lv = isPeg ? 0 : damageLevel(ratio);
      const sp0 = fx.spawnT < SPAWN_DUR ? easeOutBack(fx.spawnT / SPAWN_DUR) : 1;
      const s = vfx.squashScale(fx) * (sp0 < 0.05 ? 0.05 : sp0);
      const x0 = b.col + b.width * (1 - s) * 0.5, y0 = y + (1 - s) * 0.5;
      // sprite pré-composé (assombri / fissuré) : un seul blit
      blit((lv > 0 ? sp.damagedAt(kind, b.width, lv) : undefined) ?? img, x0, y0, s);
      const flash = fx.squashT < 0.08 ? 0.7 * (1 - fx.squashT / 0.08) : 0;
      if (flash > 0) {
        const wimg = sp.whiteAt(kind, b.width);
        if (wimg) {
          ctx.globalAlpha = flash;
          blit(wimg, x0, y0, s);
          ctx.globalAlpha = 1;
        }
      }
      if (b.frozen) {
        const fz = sp.frozenAt(b.width);
        if (fz) {
          ctx.globalAlpha = 0.9;
          blit(fz, x0, y0, s);
          ctx.globalAlpha = 1;
        }
      }
      if (b.kind === 'boss') { boardTransform(); drawBossEyes(state, b.col + b.width * 0.5, y + 0.3, b.width); pixelTransform(); }
    }
    boardTransform();
  }

  function drawBossEyes(state: Readonly<RunState>, cx: number, cy: number, width: number): void {
    // balle la plus proche
    let tx = cx, ty = cy + 3, best = Infinity;
    const balls = state.balls;
    for (let i = 0; i < balls.length; i++) {
      const bl = balls[i]!;
      if (!bl.alive) continue;
      const ddx = bl.pos.x - cx, ddy = bl.pos.y - cy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < best) { best = d2; tx = bl.pos.x; ty = bl.pos.y; }
    }
    if (best === Infinity && state.aimDir) { tx = state.launchPos.x; ty = state.launchPos.y; }
    const spread = Math.min(0.55, width * 0.18);
    const er = 0.13, pr = 0.065;
    for (let e = -1; e <= 1; e += 2) {
      const ex = cx + e * spread;
      let vx = tx - ex, vy = ty - cy;
      const vl = Math.hypot(vx, vy) || 1;
      vx = (vx / vl) * (er - pr) * 0.9; vy = (vy / vl) * (er - pr) * 0.9;
      ctx.fillStyle = PALETTE.text;
      ctx.beginPath(); ctx.arc(ex, cy, er, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PALETTE.bg0;
      ctx.beginPath(); ctx.arc(ex + vx, cy + vy, pr, 0, Math.PI * 2); ctx.fill();
    }
  }

  /**
   * Pré-rend le libellé de PV d'un bloc dans un petit canvas propre au BlockFx (créé une fois par
   * objet du pool, puis réutilisé). Appelé seulement quand hp change (ou au resize) : strokeText
   * à 60 px coûtait ~1 ms par bloc et par frame en raster logiciel.
   */
  function renderLabel(fx: BlockFx, boss: boolean, width: number): void {
    fx.labelDirty = false;
    const k = l.scale * l.dpr;
    const w = Math.ceil(width * k + 8 * l.dpr), h = Math.ceil(k * 0.8);
    let c = fx.labelCanvas;
    if (!c) { c = document.createElement('canvas'); fx.labelCanvas = c; }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    g.font = boss ? bossFont : fx.label.length >= 4 ? hpFontSmall : hpFont;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = PALETTE.outline;
    g.lineWidth = 3 * l.dpr;
    g.fillStyle = fx.labelLow ? '#ffd6d6' : '#ffffff';
    g.strokeText(fx.label, w / 2, h / 2);
    g.fillText(fx.label, w / 2, h / 2);
  }

  function drawHpLabels(state: Readonly<RunState>): void {
    const blocks = state.blocks;
    const k = l.scale * l.dpr;
    const ox = l.offX * l.dpr, oy = l.offY * l.dpr;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (b.kind === 'peg') continue;
      const fx = vfx.peekBlockFx(b.id);
      const c = fx ? fx.labelCanvas : null;
      if (!fx || !c) continue;
      const boss = b.kind === 'boss';
      let pop = fx.popT < 0.16 ? 1 + 0.38 * (1 - fx.popT / 0.16) : 1;
      if (fx.spawnT < SPAWN_DUR) { const g = easeOutBack(fx.spawnT / SPAWN_DUR); pop *= g < 0.05 ? 0.05 : g; }
      const w = c.width * pop, h = c.height * pop;
      const cx = ox + (fx.x + fx.w * 0.5) * k, cy = oy + (fx.y + (boss ? 0.66 : 0.53)) * k;
      if (pop === 1) ctx.drawImage(c, Math.round(cx - w * 0.5), Math.round(cy - h * 0.5));
      else ctx.drawImage(c, cx - w * 0.5, cy - h * 0.5, w, h);
    }
  }

  function drawDrops(state: Readonly<RunState>): void {
    const sp = d.getSprites();
    const drops = state.drops;
    for (let i = 0; i < drops.length; i++) {
      const dr = drops[i]!;
      const bob = Math.sin(time * 4 + dr.id * 1.7) * 0.045;
      const x = dr.pos.x, y = dr.pos.y + bob;
      ctx.globalAlpha = 0.45 + 0.15 * Math.sin(time * 6 + dr.id);
      ctx.drawImage(sp.halo, x - HALO_EXTENT * 0.7, y - HALO_EXTENT * 0.7, HALO_EXTENT * 1.4, HALO_EXTENT * 1.4);
      ctx.globalAlpha = 1;
      if (dr.kind === 'ball') {
        const img = sp.ballAt(ELEMENT_INDEX[dr.element ?? 'stone'] * 3);
        if (img) {
          const e = (sp.ballExt[ELEMENT_INDEX[dr.element ?? 'stone'] * 3] ?? R) * 1.35;
          ctx.drawImage(img, x - e, y - e, e * 2, e * 2);
        }
        ctx.strokeStyle = PALETTE.text;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 0.025;
        ctx.beginPath(); ctx.arc(x, y, R * 1.35 * 1.7, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        const img = dr.kind === 'coin' ? sp.coin : dr.kind === 'fragment' ? sp.fragment : sp.heart;
        ctx.drawImage(img, x - DROP_EXTENT, y - DROP_EXTENT, DROP_EXTENT * 2, DROP_EXTENT * 2);
      }
    }
  }

  function trailFor(id: number, frame: number, x: number, y: number): Trail {
    let free: Trail | undefined;
    for (let i = 0; i < MAX_TRAILS; i++) {
      const t = trails[i]!;
      if (t.active && t.id === id) return t;
      if (!t.active && !free) free = t;
    }
    const t = free ?? trails[0]!;
    t.active = true; t.id = id; t.head = 0; t.count = 1; t.seen = frame; t.emitT = Math.random() * 0.05;
    t.comboTier = -1; t.comboPop = 1;
    t.xs[0] = x; t.ys[0] = y;
    return t;
  }

  /** Traînée effilée : une passe large et pâle, une passe cœur plus vive (2 strokes par balle). */
  function strokeTrail(tr: Trail, n: number, width: number, alpha: number): void {
    if (n < 2) return;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(tr.xs[tr.head]!, tr.ys[tr.head]!);
    for (let k = 1; k < n; k++) {
      const idx = (tr.head - k + TRAIL_CAP) % TRAIL_CAP;
      ctx.lineTo(tr.xs[idx]!, tr.ys[idx]!);
    }
    ctx.stroke();
  }

  function drawBalls(state: Readonly<RunState>, frame: number, dt: number): void {
    const sp = d.getSprites();
    const balls = state.balls;
    let alive = 0;
    for (let i = 0; i < balls.length; i++) if (balls[i]!.alive) alive++;
    const many = alive > MANY_BALLS;
    const rs = state.recallSpeed > 1 ? state.recallSpeed : 1;
    const boost = rs > 1 ? Math.round((rs - 1) * 2.5) : 0;
    const ambient = particles.count < 600;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 1) échantillonne + traînées (+ particules d'ambiance par élément)
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!;
      if (!b.alive) continue;
      const tr = trailFor(b.id, frame, b.pos.x, b.pos.y);
      if (tr.seen !== frame) {
        tr.head = (tr.head + 1) % TRAIL_CAP;
        tr.xs[tr.head] = b.pos.x; tr.ys[tr.head] = b.pos.y;
        if (tr.count < TRAIL_CAP) tr.count++;
        tr.seen = frame;
      }
      const e = ELEMENT_INDEX[b.element];
      const vr = ballVisualRadius(b.radius, e, b.tier);
      if (tr.comboPop < 1) tr.comboPop += dt;
      if (isGolden(b)) {
        // F3 — traînée dorée plus longue, tracée à part (aussi en mode « beaucoup de balles »)
        let gl = (many ? GOLD_TRAIL_MANY : GOLD_TRAIL) + boost;
        if (gl > TRAIL_CAP) gl = TRAIL_CAP;
        const gn = tr.count < gl ? tr.count : gl;
        tr.el = -1; tr.n = gn;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = PALETTE.gold;
        strokeTrail(tr, gn, vr * 1.7, 0.22);
        strokeTrail(tr, (gn + 1) >> 1, vr * 0.8, 0.5);
        ctx.globalCompositeOperation = 'source-over';
        tr.emitT -= dt;
        if (tr.emitT <= 0) {
          particles.burst(b.pos.x, b.pos.y, 2, (frame & 1) === 0 ? PALETTE.gold : PALETTE.goldLight, P_SPARK, 0.2, 0.8, 0, Math.PI, 0.2, 0.35, vr * 0.3, vr * 0.5, 0, PRIO_NORMAL);
          tr.emitT = many ? 0.08 : 0.045;
        }
        continue;
      }
      let len = (TRAIL_BASE[e] ?? 6) + (e === EL_LEAD ? (boost > 2 ? 2 : boost) : boost);
      if (many) len = e === EL_GHOST ? 6 : len > 4 ? 4 : len;
      if (len > TRAIL_CAP) len = TRAIL_CAP;
      const n = tr.count < len ? tr.count : len;
      const color = elColors[e] ?? PALETTE.stone;
      if (!many) ctx.strokeStyle = color;
      if (e === EL_FIRE && !many) ctx.globalCompositeOperation = 'lighter';
      const ghost = e === EL_GHOST;
      tr.el = e; tr.n = n;
      if (many) {
        // tracé groupé par élément plus bas (≤ 7 strokes au lieu de 30)
      } else {
        strokeTrail(tr, n, vr * (ghost ? 1.7 : 1.5), ghost ? 0.16 : e === EL_LEAD ? 0.3 : 0.2);
        strokeTrail(tr, (n + 1) >> 1, vr * 0.7, ghost ? 0.3 : 0.45);
      }
      if (e === EL_FIRE && !many) ctx.globalCompositeOperation = 'source-over';

      // particules d'ambiance
      tr.emitT -= dt;
      if (tr.emitT <= 0 && ambient) {
        const slow = many ? 2 : 1;
        if (e === EL_FIRE) {
          particles.burst(b.pos.x, b.pos.y, 1, (frame & 1) === 0 ? color : PALETTE.accent, P_SPARK, 0.3, 1.0, -Math.PI / 2, 0.7, 0.18, 0.32, vr * 0.35, vr * 0.6, -2.5, PRIO_LOW);
          tr.emitT = 0.035 * slow;
        } else if (e === EL_LIGHTNING) {
          particles.burst(b.pos.x, b.pos.y, 1, '#ffffff', P_SPARK, 2.5, 4.5, 0, Math.PI, 0.05, 0.1, vr * 0.25, vr * 0.4, 0, PRIO_LOW);
          tr.emitT = 0.07 * slow;
        } else if (e === EL_ICE) {
          particles.burst(b.pos.x, b.pos.y, 1, color, P_CRYSTAL, 0.1, 0.4, 0, Math.PI, 0.25, 0.4, vr * 0.35, vr * 0.5, 0.5, PRIO_LOW);
          tr.emitT = 0.11 * slow;
        } else {
          tr.emitT = 1;
        }
      }
    }
    if (many) {
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'bevel';
      ctx.lineWidth = R * 1.2;
      for (let e = 0; e < TRAIL_BASE.length; e++) {
        let any = false;
        for (let i = 0; i < MAX_TRAILS; i++) {
          const tr = trails[i]!;
          if (!tr.active || tr.seen !== frame || tr.el !== e || tr.n < 2) continue;
          if (!any) { ctx.beginPath(); any = true; }
          ctx.moveTo(tr.xs[tr.head]!, tr.ys[tr.head]!);
          for (let k = 1; k < tr.n; k++) {
            const idx = (tr.head - k + TRAIL_CAP) % TRAIL_CAP;
            ctx.lineTo(tr.xs[idx]!, tr.ys[idx]!);
          }
        }
        if (!any) continue;
        ctx.strokeStyle = elColors[e] ?? PALETTE.stone;
        ctx.globalAlpha = e === EL_GHOST ? 0.2 : 0.32;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // 2) balles (blits entiers)
    pixelTransform();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!;
      if (!b.alive) continue;
      const e = ELEMENT_INDEX[b.element];
      const idx = e * 3 + (b.tier - 1);
      if (isGolden(b)) {
        const gimg = sp.goldenAt(idx);
        if (gimg) {
          const gext = (sp.goldenExt[idx] ?? R * GOLDEN_EXTENT) * (b.radius / R);
          blit(gimg, b.pos.x - gext, b.pos.y - gext, 1);
          continue;
        }
      }
      const img = sp.ballAt(idx);
      if (!img) continue;
      const ext = (sp.ballExt[idx] ?? R * BALL_EXTENT) * (b.radius / R);
      if (e === EL_GHOST) ctx.globalAlpha = 0.6;
      blit(img, b.pos.x - ext, b.pos.y - ext, 1);
      ctx.globalAlpha = 1;
    }
    boardTransform();
    // 3) libère les traînées des balles disparues
    for (let i = 0; i < MAX_TRAILS; i++) {
      const t = trails[i]!;
      if (t.active && t.seen !== frame) t.active = false;
    }
  }

  function isGoldenId(id: number): boolean {
    if (id < 0) return false;
    for (let i = 0; i < GOLD_RING; i++) if (goldIds[i] === id) return true;
    return false;
  }
  function isGolden(b: Readonly<Ball>): boolean {
    return b.golden === true || isGoldenId(b.id);
  }

  /** bitmap « ×N » d'un combo (créé à la 1re apparition de N, puis réutilisé) */
  function comboImage(v: number): HTMLCanvasElement | undefined {
    if (v > COMBO_CACHE_MAX) return undefined;
    const hitImg = comboImgs[v];
    if (hitImg) return hitImg;
    const tier = v >= COMBO_TIER_2 ? 2 : v >= COMBO_TIER_1 ? 1 : 0;
    const label = countLabel(v);
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    if (!g) return undefined;
    const font = comboFonts[tier] ?? smallFont;
    g.font = font;
    const pad = 3 * l.dpr;
    const fs = l.scale * l.dpr * (tier === 2 ? 0.3 : tier === 1 ? 0.245 : 0.2);
    c.width = Math.ceil(g.measureText(label).width + pad * 2);
    c.height = Math.ceil(fs * 1.3 + pad * 2);
    g.font = font; // le redimensionnement réinitialise l'état du contexte
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 3 * l.dpr;
    g.strokeStyle = PALETTE.outline;
    g.fillStyle = tier === 0 ? '#ffffff' : PALETTE.accent;
    g.strokeText(label, c.width / 2, c.height / 2);
    g.fillText(label, c.width / 2, c.height / 2);
    comboImgs[v] = c;
    return c;
  }

  /**
   * F7 — combo sur la balle (≥ 8), petit, en haut à droite, taille par paliers 8/16/32.
   * Au-delà de MANY_BALLS balles vivantes, seulement les COMBO_TOP meilleurs combos.
   * Contexte en pixels physiques.
   */
  function drawBallCombos(state: Readonly<RunState>): void {
    const balls = state.balls;
    let alive = 0, shown = 0;
    // top 3 (indices) sans allocation
    let i1 = -1, i2 = -1, i3 = -1, c1 = -1, c2 = -1, c3 = -1;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!;
      if (!b.alive) continue;
      alive++;
      const c = b.combo;
      if (c < COMBO_SHOW) continue;
      shown++;
      if (c > c1) { i3 = i2; c3 = c2; i2 = i1; c2 = c1; i1 = i; c1 = c; }
      else if (c > c2) { i3 = i2; c3 = c2; i2 = i; c2 = c; }
      else if (c > c3) { i3 = i; c3 = c; }
    }
    if (shown === 0) return;
    const topOnly = alive > MANY_BALLS;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!;
      if (!b.alive || b.combo < COMBO_SHOW) continue;
      if (topOnly && i !== i1 && i !== i2 && i !== i3) continue;
      const v = b.combo;
      const tier = v >= COMBO_TIER_2 ? 2 : v >= COMBO_TIER_1 ? 1 : 0;
      const tr = trailFor(b.id, -1, b.pos.x, b.pos.y);
      if (tier !== tr.comboTier) { if (tier > tr.comboTier) tr.comboPop = 0; tr.comboTier = tier; }
      const vr = ballVisualRadius(b.radius, ELEMENT_INDEX[b.element], b.tier);
      const ax = OX + (b.pos.x + vr * 0.9) * K, ay = OY + (b.pos.y - vr * 0.9) * K;
      const pop = tr.comboPop < COMBO_POP ? 1 + 0.45 * (1 - tr.comboPop / COMBO_POP) : 1;
      const img = comboImage(v);
      if (!img) continue;
      const w = img.width * pop, h = img.height * pop;
      // ancré en bas à gauche ; basculé à gauche de la balle contre le mur droit
      let x = ax - 2 * l.dpr;
      if (x + w > OX + l.cols * K) x = OX + (b.pos.x - vr * 0.9) * K - w + 2 * l.dpr;
      const y = ay - h + 2 * l.dpr;
      if (pop === 1) ctx.drawImage(img, Math.round(x), Math.round(y));
      else ctx.drawImage(img, x, y, w, h);
    }
  }

  /** voile de défaite + onde de seconde chance (pixels physiques, limité au plateau) */
  function drawOverlays(dt: number): void {
    let veil = 0;
    if (lostT >= 0) {
      lostT += dt;
      veil = VEIL_ALPHA * (lostT < VEIL_IN ? lostT / VEIL_IN : 1);
    } else if (liftT >= 0) {
      liftT += dt;
      if (liftT >= VEIL_OUT) liftT = -1;
      else veil = liftFrom * (1 - liftT / VEIL_OUT);
    }
    const bx = Math.round(OX), by = Math.round(OY), bw = Math.round(l.cols * K), bh = Math.round(l.rows * K);
    if (veil > 0) {
      ctx.globalAlpha = veil;
      ctx.fillStyle = PALETTE.bg0;
      ctx.fillRect(bx, by, bw, bh);
    }
    if (reviveT >= 0) {
      reviveT += dt;
      if (reviveT >= REVIVE_WAVE) reviveT = -1;
      else {
        const t = reviveT / REVIVE_WAVE;
        const top = l.rows - 1;
        const yb = top - easeOutCubic(t) * top; // monte de la ligne du joueur au plafond
        const a = 1 - t;
        const py = Math.round(OY + yb * K);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.12 * a;
        ctx.fillRect(bx, py, bw, Math.round(0.9 * K));
        ctx.globalAlpha = 0.25 * a;
        ctx.fillRect(bx, py, bw, Math.round(0.3 * K));
        ctx.globalAlpha = 0.85 * a;
        ctx.fillRect(bx, py, bw, Math.max(1, Math.round(0.05 * K)));
      }
    }
    ctx.globalAlpha = 1;
  }

  /** bloc disparu sans événement (rangées effacées par la seconde chance) : éclats */
  function onVanish(fx: BlockFx): void {
    if (suppressVanish || curPhase === 'advancing' || prevPhase === 'advancing') return;
    for (let i = 0; i < BREACH_RING; i++) if (breachIds[i] === fx.id) return;
    const cx = fx.x + fx.w * 0.5, cy = fx.y + 0.5;
    const color = d.colors.kind[fx.kind] ?? PALETTE.block;
    particles.burst(cx, cy, 8 * fx.w, color, P_SHARD, 2, 6, -Math.PI / 2, Math.PI, 0.3, 0.55, 0.06, 0.11, 6, PRIO_NORMAL);
    particles.burst(cx, cy, 3, '#ffffff', P_SPARK, 2, 5, -Math.PI / 2, Math.PI, 0.1, 0.2, 0.03, 0.05, 0, PRIO_NORMAL);
    vfx.flashRect(fx.x + 0.05, fx.y + 0.05, fx.w - 0.1, 0.9, 90, '#ffffff');
  }

  function drawLaunch(state: Readonly<RunState>): void {
    if (state.phase !== 'aiming' && state.phase !== 'firing') return;
    const sp = d.getSprites();
    const x = state.launchPos.x, y = state.launchPos.y;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    ctx.globalAlpha = 0.35 + 0.25 * pulse;
    ctx.drawImage(sp.halo, x - HALO_EXTENT, y - HALO_EXTENT, HALO_EXTENT * 2, HALO_EXTENT * 2);
    ctx.globalAlpha = 0.6 + 0.3 * pulse;
    ctx.strokeStyle = PALETTE.text;
    ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.arc(x, y, R * (1.9 + 0.5 * pulse), 0, Math.PI * 2); ctx.stroke();
    if (state.phase === 'aiming') {
      const v = state.volley[0];
      const e = ELEMENT_INDEX[v ? v.element : 'stone'];
      const tier = v ? v.tier : 1;
      const img = sp.ballAt(e * 3 + (tier - 1));
      if (img) {
        const ext = sp.ballExt[e * 3 + (tier - 1)] ?? R * BALL_EXTENT;
        ctx.globalAlpha = 1;
        ctx.drawImage(img, x - ext, y - ext, ext * 2, ext * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPending(state: Readonly<RunState>): void {
    if (state.phase !== 'firing' || state.pendingLaunches <= 0) return;
    const k = l.scale * l.dpr;
    // juste au-dessus du point de lancement, décalé vers l'intérieur du plateau (la bande
    // sous le plateau appartient au HUD DOM)
    const side = state.launchPos.x > l.cols - 1 ? -1 : 1;
    const px = (l.offX + state.launchPos.x * l.scale) * l.dpr + side * k * 0.5;
    const py = (l.offY + state.launchPos.y * l.scale) * l.dpr - k * 0.3;
    ctx.font = smallFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3 * l.dpr;
    ctx.strokeStyle = PALETTE.outline;
    ctx.fillStyle = PALETTE.textDim;
    const s = countLabel(state.pendingLaunches);
    ctx.strokeText(s, px, py);
    ctx.fillText(s, px, py);
  }

  // ------------------------------------------------------------------
  // Plateau
  // ------------------------------------------------------------------
  function drawGrid(state: Readonly<RunState>): void {
    // pendant l'avancée, la grille glisse d'une cellule vers le bas (période 1 → sans couture)
    const p = state.advanceProgress < 0 ? 0 : state.advanceProgress > 1 ? 1 : state.advanceProgress;
    const gy = state.phase === 'advancing' ? easeOutCubic(p) : 0;
    ctx.strokeStyle = 'rgba(232,236,245,0.06)';
    ctx.lineWidth = 0.022;
    ctx.beginPath();
    for (let i = 1; i < l.cols; i++) { ctx.moveTo(i, 0); ctx.lineTo(i, l.rows); }
    for (let j = 0; j < l.rows; j++) { const y = j + gy; ctx.moveTo(0, y); ctx.lineTo(l.cols, y); }
    ctx.stroke();
    // rangée du joueur : teinte danger très discrète
    ctx.fillStyle = 'rgba(255,94,94,0.05)';
    ctx.fillRect(0, l.rows - 1, l.cols, 1);
  }

  function drawDust(state: Readonly<RunState>, dt: number): void {
    const fall = state.phase === 'advancing' ? 3.2 : 0;
    ctx.fillStyle = PALETTE.text;
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < DUST; i++) {
      let y = dust[i * 3 + 1]! + (fall - dust[i * 3 + 2]!) * dt;
      if (y < -0.1) { y = l.rows + 0.1; dust[i * 3] = Math.random() * l.cols; }
      else if (y > l.rows + 0.1) { y = -0.1; dust[i * 3] = Math.random() * l.cols; }
      dust[i * 3 + 1] = y;
      const x = dust[i * 3]! + Math.sin(time * 0.5 + i) * 0.1;
      const h = fall > 0 ? 0.12 : 0.04;
      ctx.fillRect(x, y, 0.04, h);
    }
    ctx.globalAlpha = 1;
  }

  function updatePower(state: Readonly<RunState>, dt: number): void {
    const active = state.phase === 'firing' || state.phase === 'advancing';
    const target = active ? powerTarget(state.currentShotDamage) : 0;
    const rate = target > power ? 2.5 : 0.8;
    power += (target - power) * (dt * rate > 1 ? 1 : dt * rate);
    const lvl = Math.round(power * (POWER_LEVELS - 1));
    if (lvl !== powerLevel) { powerLevel = lvl; d.onPowerLevel(lvl); }
  }

  function drawFrame(state: Readonly<RunState>, dt: number, frame: number): void {
    time += dt;
    prevPhase = curPhase;
    curPhase = state.phase;
    const sp = d.getSprites();
    const dpr = l.dpr;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const cols = l.cols, rows = l.rows;
    updatePower(state, dt);

    // canvas transparent : le fond est en CSS (backdrop.ts)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);

    // unités plateau
    K = l.scale * dpr;
    OX = l.offX * dpr;
    OY = l.offY * dpr;
    // clip aligné sur les pixels physiques (un clip fractionnaire force le chemin anti-aliasé)
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(OX), Math.round(OY), Math.round(cols * K), Math.round(rows * K));
    ctx.clip();
    boardTransform();
    drawGrid(state);
    drawDust(state, dt);

    // ligne du joueur : trait danger discret (franchie = dégâts)
    ctx.strokeStyle = PALETTE.danger;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.025;
    ctx.setLineDash(DASH_FINE);
    ctx.lineDashOffset = 0;
    ctx.beginPath(); ctx.moveTo(0, rows - 1); ctx.lineTo(cols, rows - 1); ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = 1;

    drawBlocks(state, frame);
    suppressPop = false;
    drawDrops(state);
    drawAim(state);
    drawBalls(state, frame, dt);
    d.fusions.draw(ctx, sp, R);
    pixelTransform();
    particles.draw(ctx, K, OX, OY);
    boardTransform();
    vfx.drawWorld(ctx, K, OX, OY);
    ctx.restore();
    // point de lancement hors clip : il est posé sur le sol
    drawLaunch(state);

    // murs (hors clip) + sol
    ctx.strokeStyle = PALETTE.wall;
    ctx.lineWidth = 0.08;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, rows); ctx.lineTo(0, 0); ctx.lineTo(cols, 0); ctx.lineTo(cols, rows);
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.moveTo(0, rows); ctx.lineTo(cols, rows); ctx.stroke();
    ctx.globalAlpha = 1;

    // texte en pixels physiques
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawHpLabels(state);
    drawPending(state);
    drawBallCombos(state);
    drawOverlays(dt);
    numbers.draw(ctx, l);

    vfx.sweepBlockFx(frame, onVanish);
    suppressVanish = false;
  }

  rebuildFonts();
  return {
    draw: drawFrame,
    rebuildFonts,
    clearTrails() { for (let i = 0; i < MAX_TRAILS; i++) trails[i]!.active = false; },
    suppressSpawnPop() { suppressPop = true; suppressVanish = true; },
    markGolden(id) { goldIds[goldIdx] = id; goldIdx = (goldIdx + 1) % GOLD_RING; },
    isGolden,
    isGoldenId,
    noteBreached(id) { breachIds[breachIdx] = id; breachIdx = (breachIdx + 1) % BREACH_RING; },
    setLost() { if (lostT < 0) { lostT = 0; liftT = -1; } },
    revive() {
      if (lostT >= 0) { liftFrom = VEIL_ALPHA * (lostT < VEIL_IN ? lostT / VEIL_IN : 1); liftT = 0; }
      lostT = -1;
      reviveT = 0;
    },
    clearOverlays() { lostT = -1; liftT = -1; reviveT = -1; goldIds.fill(-1); breachIds.fill(-1); },
  };
}
