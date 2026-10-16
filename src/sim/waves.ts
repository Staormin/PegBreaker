// sim/waves.ts — génération des rangées, avancée, franchissement, vagues.
import type { Block, BlockKind } from '../core/types';
import type { Ctx } from './ctx';
import { emit, isBreakable } from './ctx';
import { acquireBlock, releaseBlock } from './pools';
import { collectGroundDrops, shiftDrops } from './drops';
import { spawnBoss } from './boss';

export function rowsForWave(ctx: Ctx, wave: number): number {
  const w = ctx.cfg.waves;
  return Math.max(1, Math.min(w.rowsMax, Math.round(w.rowsBase + w.rowsPerWave * (wave - 1))));
}

export function isBossWave(ctx: Ctx, wave: number): boolean {
  const e = ctx.cfg.waves.bossEvery;
  return e > 0 && wave % e === 0 && ctx.cfg.waves.bosses.length > 0;
}

/**
 * PV de base d'une vague. Si `hpByWave` est présent (prioritaire) : interpolation linéaire entre les paliers,
 * prolongée géométriquement au-delà du dernier (même ratio que le dernier segment) ; sinon
 * baseHp × growthPerWave^(wave-1).
 */
export function waveBaseHp(ctx: Ctx, wave: number): number {
  const w = ctx.cfg.waves;
  const pts = w.hpByWave;
  if (!pts || pts.length === 0) return w.baseHp * Math.pow(w.growthPerWave, wave - 1);
  const first = pts[0]!;
  if (wave <= first.wave) return first.baseHp;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (wave <= p.wave) {
      const q = pts[i - 1]!;
      return q.baseHp + ((p.baseHp - q.baseHp) * (wave - q.wave)) / (p.wave - q.wave || 1);
    }
  }
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2];
  if (!prev || prev.baseHp <= 0) return last.baseHp;
  const perWave = Math.pow(last.baseHp / prev.baseHp, 1 / (last.wave - prev.wave || 1));
  return last.baseHp * Math.pow(perWave, wave - last.wave);
}

/** PV de base d'une rangée = waveBaseHp(wave) × (1 + growthPerShot × shot). */
export function rowBaseHp(ctx: Ctx, wave: number, shot: number): number {
  return waveBaseHp(ctx, wave) * (1 + ctx.cfg.waves.growthPerShot * shot);
}

/** PV d'un bloc : base × variance × hpRatio, arrondi, ≥ 1. */
export function rollBlockHp(ctx: Ctx, kind: BlockKind, shot: number): number {
  const v = ctx.cfg.waves.hpVariance;
  const ratio = ctx.blockDefs[kind]?.hpRatio ?? 1;
  return Math.max(1, Math.round(rowBaseHp(ctx, ctx.s.wave, shot) * ctx.rng.range(v.min, v.max) * ratio));
}

function interpWeight(pts: readonly { wave: number; weight: number }[], wave: number): number {
  let prev: { wave: number; weight: number } | undefined;
  for (const p of pts) {
    if (wave <= p.wave) {
      if (!prev) return p.weight;
      const t = (wave - prev.wave) / (p.wave - prev.wave || 1);
      return prev.weight + (p.weight - prev.weight) * t;
    }
    prev = p;
  }
  return prev ? prev.weight : 0;
}

export function densityAt(ctx: Ctx, wave: number): number {
  const pts = ctx.cfg.waves.densityByWave;
  let prev: { wave: number; blocks: number } | undefined;
  for (const p of pts) {
    if (wave <= p.wave) {
      if (!prev) return p.blocks;
      const t = (wave - prev.wave) / (p.wave - prev.wave || 1);
      return prev.blocks + (p.blocks - prev.blocks) * t;
    }
    prev = p;
  }
  return prev ? prev.blocks : 1;
}

function pickKind(ctx: Ctx, wave: number): BlockKind {
  let total = 0;
  for (const d of ctx.cfg.blocks.defs) if (d.kind !== 'boss') total += Math.max(0, interpWeight(d.weightByWave, wave));
  if (total <= 0) return 'normal';
  let r = ctx.rng.next() * total;
  for (const d of ctx.cfg.blocks.defs) {
    if (d.kind === 'boss') continue;
    r -= Math.max(0, interpWeight(d.weightByWave, wave));
    if (r < 0) return d.kind;
  }
  return 'normal';
}

/** Vrai si aucune partie d'un bloc n'occupe la cellule (col,row). */
export function cellFree(ctx: Ctx, col: number, row: number): boolean {
  for (const b of ctx.s.blocks) {
    if (b.row === row && col >= b.col && col < b.col + b.width && (b.kind === 'peg' || b.hp > 0)) return false;
  }
  return true;
}

/** Génère une rangée en `row` (cellules libres uniquement). Au moins un bloc cassable si la rangée n'est pas vide. */
export function generateRow(ctx: Ctx, row: number): void {
  const s = ctx.s;
  const cols = ctx.cfg.blocks.board.cols;
  const sc = ctx.scratch;
  let nFree = 0;
  for (let c = 0; c < cols; c++) if (cellFree(ctx, c, row)) sc[nFree++] = c;
  const dens = densityAt(ctx, s.wave);
  let count = Math.floor(dens);
  if (ctx.rng.chance(dens - count)) count++;
  count = Math.min(count, nFree);
  let breakable = 0;
  let first: Block | null = null;
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(ctx.rng.next() * (nFree - i));
    const col = sc[j] as number;
    sc[j] = sc[i] as number;
    sc[i] = col;
    const kind = pickKind(ctx, s.wave);
    const hp = kind === 'peg' ? 0 : rollBlockHp(ctx, kind, s.shotInWave);
    const b = acquireBlock(ctx, kind, col, row, 1, hp);
    if (kind !== 'peg') breakable++;
    if (!first) first = b;
  }
  if (first && breakable === 0) {
    first.kind = 'normal';
    first.hp = first.maxHp = rollBlockHp(ctx, 'normal', s.shotInWave);
  }
  s.rowsLeftInWave = Math.max(0, s.rowsLeftInWave - 1);
}

/** Démarre la vague s.wave : boss seul, ou les `startRows` premières rangées (0..n-1). */
export function startWave(ctx: Ctx): void {
  const s = ctx.s;
  s.shotInWave = 0;
  s.internal.damagedThisWave = false;
  if (s.internal.thawedIds) s.internal.thawedIds.length = 0;
  if (s.internal.embers) s.internal.embers.length = 0;
  s.rowsLeftInWave = rowsForWave(ctx, s.wave);
  if (isBossWave(ctx, s.wave)) {
    spawnBoss(ctx);
    s.rowsLeftInWave = 0;
    return;
  }
  const n = Math.min(ctx.startRows, s.rowsLeftInWave, ctx.cfg.blocks.board.rows - 2);
  for (let r = n - 1; r >= 0; r--) generateRow(ctx, r);
}

/** Descente d'une rangée : blocs non gelés (si la place est libre), dégel, franchissement. */
function shiftOnce(ctx: Ctx): void {
  const s = ctx.s;
  const board = ctx.cfg.blocks.board;
  const cols = board.cols;
  const occ = ctx.occ;
  occ.fill(0);
  const thawed = s.internal.thawedIds;
  s.blocks.sort(ctx.cmpBlocksRowDesc);
  for (const b of s.blocks) {
    let target = b.row;
    if (b.frozen) {
      b.frozen = false;
      thawed.push(b.id); // immunisé au gel pendant le tour suivant
    }
    else {
      const t = b.row + 1;
      let free = true;
      if (t <= board.rows) for (let c = b.col; c < b.col + b.width; c++) if (occ[t * cols + c]) free = false;
      if (free) target = t;
    }
    b.row = target;
    if (target <= board.rows) for (let c = b.col; c < b.col + b.width; c++) occ[target * cols + c] = 1;
  }
  shiftDrops(ctx, 1);
  // dernière rangée avant la ligne : un blindé perd son armure (toujours cassable)
  for (const b of s.blocks) {
    if (b.kind === 'armored' && b.row >= board.rows - 2) {
      b.kind = 'normal';
      b.armorSide = 'none';
    }
  }
  // franchissement de la ligne du joueur
  for (let i = s.blocks.length - 1; i >= 0; i--) {
    const b = s.blocks[i] as Block;
    if (b.row < board.rows - 1) continue;
    if (b.kind !== 'peg' && b.hp > 0) {
      // boss : dégâts de brèche dédiés (non plafonnés par breachDamageCap)
      const dmg = b.kind === 'boss' ? ctx.cfg.blocks.bossBreachDamage : Math.min(Math.ceil(b.hp), ctx.cfg.blocks.breachDamageCap);
      emit(ctx, { type: 'block:breached', blockId: b.id, kind: b.kind, damage: dmg });
      s.hp = Math.max(0, s.hp - dmg);
      s.internal.damagedThisWave = true;
      emit(ctx, { type: 'player:damaged', amount: dmg, hpLeft: s.hp });
    }
    releaseBlock(ctx, i);
  }
  ctx.gridDirty = true;
}

/** Fin de l'animation 'advancing' : descente (×2 avec le mod 'rush'), nouvelle rangée, drops au sol. */
export function advanceRows(ctx: Ctx): void {
  const s = ctx.s;
  const shifts = ctx.meta.runMods.includes('rush') ? 2 : 1;
  if (!s.internal.thawedIds) s.internal.thawedIds = []; // snapshot antérieur à T2d
  s.internal.thawedIds.length = 0;
  for (let k = 0; k < shifts; k++) shiftOnce(ctx);
  let newRow = false;
  if (s.rowsLeftInWave > 0) {
    generateRow(ctx, 0);
    newRow = true;
  }
  emit(ctx, { type: 'rows:advanced', wave: s.wave, newRow });
  collectGroundDrops(ctx);
}

export function waveCleared(ctx: Ctx): boolean {
  if (ctx.s.rowsLeftInWave > 0) return false;
  for (const b of ctx.s.blocks) if (isBreakable(b)) return false;
  return true;
}

export function clearBoard(ctx: Ctx): void {
  for (let i = ctx.s.blocks.length - 1; i >= 0; i--) releaseBlock(ctx, i);
}
