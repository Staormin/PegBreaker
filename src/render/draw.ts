// render/draw.ts — dessin d'une frame. AUCUNE allocation ici : pas de new / {} / [] / closures /
// map / filter / template strings. Tout l'état mutable est pré-alloué dans createFrameDrawer.
import type { Block, RunState } from '../core/types';
import { easeOutBack } from '../core/math';
import type { Layout } from './layout';
import type { Sprites } from './sprites';
import { BALL_EXTENT, DROP_EXTENT, HALO_EXTENT, PEG_RADIUS } from './sprites';
import type { Particles } from './particles';
import type { DamageNumbers } from './damageNumbers';
import { formatNumber } from './damageNumbers';
import type { Vfx } from './vfx';
import { ELEMENT_INDEX, KIND_INDEX, PALETTE } from './palette';

const TRAIL_LEN = 6;
const MAX_TRAILS = 96;
const DUST = 20;
const AIM_REFLECT_LEN = 1.5;
const DASH: number[] = [0.14, 0.11];
const DASH_FINE: number[] = [0.07, 0.09];
const NO_DASH: number[] = [];

interface Trail {
  active: boolean;
  id: number;
  seen: number;
  xs: Float32Array;
  ys: Float32Array;
  head: number;
  count: number;
}

/** Résultat d'un raycast (objet unique réutilisé). */
interface RayHit { t: number; nx: number; ny: number; }

export interface FrameDrawer {
  draw(state: Readonly<RunState>, dt: number, frame: number): void;
  /** à appeler après resize (fonts recalculées) */
  rebuildFonts(): void;
  clearTrails(): void;
}

export interface DrawDeps {
  ctx: CanvasRenderingContext2D;
  layout: Layout;
  getSprites(): Sprites;
  particles: Particles;
  numbers: DamageNumbers;
  vfx: Vfx;
  ballRadius: number;
}

export function createFrameDrawer(d: DrawDeps): FrameDrawer {
  const { ctx, layout: l, particles, numbers, vfx } = d;
  const R = d.ballRadius;

  const trails: Trail[] = [];
  for (let i = 0; i < MAX_TRAILS; i++) {
    trails.push({ active: false, id: -1, seen: 0, xs: new Float32Array(TRAIL_LEN), ys: new Float32Array(TRAIL_LEN), head: 0, count: 0 });
  }
  const dust = new Float32Array(DUST * 3); // x, y, vitesse
  for (let i = 0; i < DUST; i++) {
    dust[i * 3] = Math.random() * l.cols;
    dust[i * 3 + 1] = Math.random() * l.rows;
    dust[i * 3 + 2] = 0.05 + Math.random() * 0.12;
  }
  const hit: RayHit = { t: 0, nx: 0, ny: 0 };
  /** chaînes « ×N » mises en cache (allocation uniquement à la 1re apparition de N) */
  const countLabels: string[] = [];
  let hpFont = '';
  let hpFontSmall = '';
  let bossFont = '';
  let smallFont = '';
  let time = 0;

  function rebuildFonts(): void {
    const px = l.scale * l.dpr;
    const fam = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    hpFont = `800 ${Math.max(8, Math.round(px * 0.42))}px ${fam}`;
    hpFontSmall = `800 ${Math.max(7, Math.round(px * 0.3))}px ${fam}`;
    bossFont = `800 ${Math.max(10, Math.round(px * 0.5))}px ${fam}`;
    smallFont = `700 ${Math.max(8, Math.round(px * 0.28))}px ${fam}`;
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
    raycast(state.blocks, ox, oy, dx, dy, 30);
    const hx = ox + dx * hit.t, hy = oy + dy * hit.t;
    const nx = hit.nx, ny = hit.ny;

    ctx.lineCap = 'round';
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

  // ------------------------------------------------------------------
  // Blocs
  // ------------------------------------------------------------------
  function drawBlocks(state: Readonly<RunState>, frame: number): void {
    const sp = d.getSprites();
    const blocks = state.blocks;
    const advancing = state.phase === 'advancing';
    const shift = advancing ? easeOutBack(state.advanceProgress < 0 ? 0 : state.advanceProgress > 1 ? 1 : state.advanceProgress) : 0;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      const fx = vfx.blockFx(b.id);
      fx.seenFrame = frame;
      if (fx.hp !== b.hp) { fx.hp = b.hp; fx.label = formatNumber(Math.ceil(b.hp - 1e-6)); }
      const kind = KIND_INDEX[b.kind];
      // un bloc gelé ne descend pas : pas d'interpolation
      const y = b.row + (b.frozen ? 0 : shift);
      fx.x = b.col; fx.y = y; fx.w = b.width; fx.kind = kind;

      const row = sp.block[kind];
      const img = (row && (row[b.width] ?? row[1])) ?? undefined;
      if (!img) continue;
      const s = vfx.squashScale(fx);
      const w = b.width * s, h = s;
      const x0 = b.col + (b.width - w) * 0.5, y0 = y + (1 - h) * 0.5;
      ctx.drawImage(img, x0, y0, w, h);
      if (fx.squashT < 0.07) {
        // éclair blanc à l'impact : ré-dessin additif du sprite
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 * (1 - fx.squashT / 0.07);
        ctx.drawImage(img, x0, y0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      if (b.frozen) {
        const fz = sp.frozen[b.width] ?? sp.frozen[1];
        if (fz) {
          ctx.globalAlpha = 0.9;
          ctx.drawImage(fz, x0, y0, w, h);
          ctx.globalAlpha = 1;
        }
      }
      if (b.kind === 'boss') drawBossEyes(state, b.col + b.width * 0.5, y + 0.3, b.width);
    }
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

  function drawHpLabels(state: Readonly<RunState>): void {
    const blocks = state.blocks;
    const k = l.scale * l.dpr;
    const ox = (l.offX + vfx.shakeX) * l.dpr, oy = (l.offY + vfx.shakeY) * l.dpr;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 3 * l.dpr;
    ctx.fillStyle = '#ffffff';
    let font = '';
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (b.kind === 'peg') continue;
      const fx = vfx.peekBlockFx(b.id);
      if (!fx) continue;
      const boss = b.kind === 'boss';
      // libellés longs (≥ 4 caractères) en police réduite pour tenir dans la cellule
      const f = boss ? bossFont : fx.label.length >= 4 ? hpFontSmall : hpFont;
      if (f !== font) { ctx.font = f; font = f; }
      const px = ox + (fx.x + fx.w * 0.5) * k;
      const py = oy + (fx.y + (boss ? 0.66 : 0.53)) * k;
      ctx.strokeText(fx.label, px, py);
      ctx.fillText(fx.label, px, py);
    }
  }

  // ------------------------------------------------------------------
  // Drops, balles, traînées
  // ------------------------------------------------------------------
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
        const img = sp.ball[ELEMENT_INDEX[dr.element ?? 'stone'] * 3];
        if (img) {
          const e = R * BALL_EXTENT * 1.35;
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
    t.active = true; t.id = id; t.head = 0; t.count = 1; t.seen = frame;
    t.xs[0] = x; t.ys[0] = y;
    return t;
  }

  function drawBalls(state: Readonly<RunState>, frame: number): void {
    const sp = d.getSprites();
    const balls = state.balls;
    const e = R * BALL_EXTENT;
    // 1) échantillonne et dessine les traînées
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!;
      if (!b.alive) continue;
      const tr = trailFor(b.id, frame, b.pos.x, b.pos.y);
      if (tr.seen !== frame) {
        tr.head = (tr.head + 1) % TRAIL_LEN;
        tr.xs[tr.head] = b.pos.x; tr.ys[tr.head] = b.pos.y;
        if (tr.count < TRAIL_LEN) tr.count++;
        tr.seen = frame;
      }
      const img = sp.ball[ELEMENT_INDEX[b.element] * 3];
      if (!img) continue;
      for (let k = 1; k < tr.count; k++) {
        const idx = (tr.head - k + TRAIL_LEN) % TRAIL_LEN;
        const f = 1 - k / TRAIL_LEN;
        const s = e * (0.45 + 0.5 * f);
        ctx.globalAlpha = 0.35 * f;
        ctx.drawImage(img, tr.xs[idx]! - s, tr.ys[idx]! - s, s * 2, s * 2);
      }
    }
    ctx.globalAlpha = 1;
    // 2) balles
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!;
      if (!b.alive) continue;
      const img = sp.ball[ELEMENT_INDEX[b.element] * 3 + (b.tier - 1)];
      if (!img) continue;
      const s = e * (b.radius / R);
      if (b.element === 'ghost') ctx.globalAlpha = 0.7;
      ctx.drawImage(img, b.pos.x - s, b.pos.y - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
    }
    // 3) libère les traînées des balles disparues
    for (let i = 0; i < MAX_TRAILS; i++) {
      const t = trails[i]!;
      if (t.active && t.seen !== frame) t.active = false;
    }
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
      const img = sp.ball[ELEMENT_INDEX[v ? v.element : 'stone'] * 3 + (v ? v.tier - 1 : 0)];
      if (img) {
        const e = R * BALL_EXTENT;
        ctx.globalAlpha = 1;
        ctx.drawImage(img, x - e, y - e, e * 2, e * 2);
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
    const px = (l.offX + vfx.shakeX + state.launchPos.x * l.scale) * l.dpr + side * k * 0.5;
    const py = (l.offY + vfx.shakeY + state.launchPos.y * l.scale) * l.dpr - k * 0.3;
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
  function drawDust(dt: number): void {
    ctx.fillStyle = PALETTE.text;
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < DUST; i++) {
      let y = dust[i * 3 + 1]! - dust[i * 3 + 2]! * dt;
      if (y < -0.1) { y = l.rows + 0.1; dust[i * 3] = Math.random() * l.cols; }
      dust[i * 3 + 1] = y;
      const x = dust[i * 3]! + Math.sin(time * 0.5 + i) * 0.1;
      ctx.fillRect(x, y, 0.04, 0.04);
    }
    ctx.globalAlpha = 1;
  }

  function drawFrame(state: Readonly<RunState>, dt: number, frame: number): void {
    time += dt;
    const sp = d.getSprites();
    const dpr = l.dpr;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const cols = l.cols, rows = l.rows;

    // fond (pixels physiques, sans shake)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(sp.bg, 0, 0, W, H);

    // unités plateau
    const k = l.scale * dpr;
    ctx.setTransform(k, 0, 0, k, (l.offX + vfx.shakeX) * dpr, (l.offY + vfx.shakeY) * dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cols, rows);
    ctx.clip();
    ctx.drawImage(sp.grid, 0, 0, cols, rows);
    drawDust(dt);

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
    drawDrops(state);
    drawAim(state);
    drawBalls(state, frame);
    particles.draw(ctx);
    vfx.drawWorld(ctx);
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

    // texte en pixels physiques (avec shake)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawHpLabels(state);
    drawPending(state);
    numbers.draw(ctx, l, vfx.shakeX, vfx.shakeY);

    // overlays plein écran (sans shake)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    vfx.drawOverlay(ctx, W, H, sp.vignette, sp.redEdge);

    vfx.sweepBlockFx(frame);
  }

  rebuildFonts();
  return {
    draw: drawFrame,
    rebuildFonts,
    clearTrails() { for (let i = 0; i < MAX_TRAILS; i++) trails[i]!.active = false; },
  };
}
