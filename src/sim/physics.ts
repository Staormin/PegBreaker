// sim/physics.ts — déplacement des balles, murs, sol, collisions cercle/AABB et cercle/cercle.
// Broad phase : grille cellule → index de bloc. Pas de tunneling : à 240 Hz, le déplacement
// par sous-pas (ballSpeed/240) reste inférieur au rayon de la balle (vérifié par core/config.ts).
import type { Ball, Block } from '../core/types';
import type { Ctx } from './ctx';
import { emit, isDead } from './ctx';
import { LAUNCH_MARGIN, PEG_RADIUS } from './constants';
import { bumpCombo, onImpact } from './combat';
import { collectTouched } from './drops';
import { compactBlocks, releaseBall } from './pools';

export function rebuildGrid(ctx: Ctx): void {
  const { cols, rows } = ctx.cfg.blocks.board;
  const g = ctx.grid;
  g.fill(-1);
  const blocks = ctx.s.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as Block;
    if (isDead(b) || b.row < 0 || b.row >= rows) continue;
    for (let c = b.col; c < b.col + b.width; c++) if (c >= 0 && c < cols) g[b.row * cols + c] = i;
  }
  ctx.gridDirty = false;
}

/** Bloc cassable rectangulaire (non cheville) dans la cellule ? (pour lisser les jointures) */
function boxAt(ctx: Ctx, col: number, row: number): boolean {
  const { cols, rows } = ctx.cfg.blocks.board;
  if (col < 0 || col >= cols || row < 0 || row >= rows) return false;
  const idx = ctx.grid[row * cols + col] as number;
  if (idx < 0) return false;
  const b = ctx.s.blocks[idx];
  return !!b && b.kind !== 'peg' && !isDead(b);
}

/** Renormalise à ballSpeed et impose l'angle minimal par rapport à l'horizontale. */
function fixVelocity(ctx: Ctx, b: Ball): void {
  const sp = ctx.cfg.blocks.board.ballSpeed;
  let vx = b.vel.x;
  let vy = b.vel.y;
  const l = Math.hypot(vx, vy);
  if (l < 1e-9) {
    vx = 0;
    vy = -sp;
  } else {
    vx = (vx / l) * sp;
    vy = (vy / l) * sp;
  }
  const minVy = sp * ctx.sinMinAngle;
  if (Math.abs(vy) < minVy) {
    vy = vy < 0 ? -minVy : minVy;
    vx = (vx < 0 ? -1 : 1) * sp * ctx.cosMinAngle;
  }
  b.vel.x = vx;
  b.vel.y = vy;
}

function collideBox(ctx: Ctx, b: Ball, bi: number, blk: Block): void {
  const r = b.radius;
  const minX = blk.col;
  const maxX = blk.col + blk.width;
  const minY = blk.row;
  const maxY = blk.row + 1;
  const x = b.pos.x;
  const y = b.pos.y;
  const qx = x < minX ? minX : x > maxX ? maxX : x;
  const qy = y < minY ? minY : y > maxY ? maxY : y;
  const dx = x - qx;
  const dy = y - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  let nx: number;
  let ny: number;
  let pen: number;
  if (d2 > 1e-12) {
    if (dx !== 0 && dy !== 0) {
      // coin : si un bloc voisin prolonge la face, la jointure est plate
      const sideCol = dx < 0 ? blk.col - 1 : blk.col + blk.width;
      const cornerCol = dx < 0 ? blk.col : blk.col + blk.width - 1;
      const vRow = dy < 0 ? blk.row - 1 : blk.row + 1;
      if (boxAt(ctx, sideCol, blk.row)) {
        nx = 0;
        ny = dy < 0 ? -1 : 1;
        pen = r - Math.abs(dy);
      } else if (boxAt(ctx, cornerCol, vRow)) {
        nx = dx < 0 ? -1 : 1;
        ny = 0;
        pen = r - Math.abs(dx);
      } else {
        const d = Math.sqrt(d2);
        nx = dx / d;
        ny = dy / d;
        pen = r - d;
      }
    } else {
      const d = Math.sqrt(d2);
      nx = dx / d;
      ny = dy / d;
      pen = r - d;
    }
  } else {
    // centre à l'intérieur : axe de pénétration minimale
    const l = x - minX;
    const rr = maxX - x;
    const t = y - minY;
    const bo = maxY - y;
    let m = l;
    nx = -1;
    ny = 0;
    if (rr < m) {
      m = rr;
      nx = 1;
      ny = 0;
    }
    if (t < m) {
      m = t;
      nx = 0;
      ny = -1;
    }
    if (bo < m) {
      m = bo;
      nx = 0;
      ny = 1;
    }
    pen = m + r;
  }
  if (pen > 0) {
    b.pos.x += nx * pen;
    b.pos.y += ny * pen;
  }
  const vn = b.vel.x * nx + b.vel.y * ny;
  if (vn < 0) {
    b.vel.x -= 2 * vn * nx;
    b.vel.y -= 2 * vn * ny;
    fixVelocity(ctx, b);
    onImpact(ctx, b, bi, qx, qy, nx, ny, true);
  }
}

function collidePeg(ctx: Ctx, b: Ball, bi: number, blk: Block): void {
  const cx = blk.col + 0.5;
  const cy = blk.row + 0.5;
  const R = PEG_RADIUS + b.radius;
  const dx = b.pos.x - cx;
  const dy = b.pos.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return;
  let nx = 0;
  let ny = 1;
  let d = 0;
  if (d2 > 1e-12) {
    d = Math.sqrt(d2);
    nx = dx / d;
    ny = dy / d;
  }
  const pen = R - d;
  b.pos.x += nx * pen;
  b.pos.y += ny * pen;
  const vn = b.vel.x * nx + b.vel.y * ny;
  if (vn < 0) {
    b.vel.x -= 2 * vn * nx;
    b.vel.y -= 2 * vn * ny;
    fixVelocity(ctx, b);
    onImpact(ctx, b, bi, cx + nx * PEG_RADIUS, cy + ny * PEG_RADIUS, nx, ny, true);
  }
}

function overlaps(blk: Block, x: number, y: number, r: number): boolean {
  if (blk.kind === 'peg') {
    const dx = x - (blk.col + 0.5);
    const dy = y - (blk.row + 0.5);
    const R = PEG_RADIUS + r;
    return dx * dx + dy * dy < R * R;
  }
  const qx = x < blk.col ? blk.col : x > blk.col + blk.width ? blk.col + blk.width : x;
  const qy = y < blk.row ? blk.row : y > blk.row + 1 ? blk.row + 1 : y;
  const dx = x - qx;
  const dy = y - qy;
  return dx * dx + dy * dy < r * r;
}

/** Collisions avec les blocs des cellules recouvertes (≤ 4 cellules, dédoublonnées pour les boss). */
function collideBlocks(ctx: Ctx, b: Ball, px: number, py: number): void {
  const { cols, rows } = ctx.cfg.blocks.board;
  const ghost = b.element === 'ghost';
  for (let pass = 0; pass < 2; pass++) {
    if (ctx.gridDirty) rebuildGrid(ctx);
    const r = b.radius;
    const c0 = Math.max(0, Math.floor(b.pos.x - r));
    const c1 = Math.min(cols - 1, Math.floor(b.pos.x + r));
    const r0 = Math.max(0, Math.floor(b.pos.y - r));
    const r1 = Math.min(rows - 1, Math.floor(b.pos.y + r));
    let seen0 = -1;
    let seen1 = -1;
    let seen2 = -1;
    let hit = false;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const idx = ctx.grid[row * cols + col] as number;
        if (idx < 0 || idx === seen0 || idx === seen1 || idx === seen2) continue;
        seen2 = seen1;
        seen1 = seen0;
        seen0 = idx;
        const blk = ctx.s.blocks[idx];
        if (!blk || isDead(blk)) continue;
        if (ghost) {
          if (overlaps(blk, b.pos.x, b.pos.y, r) && !overlaps(blk, px, py, r)) {
            onImpact(ctx, b, idx, b.pos.x, b.pos.y, 0, 0, false);
          }
          continue;
        }
        const vx = b.vel.x;
        const vy = b.vel.y;
        if (blk.kind === 'peg') collidePeg(ctx, b, idx, blk);
        else collideBox(ctx, b, idx, blk);
        if (vx !== b.vel.x || vy !== b.vel.y) hit = true;
      }
    }
    // une seconde passe seulement si la poussée a pu faire entrer la balle dans un voisin
    if (ghost || !hit) return;
  }
}

function groundBall(ctx: Ctx, b: Ball): void {
  const s = ctx.s;
  const board = ctx.cfg.blocks.board;
  b.pos.y = board.rows - b.radius;
  emit(ctx, { type: 'ball:grounded', ballId: b.id, pos: { x: b.pos.x, y: board.rows } });
  if (!s.internal.firstGrounded) {
    s.internal.firstGrounded = true;
    s.launchPos.x = Math.min(board.cols - LAUNCH_MARGIN, Math.max(LAUNCH_MARGIN, b.pos.x));
    s.launchPos.y = board.rows;
  }
  if (ctx.relic.safetynet && !s.internal.safetynetUsed && b.combo > 0) {
    s.internal.safetynetUsed = true;
    s.internal.inheritCombo = b.combo;
  }
  b.combo = 0;
  b.alive = false;
}

function walls(ctx: Ctx, b: Ball): void {
  const { cols } = ctx.cfg.blocks.board;
  const r = b.radius;
  if (b.pos.x < r) {
    b.pos.x = r;
    if (b.vel.x < 0) {
      b.vel.x = -b.vel.x;
      bumpCombo(ctx, b, ctx.relic.ricochet);
      emit(ctx, { type: 'ball:bounce', ballId: b.id, pos: { x: 0, y: b.pos.y }, normal: { x: 1, y: 0 }, surface: 'wall', combo: b.combo });
    }
  } else if (b.pos.x > cols - r) {
    b.pos.x = cols - r;
    if (b.vel.x > 0) {
      b.vel.x = -b.vel.x;
      bumpCombo(ctx, b, ctx.relic.ricochet);
      emit(ctx, { type: 'ball:bounce', ballId: b.id, pos: { x: cols, y: b.pos.y }, normal: { x: -1, y: 0 }, surface: 'wall', combo: b.combo });
    }
  }
  if (b.pos.y < r) {
    b.pos.y = r;
    if (b.vel.y < 0) {
      b.vel.y = -b.vel.y;
      bumpCombo(ctx, b, ctx.relic.ricochet);
      emit(ctx, { type: 'ball:bounce', ballId: b.id, pos: { x: b.pos.x, y: 0 }, normal: { x: 0, y: 1 }, surface: 'wall', combo: b.combo });
    }
  }
}

function moveBall(ctx: Ctx, b: Ball, sec: number): void {
  const { cols, rows } = ctx.cfg.blocks.board;
  const px = b.pos.x;
  const py = b.pos.y;
  b.pos.x += b.vel.x * sec;
  b.pos.y += b.vel.y * sec;
  walls(ctx, b);
  collideBlocks(ctx, b, px, py);
  const r = b.radius;
  // garde-fous (la poussée hors d'un bloc ne doit jamais sortir du plateau)
  if (b.pos.x < r) b.pos.x = r;
  else if (b.pos.x > cols - r) b.pos.x = cols - r;
  if (b.pos.y < r) b.pos.y = r;
  if (b.vel.y > 0 && b.pos.y + r >= rows) groundBall(ctx, b);
  else if (b.pos.y > rows - r) b.pos.y = rows - r;
}

/** Un sous-pas physique de dtMs (≤ SUBSTEP_MS). */
export function physicsStep(ctx: Ctx, dtMs: number): void {
  const balls = ctx.s.balls;
  if (ctx.gridDirty) rebuildGrid(ctx);
  const sec = dtMs / 1000;
  const n = balls.length; // les balles nées d'une scission bougent au sous-pas suivant
  for (let i = 0; i < n; i++) {
    const b = balls[i] as Ball;
    if (!b.alive) continue;
    moveBall(ctx, b, sec);
    if (b.alive && ctx.s.drops.length > 0) collectTouched(ctx, b.pos.x, b.pos.y, b.radius);
  }
  if (ctx.blocksDied) compactBlocks(ctx);
  for (let i = balls.length - 1; i >= 0; i--) if (!(balls[i] as Ball).alive) releaseBall(ctx, i);
}
