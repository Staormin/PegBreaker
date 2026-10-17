// sim/combat.ts — dégâts, combo, destruction, explosions, chaîne de foudre. Les mécaniques propres à chaque
// élément vivent dans sim/elements (registre de hooks).
import type { Ball, BallElement, Block } from '../core/types';
import type { Ctx } from './ctx';
import { ballDef, emit, isBreakable } from './ctx';
import { HP_EPS } from './constants';
import { bossDamage } from './boss';
import { maybeDrop } from './drops';
import { fxOf } from './pools';
import { contractMax, contractOnKill } from './contracts';
import type { BallFx } from './state';
import { elementHooks, elementsBlockDestroyed, hooksOf } from './elements/index';
import { heal } from './rewards';

/**
 * Dégâts d'impact d'une balle : base × tierMult^(tier-1) × (1 + k × combo) × fx.dmgMult, puis le hook
 * modifyDamage de l'élément (plomb : × mult, géante, or, cristal, vide, chance, perforante, rouille).
 * `target` = bloc frappé (null pour un effet dérivé : bombe, prisme, nova). Dorée : × goldenMult.
 */
export function ballDamage(ctx: Ctx, b: Ball, target: Block | null = null, fx: BallFx = fxOf(ctx, b)): number {
  const bc = ctx.cfg.balls;
  const r = ctx.relic;
  let d = ballDef(ctx, b.element).baseDamage * Math.pow(bc.tierDamageMultiplier, b.tier - 1);
  if (b.tier >= 2 && r.catalyst > 0) d *= 1 + r.catalyst;
  if (r.berserk > 0) d *= 1 + r.berserk * Math.max(0, ctx.s.maxHp - ctx.s.hp);
  // éventail (figé au tir) et dorée : s'appliquent aussi aux effets dérivés (explosion, foudre, enclume)
  const it = ctx.s.internal;
  d *= it.shotDamageMult ?? 1;
  if (b.golden) d *= it.goldenMult ?? bc.lastBallMultiplier;
  const H = hooksOf(b, fx);
  if (!H.noCombo) {
    // plafond doux : au-delà de comboSoftCap, chaque rebond n'ajoute plus que comboDamagePerBounceAfterCap
    const cap = bc.comboSoftCap;
    const below = Math.min(b.combo, cap);
    const above = Math.max(0, b.combo - cap);
    d = d * (1 + bc.comboDamagePerBounce * below + bc.comboDamagePerBounceAfterCap * above);
  }
  if (fx.dmgMult !== 1) d *= fx.dmgMult;
  return H.modifyDamage ? H.modifyDamage(ctx, b, fx, d, target) : d;
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
    ballId: ctx.curBallId,
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
  contractOnKill(ctx, element);
  if (blk.kind === 'boss') {
    s.internal.bossKilledThisWave = true;
    s.stats.bossesKilled++;
    emit(ctx, { type: 'boss:killed', bossId: blk.bossId ?? '', pos: { x, y } });
  }
  // hook de la balle responsable (or : pièces garanties ; vampire : soin)
  const cb = ctx.curBall;
  let handled = false;
  if (cb) {
    const cf = ctx.curFx ?? ctx.nullFx;
    const H = hooksOf(cb, cf);
    if (H.onBlockDestroyed) handled = H.onBlockDestroyed(ctx, cb, cf, blk, x, y);
  }
  if (!handled) maybeDrop(ctx, x, y, 0);
  elementsBlockDestroyed(ctx, blk, x, y); // peste : contamination à la mort d'un bloc rongé
  if (blk.kind === 'heart') heal(ctx, ctx.relic.heartHeal, 'heart', x, y);
  else if (blk.kind === 'explosive') {
    const def = ctx.blockDefs.explosive;
    const radius = (def?.explosionRadius ?? 0) * ctx.relic.bigboom;
    const dmg = (def?.explosionDamageRatio ?? 0) * blk.maxHp;
    if (radius > 0 && dmg > 0) explode(ctx, x, y, radius, dmg, element, bi, false, 'explosive');
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
  source: BallElement | 'explosive' = element,
): void {
  const embers = ctx.s.internal.embers;
  emit(ctx, { type: 'block:explode', pos: { x, y }, radius, damage, element: source });
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
export function chainLightning(ctx: Ctx, x: number, y: number, exclude: number, damage: number): void {
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
    emit(ctx, { type: 'lightning:chain', from: { x: fx, y: fy }, to: { x: tx, y: ty }, damage, element: 'lightning' });
    damageBlock(ctx, best, damage, 'lightning', 0, false);
    hit[nHit++] = best;
    fx = tx;
    fy = ty;
  }
}

export function bumpCombo(ctx: Ctx, b: Ball, n = 1, fx?: BallFx): void {
  if (n <= 0 || elementHooks(b.element).noCombo) return;
  const prev = b.combo;
  b.combo += n;
  const ms = ctx.cfg.balls.comboMilestones;
  for (let k = 0; k < 3; k++) {
    const m = ms[k] as number;
    if (prev < m && b.combo >= m) {
      emit(ctx, { type: 'combo:milestone', combo: b.combo, pos: { x: b.pos.x, y: b.pos.y }, level: (k + 1) as 1 | 2 | 3 });
      if (elementHooks(b.element).onComboMilestone) {
        const f = fx ?? fxOf(ctx, b);
        hooksOf(b, f).onComboMilestone?.(ctx, b, f, (k + 1) as 1 | 2 | 3, b.combo);
      }
    }
  }
  if (b.combo > ctx.s.currentShotCombo) ctx.s.currentShotCombo = b.combo;
  contractMax(ctx, 'reachCombo', b.combo);
}

/** Rangée la plus basse occupée par un bloc cassable (radar). */
function lowestRow(ctx: Ctx): number {
  let r = -1;
  for (const b of ctx.s.blocks) if (isBreakable(b) && b.row > r) r = b.row;
  return r;
}

/**
 * Impact d'une balle sur le bloc/cheville d'index bi au point (px,py), normale (nx,ny) (du bloc vers la balle).
 * `bounced` = faux pour une traversée (fantôme, perforante, copie d'écho, boomerang au retour).
 * Les effets d'élément passent par le registre sim/elements (modifyDamage, onBlockHit, onBounce).
 */
export function onImpact(
  ctx: Ctx,
  b: Ball,
  bi: number,
  px: number,
  py: number,
  nx: number,
  ny: number,
  bounced: boolean,
  fx: BallFx = fxOf(ctx, b),
): void {
  const s = ctx.s;
  const blk = s.blocks[bi];
  if (!blk) return;
  const isPeg = blk.kind === 'peg';
  const H = hooksOf(b, fx);
  const hit = ctx.hit;
  hit.bounced = bounced;
  hit.crit = false;
  hit.ignoreArmor = false;
  const dmg = ballDamage(ctx, b, isPeg ? null : blk, fx);
  ctx.curBallId = b.id; // dégâts directs et indirects (explosion, foudre, enclume) attribués à cette balle
  ctx.curGolden = b.golden; // casses de cet impact (et de ses effets) attribuées à la dorée
  ctx.curBall = b;
  ctx.curFx = fx;
  if (!isPeg) {
    const crit = b.combo >= ctx.cfg.balls.comboMilestones[0] || hit.crit;
    let amount = dmg;
    if (ctx.relic.firstblood && !s.internal.firstbloodUsed && blk.kind !== 'boss') {
      s.internal.firstbloodUsed = true;
      amount = Math.max(amount, blk.hp);
    } else if (blk.kind === 'armored' && blk.armorSide === 'down' && !(ny > 0.5) && !hit.ignoreArmor) {
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
  }
  if (H.onBlockHit) H.onBlockHit(ctx, b, fx, bi, blk, px, py, dmg, isPeg);
  bumpCombo(ctx, b, !bounced ? (H.passThrough ? ctx.relic.ghostCombo * (H.traverseCombo ?? 1) : 1) : isPeg ? ctx.relic.pegCombo : 1, fx);
  if (bounced) {
    emit(ctx, {
      type: 'ball:bounce',
      ballId: b.id,
      pos: { x: px, y: py },
      normal: { x: nx, y: ny },
      surface: isPeg ? 'peg' : 'block',
      combo: b.combo,
    });
    if (H.onBounce && b.alive) H.onBounce(ctx, b, fx, isPeg ? 'peg' : 'block', nx, ny, bi);
  }
  ctx.curGolden = false;
  ctx.curBallId = -1;
  ctx.curBall = null;
  ctx.curFx = null;
}
