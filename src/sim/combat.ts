// sim/combat.ts — dégâts, combo, destruction, explosions, foudre, gel, scission.
import type { Ball, BallElement, Block } from '../core/types';
import type { Ctx } from './ctx';
import { ballDef, emit, isBreakable } from './ctx';
import { HP_EPS } from './constants';
import { bossDamage } from './boss';
import { maybeDrop } from './drops';
import { heal } from './rewards';
import { acquireBall } from './pools';

/** Dégâts d'impact d'une balle : base × tierMult^(tier-1) × (1 + k × combo) ; plomb : × mult, sans combo. */
export function ballDamage(ctx: Ctx, b: Ball): number {
  const bc = ctx.cfg.balls;
  const d = ballDef(ctx, b.element).baseDamage * Math.pow(bc.tierDamageMultiplier, b.tier - 1);
  if (b.element === 'lead') return d * bc.lead.damageMultiplier;
  return d * (1 + bc.comboDamagePerBounce * b.combo);
}

function centerX(b: Block): number {
  return b.col + b.width / 2;
}
function centerY(b: Block): number {
  return b.row + 0.5;
}

/** Inflige des dégâts au bloc d'index bi (ignore chevilles et blocs morts). */
export function damageBlock(ctx: Ctx, bi: number, amount: number, element: BallElement, combo: number, crit: boolean): void {
  const s = ctx.s;
  const blk = s.blocks[bi];
  if (!blk || !isBreakable(blk)) return;
  if (blk.kind === 'boss') amount = bossDamage(ctx, blk, amount, element);
  if (amount <= 0) return;
  blk.hp -= amount;
  if (blk.hp <= HP_EPS) blk.hp = 0;
  s.currentShotDamage += amount;
  s.stats.totalDamage += amount;
  emit(ctx, {
    type: 'block:hit',
    blockId: blk.id,
    pos: { x: centerX(blk), y: centerY(blk) },
    damage: amount,
    combo,
    element,
    hpLeft: blk.hp,
    crit,
  });
  if (blk.hp <= 0) destroyBlock(ctx, bi, element);
}

function destroyBlock(ctx: Ctx, bi: number, element: BallElement): void {
  const s = ctx.s;
  const blk = s.blocks[bi] as Block;
  const x = centerX(blk);
  const y = centerY(blk);
  ctx.blocksDied = true;
  s.stats.blocksDestroyed++;
  emit(ctx, { type: 'block:destroyed', blockId: blk.id, kind: blk.kind, pos: { x, y }, width: blk.width, element });
  if (blk.kind === 'boss') {
    s.stats.bossesKilled++;
    emit(ctx, { type: 'boss:killed', bossId: blk.bossId ?? '', pos: { x, y } });
  }
  maybeDrop(ctx, x, y);
  if (blk.kind === 'heart') heal(ctx, 1);
  else if (blk.kind === 'explosive') {
    const def = ctx.blockDefs.explosive;
    const radius = (def?.explosionRadius ?? 0) * ctx.relic.bigboom;
    const dmg = (def?.explosionDamageRatio ?? 0) * blk.maxHp;
    if (radius > 0 && dmg > 0) explode(ctx, x, y, radius, dmg, element, bi);
  }
}

/** Explosion : dégâts à tous les blocs cassables dont l'AABB intersecte le disque. */
export function explode(ctx: Ctx, x: number, y: number, radius: number, damage: number, element: BallElement, exclude: number): void {
  emit(ctx, { type: 'block:explode', pos: { x, y }, radius, damage });
  const blocks = ctx.s.blocks;
  const r2 = radius * radius;
  const n = blocks.length;
  for (let i = 0; i < n; i++) {
    if (i === exclude) continue;
    const b = blocks[i] as Block;
    if (!isBreakable(b)) continue;
    const qx = x < b.col ? b.col : x > b.col + b.width ? b.col + b.width : x;
    const qy = y < b.row ? b.row : y > b.row + 1 ? b.row + 1 : y;
    const dx = x - qx;
    const dy = y - qy;
    if (dx * dx + dy * dy < r2) damageBlock(ctx, i, damage, element, 0, false);
  }
}

/** Foudre : frappe le bloc cassable le plus proche (hors `exclude`) dans chainRange. */
function chainLightning(ctx: Ctx, x: number, y: number, exclude: number, damage: number): void {
  const blocks = ctx.s.blocks;
  const range = ctx.cfg.balls.lightning.chainRange;
  let best = -1;
  let bestD2 = range * range;
  for (let i = 0; i < blocks.length; i++) {
    if (i === exclude) continue;
    const b = blocks[i] as Block;
    if (!isBreakable(b)) continue;
    const dx = centerX(b) - x;
    const dy = centerY(b) - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  if (best < 0) return;
  const t = blocks[best] as Block;
  emit(ctx, { type: 'lightning:chain', from: { x, y }, to: { x: centerX(t), y: centerY(t) }, damage });
  damageBlock(ctx, best, damage, 'lightning', 0, false);
}

function bumpCombo(ctx: Ctx, b: Ball): void {
  if (b.element === 'lead') return;
  const prev = b.combo;
  b.combo++;
  const ms = ctx.cfg.balls.comboMilestones;
  for (let k = 0; k < 3; k++) {
    const m = ms[k] as number;
    if (prev < m && b.combo >= m) {
      emit(ctx, { type: 'combo:milestone', combo: b.combo, pos: { x: b.pos.x, y: b.pos.y }, level: (k + 1) as 1 | 2 | 3 });
    }
  }
  if (b.combo > ctx.s.currentShotCombo) ctx.s.currentShotCombo = b.combo;
}

function split(ctx: Ctx, b: Ball): void {
  const it = ctx.s.internal;
  b.triggered = true;
  if (it.splitsThisShot >= ctx.cfg.balls.split.maxSplitsPerShot) return;
  it.splitsThisShot++;
  const c = ctx.splitCos;
  const sn = ctx.splitSin;
  const vx = b.vel.x;
  const vy = b.vel.y;
  const nb = acquireBall(ctx);
  nb.element = b.element;
  nb.tier = b.tier;
  nb.combo = b.combo;
  nb.triggered = true;
  nb.radius = b.radius;
  nb.pos.x = b.pos.x;
  nb.pos.y = b.pos.y;
  nb.vel.x = vx * c + vy * sn;
  nb.vel.y = -vx * sn + vy * c;
  b.vel.x = vx * c - vy * sn;
  b.vel.y = vx * sn + vy * c;
  emit(ctx, { type: 'ball:split', pos: { x: b.pos.x, y: b.pos.y } });
}

/**
 * Impact d'une balle sur le bloc/cheville d'index bi au point (px,py), normale (nx,ny) (du bloc vers la balle).
 * `bounced` = faux pour une traversée fantôme.
 */
export function onImpact(ctx: Ctx, b: Ball, bi: number, px: number, py: number, nx: number, ny: number, bounced: boolean): void {
  const s = ctx.s;
  const blk = s.blocks[bi];
  if (!blk) return;
  const isPeg = blk.kind === 'peg';
  const dmg = ballDamage(ctx, b);
  if (!isPeg) {
    const crit = b.combo >= ctx.cfg.balls.comboMilestones[0];
    let amount = dmg;
    if (ctx.relic.firstblood && !s.internal.firstbloodUsed && blk.kind !== 'boss') {
      s.internal.firstbloodUsed = true;
      amount = Math.max(amount, blk.hp);
    } else if (blk.kind === 'armored' && blk.armorSide === 'down' && !(ny > 0.5)) {
      amount = 0; // blindé : seul le dessous est vulnérable → rebond simple
    }
    if (amount > 0) damageBlock(ctx, bi, amount, b.element, b.combo, crit);
    if (b.element === 'ice' && isBreakable(blk) && !blk.frozen) {
      blk.frozen = true;
      emit(ctx, { type: 'block:frozen', blockId: blk.id, pos: { x: centerX(blk), y: centerY(blk) } });
    }
  }
  if (b.element === 'lightning') chainLightning(ctx, px, py, bi, dmg * ctx.cfg.balls.lightning.damageRatio);
  else if (b.element === 'fire' && !b.triggered) {
    b.triggered = true;
    const f = ctx.cfg.balls.fire;
    explode(ctx, px, py, f.radius * ctx.relic.bigboom, dmg * f.damageRatio, 'fire', bi);
  } else if (b.element === 'split' && !b.triggered) split(ctx, b);
  bumpCombo(ctx, b);
  if (bounced) {
    emit(ctx, {
      type: 'ball:bounce',
      ballId: b.id,
      pos: { x: px, y: py },
      normal: { x: nx, y: ny },
      surface: isPeg ? 'peg' : 'block',
      combo: b.combo,
    });
  }
}
