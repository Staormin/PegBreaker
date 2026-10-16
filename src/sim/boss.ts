// sim/boss.ts — apparition et comportements des boss (waves.json → bosses).
import type { BallElement, Block, BossDef } from '../core/types';
import type { Ctx } from './ctx';
import { emit, isBreakable } from './ctx';
import { acquireBlock } from './pools';
import { rowBaseHp, rollBlockHp, cellFree } from './waves';

export function bossDef(ctx: Ctx, id: string | null): BossDef | undefined {
  if (id === null) return undefined;
  for (const d of ctx.cfg.waves.bosses) if (d.id === id) return d;
  return undefined;
}

/** Boss de la vague : rotation dans l'ordre de waves.json (vague 5 → 1er, 10 → 2e, ...). */
export function spawnBoss(ctx: Ctx): void {
  const w = ctx.cfg.waves;
  const s = ctx.s;
  if (w.bosses.length === 0) return;
  const idx = (Math.max(1, Math.floor(s.wave / w.bossEvery)) - 1) % w.bosses.length;
  const def = w.bosses[idx] as BossDef;
  const cols = ctx.cfg.blocks.board.cols;
  const width = Math.min(def.width, cols);
  const col = Math.floor((cols - width) / 2);
  const hp = Math.max(1, Math.round(rowBaseHp(ctx, s.wave, 0) * def.hpMultiplier * ctx.mods.blockHpMult));
  const b = acquireBlock(ctx, 'boss', col, 0, width, hp);
  b.bossId = def.id;
  emit(ctx, { type: 'boss:spawned', bossId: def.id, blockId: b.id });
}

/** Modifie les dégâts reçus par un boss ('absorb'). */
export function bossDamage(ctx: Ctx, blk: Block, amount: number, element: BallElement): number {
  const def = bossDef(ctx, blk.bossId);
  if (!def || def.behavior !== 'absorb') return amount;
  const it = ctx.s.internal;
  if (it.absorbElement === null) it.absorbElement = element;
  return element === it.absorbElement ? amount * def.param : amount;
}

/** Fin de tir (avant l'avancée) : régénération. */
export function bossOnShotEnd(ctx: Ctx): void {
  for (const b of ctx.s.blocks) {
    if (b.kind !== 'boss' || !isBreakable(b)) continue;
    const def = bossDef(ctx, b.bossId);
    if (def?.behavior === 'regen') b.hp = Math.min(b.maxHp, b.hp + Math.round(def.param * b.maxHp));
  }
}

/** Après l'avancée : la ruche pond `param` blocs normaux dans la rangée sous elle. */
export function bossAfterAdvance(ctx: Ctx): void {
  const board = ctx.cfg.blocks.board;
  const blocks = ctx.s.blocks;
  const n = blocks.length;
  for (let k = 0; k < n; k++) {
    const b = blocks[k] as Block;
    if (b.kind !== 'boss' || !isBreakable(b)) continue;
    const def = bossDef(ctx, b.bossId);
    if (def?.behavior !== 'spawner') continue;
    const row = b.row + 1;
    if (row >= board.rows - 1) continue;
    const sc = ctx.scratch;
    let nFree = 0;
    for (let c = 0; c < board.cols; c++) if (cellFree(ctx, c, row)) sc[nFree++] = c;
    const count = Math.min(nFree, Math.max(0, Math.round(def.param)));
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(ctx.rng.next() * (nFree - i));
      const col = sc[j] as number;
      sc[j] = sc[i] as number;
      sc[i] = col;
      acquireBlock(ctx, 'normal', col, row, 1, rollBlockHp(ctx, 'normal', ctx.s.shotInWave));
    }
  }
}
