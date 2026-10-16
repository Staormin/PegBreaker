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
  const r = ctx.relic;
  let d = ballDef(ctx, b.element).baseDamage * Math.pow(bc.tierDamageMultiplier, b.tier - 1);
  if (b.tier >= 2 && r.catalyst > 0) d *= 1 + r.catalyst;
  if (r.berserk > 0) d *= 1 + r.berserk * Math.max(0, ctx.s.maxHp - ctx.s.hp);
  if (b.element === 'lead') return d * bc.lead.damageMultiplier;
  // plafond doux : au-delà de comboSoftCap, chaque rebond n'ajoute plus que comboDamagePerBounceAfterCap
  const cap = bc.comboSoftCap;
  const below = Math.min(b.combo, cap);
  const above = Math.max(0, b.combo - cap);
  return d * (1 + bc.comboDamagePerBounce * below + bc.comboDamagePerBounceAfterCap * above);
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
  if (blk.kind === 'boss') {
    const full = amount;
    amount = bossDamage(ctx, blk, amount, element);
    if (amount < full) crit = false; // absorb : coup réduit, jamais critique (retour visuel)
  }
  if (blk.frozen) amount *= ctx.relic.frozenMult;
  if (amount <= 0) return;
  // dégâts entiers (≥ 1) : PV des blocs et stats restent entiers
  amount = Math.max(1, Math.round(amount));
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
  if (blk.kind === 'heart') heal(ctx, ctx.relic.heartHeal);
  else if (blk.kind === 'explosive') {
    const def = ctx.blockDefs.explosive;
    const radius = (def?.explosionRadius ?? 0) * ctx.relic.bigboom;
    const dmg = (def?.explosionDamageRatio ?? 0) * blk.maxHp;
    if (radius > 0 && dmg > 0) explode(ctx, x, y, radius, dmg, element, bi, false);
  }
}

/** Explosion : dégâts à tous les blocs cassables dont l'AABB intersecte le disque. */
export function explode(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  damage: number,
  element: BallElement,
  exclude: number,
  ember: boolean,
): void {
  const embers = ctx.s.internal.embers;
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
    if (dx * dx + dy * dy < r2) {
      damageBlock(ctx, i, damage, element, 0, false);
      if (ember && b.kind !== 'boss' && isBreakable(b) && !embers.includes(b.id)) embers.push(b.id);
    }
  }
}

/** Pyromane : les blocs marqués brûlent (part de leurs PV max) au début du tir suivant. */
export function burnEmbers(ctx: Ctx): void {
  const it = ctx.s.internal;
  if (!it.embers) it.embers = [];
  const ratio = ctx.relic.emberRatio;
  if (ratio > 0) {
    for (const id of it.embers) {
      const i = ctx.s.blocks.findIndex((b) => b.id === id);
      const b = ctx.s.blocks[i];
      if (b && isBreakable(b)) damageBlock(ctx, i, ratio * b.maxHp, 'fire', 0, false);
    }
  }
  it.embers.length = 0;
}

/**
 * Foudre : frappe le bloc cassable le plus proche (hors `exclude`) dans chainRange, puis, avec paratonnerre,
 * rebondit de bloc en bloc (lightningChains sauts, chaque bloc une seule fois).
 */
function chainLightning(ctx: Ctx, x: number, y: number, exclude: number, damage: number): void {
  const blocks = ctx.s.blocks;
  const range = ctx.cfg.balls.lightning.chainRange;
  const hit = ctx.scratch;
  const hops = Math.min(ctx.relic.lightningChains, hit.length);
  let nHit = 0;
  let fx = x;
  let fy = y;
  for (let hop = 0; hop < hops; hop++) {
    let best = -1;
    let bestD2 = range * range;
    for (let i = 0; i < blocks.length; i++) {
      if (i === exclude) continue;
      let seen = false;
      for (let k = 0; k < nHit; k++) if (hit[k] === i) seen = true;
      if (seen) continue;
      const b = blocks[i] as Block;
      if (!isBreakable(b)) continue;
      const dx = centerX(b) - fx;
      const dy = centerY(b) - fy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best < 0) return;
    const t = blocks[best] as Block;
    const tx = centerX(t);
    const ty = centerY(t);
    emit(ctx, { type: 'lightning:chain', from: { x: fx, y: fy }, to: { x: tx, y: ty }, damage });
    damageBlock(ctx, best, damage, 'lightning', 0, false);
    hit[nHit++] = best;
    fx = tx;
    fy = ty;
  }
}

export function bumpCombo(ctx: Ctx, b: Ball, n = 1): void {
  if (b.element === 'lead' || n <= 0) return;
  const prev = b.combo;
  b.combo += n;
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
  const vx = b.vel.x;
  const vy = b.vel.y;
  const parts = Math.max(2, ctx.relic.splitParts);
  // angles répartis de +θ à −θ ; la balle d'origine prend +θ (k = 0)
  for (let k = parts - 1; k >= 0; k--) {
    let c: number;
    let sn: number;
    const f = 1 - (2 * k) / (parts - 1);
    if (f === 1 || f === -1) {
      c = ctx.splitCos;
      sn = f * ctx.splitSin;
    } else {
      const a = f * Math.atan2(ctx.splitSin, ctx.splitCos);
      c = Math.cos(a);
      sn = Math.sin(a);
    }
    const nb = k === 0 ? b : acquireBall(ctx);
    if (nb !== b) {
      nb.element = b.element;
      nb.tier = b.tier;
      nb.combo = b.combo;
      nb.triggered = true;
      nb.radius = b.radius;
      nb.pos.x = b.pos.x;
      nb.pos.y = b.pos.y;
    }
    nb.vel.x = vx * c - vy * sn;
    nb.vel.y = vx * sn + vy * c;
  }
  emit(ctx, { type: 'ball:split', pos: { x: b.pos.x, y: b.pos.y } });
}

/** Rangée la plus basse occupée par un bloc cassable (radar). */
function lowestRow(ctx: Ctx): number {
  let r = -1;
  for (const b of ctx.s.blocks) if (isBreakable(b) && b.row > r) r = b.row;
  return r;
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
    if (ctx.relic.radar !== 1) {
      const used = s.internal.radarUsed ?? (s.internal.radarUsed = []);
      if (!used.includes(b.id)) {
        used.push(b.id);
        if (amount > 0 && blk.row === lowestRow(ctx)) amount *= ctx.relic.radar;
      }
    }
    if (amount > 0) damageBlock(ctx, bi, amount, b.element, b.combo, crit);
    const thawed = s.internal.thawedIds;
    // glace : gèle seulement au premier impact de la balle, au plus maxFrozenPerShot blocs par tir
    if (b.element === 'ice' && !b.triggered) {
      b.triggered = true;
      const it = s.internal;
      if (
        isBreakable(blk) &&
        !blk.frozen &&
        !(thawed && thawed.includes(blk.id)) &&
        (it.frozenThisShot ?? 0) < ctx.cfg.balls.ice.maxFrozenPerShot
      ) {
        it.frozenThisShot = (it.frozenThisShot ?? 0) + 1;
        blk.frozen = true;
        emit(ctx, { type: 'block:frozen', blockId: blk.id, pos: { x: centerX(blk), y: centerY(blk) } });
      }
    }
  }
  if (b.element === 'ice') b.triggered = true; // une cheville consomme aussi le premier impact
  if (b.element === 'lightning') chainLightning(ctx, px, py, bi, dmg * ctx.cfg.balls.lightning.damageRatio);
  else if (b.element === 'fire' && !b.triggered) {
    b.triggered = true;
    const f = ctx.cfg.balls.fire;
    explode(ctx, px, py, f.radius * ctx.relic.bigboom * ctx.relic.pyroRadius, dmg * f.damageRatio, 'fire', bi, ctx.relic.emberRatio > 0);
  } else if (b.element === 'split' && !b.triggered) split(ctx, b);
  else if (b.element === 'lead' && ctx.relic.anvilRatio > 0 && ctx.relic.anvilRadius > 0) {
    explode(ctx, px, py, ctx.relic.anvilRadius * ctx.relic.bigboom, dmg * ctx.relic.anvilRatio, 'lead', bi, false);
  }
  bumpCombo(ctx, b, !bounced ? ctx.relic.ghostCombo : isPeg ? ctx.relic.pegCombo : 1);
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
