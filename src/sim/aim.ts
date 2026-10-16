// sim/aim.ts — normalisation de la visée et prévisualisation (lancer de rayon analytique).
import type { Block, Vec2 } from '../core/types';
import type { Ctx } from './ctx';
import { isDead } from './ctx';
import { PEG_RADIUS, PREVIEW_REFLECT_LEN } from './constants';

/** Normalise, force y < 0 et impose l'angle minimal par rapport à l'horizontale. */
export function clampAim(ctx: Ctx, dir: Vec2): Vec2 {
  let x = Number.isFinite(dir.x) ? dir.x : 0;
  let y = Number.isFinite(dir.y) ? dir.y : -1;
  const l = Math.hypot(x, y);
  if (l < 1e-9) return { x: 0, y: -1 };
  x /= l;
  y = -Math.abs(y / l);
  if (-y < ctx.sinMinAngle) {
    y = -ctx.sinMinAngle;
    x = (x < 0 ? -1 : 1) * ctx.cosMinAngle;
  }
  return { x, y };
}

/** Rayon contre AABB élargie du rayon de la balle (méthode des slabs). */
function rayBox(sx: number, sy: number, dx: number, dy: number, b: Block, r: number, out: { t: number; nx: number; ny: number }): void {
  const minX = b.col - r;
  const maxX = b.col + b.width + r;
  const minY = b.row - r;
  const maxY = b.row + 1 + r;
  let tmin = -Infinity;
  let tmax = Infinity;
  let nx = 0;
  let ny = 0;
  if (Math.abs(dx) < 1e-12) {
    if (sx < minX || sx > maxX) return;
  } else {
    const t1 = (minX - sx) / dx;
    const t2 = (maxX - sx) / dx;
    const tn = Math.min(t1, t2);
    if (tn > tmin) {
      tmin = tn;
      nx = dx > 0 ? -1 : 1;
      ny = 0;
    }
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (Math.abs(dy) < 1e-12) {
    if (sy < minY || sy > maxY) return;
  } else {
    const t1 = (minY - sy) / dy;
    const t2 = (maxY - sy) / dy;
    const tn = Math.min(t1, t2);
    if (tn > tmin) {
      tmin = tn;
      nx = 0;
      ny = dy > 0 ? -1 : 1;
    }
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmin > tmax || tmin < 0 || tmin >= out.t) return;
  out.t = tmin;
  out.nx = nx;
  out.ny = ny;
}

function rayCircle(sx: number, sy: number, dx: number, dy: number, cx: number, cy: number, R: number, out: { t: number; nx: number; ny: number }): void {
  const fx = sx - cx;
  const fy = sy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - R * R;
  const disc = b * b - c;
  if (disc < 0) return;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t >= out.t) return;
  out.t = t;
  const hx = sx + dx * t - cx;
  const hy = sy + dy * t - cy;
  const l = Math.hypot(hx, hy) || 1;
  out.nx = hx / l;
  out.ny = hy / l;
}

/** [départ, premier impact (centre de la balle), point à 1,5 u après réflexion]. */
export function preview(ctx: Ctx, dir: Vec2): Vec2[] {
  const board = ctx.cfg.blocks.board;
  const r = board.ballRadius;
  const d = clampAim(ctx, dir);
  const sx = ctx.s.launchPos.x;
  const sy = board.rows - r;
  const hit = { t: Infinity, nx: 0, ny: 1 };
  if (d.x < 0) {
    const t = (r - sx) / d.x;
    if (t < hit.t) Object.assign(hit, { t, nx: 1, ny: 0 });
  } else if (d.x > 0) {
    const t = (board.cols - r - sx) / d.x;
    if (t < hit.t) Object.assign(hit, { t, nx: -1, ny: 0 });
  }
  const tc = (r - sy) / d.y;
  if (tc < hit.t) Object.assign(hit, { t: tc, nx: 0, ny: 1 });
  for (const b of ctx.s.blocks) {
    if (isDead(b)) continue;
    if (b.kind === 'peg') rayCircle(sx, sy, d.x, d.y, b.col + 0.5, b.row + 0.5, PEG_RADIUS + r, hit);
    else rayBox(sx, sy, d.x, d.y, b, r, hit);
  }
  const t = Math.max(0, hit.t);
  const px = sx + d.x * t;
  const py = sy + d.y * t;
  const dn = d.x * hit.nx + d.y * hit.ny;
  const rx = d.x - 2 * dn * hit.nx;
  const ry = d.y - 2 * dn * hit.ny;
  return [
    { x: ctx.s.launchPos.x, y: ctx.s.launchPos.y },
    { x: px, y: py },
    { x: px + rx * PREVIEW_REFLECT_LEN, y: py + ry * PREVIEW_REFLECT_LEN },
  ];
}
