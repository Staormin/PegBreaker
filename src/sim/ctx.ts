// sim/ctx.ts — contexte partagé par les modules de la sim (une instance par Sim).
import type {
  Ball,
  BallDef,
  BallElement,
  Block,
  BlockDef,
  BlockKind,
  Drop,
  GameConfig,
  GameEvent,
  MetaModifiers,
  VolleyBall,
} from '../core/types';
import type { Rng } from '../core/rng';
import type { SimState } from './state';
import { DEFAULT_SPLIT_ANGLE_DEG, DEFAULT_START_ROWS } from './constants';

export interface RelicFlags {
  /** combo de départ ajouté à chaque balle (0 = inactif) */
  bouncy: number;
  /** pièces par PV rendu (0 = inactif) */
  piggy: number;
  firstblood: boolean;
  /** multiplicateur de rayon d'explosion (1 = neutre) */
  bigboom: number;
  safetynet: boolean;
  magnet: boolean;
}

export interface Ctx {
  readonly cfg: GameConfig;
  readonly meta: MetaModifiers;
  readonly isDaily: boolean;
  readonly dailyDate: string | null;
  s: SimState;
  readonly rng: Rng;
  /** tableau d'événements réutilisé (renvoyé par step) */
  readonly events: GameEvent[];
  /** broad phase : index de bloc par cellule (-1 = vide) */
  readonly grid: Int32Array;
  gridDirty: boolean;
  /** un bloc est mort pendant le sous-pas : compacter le tableau */
  blocksDied: boolean;
  /** grille d'occupation temporaire (avancée des rangées) */
  readonly occ: Uint8Array;
  readonly spareBalls: Ball[];
  readonly spareDrops: Drop[];
  readonly spareBlocks: Block[];
  readonly scratch: number[];
  readonly ballDefs: Partial<Record<BallElement, BallDef>>;
  readonly stoneDef: BallDef;
  readonly elementOrder: Partial<Record<BallElement, number>>;
  readonly blockDefs: Partial<Record<BlockKind, BlockDef>>;
  readonly relic: RelicFlags;
  readonly sinMinAngle: number;
  readonly cosMinAngle: number;
  readonly splitCos: number;
  readonly splitSin: number;
  readonly startRows: number;
  readonly cmpVolley: (a: VolleyBall, b: VolleyBall) => number;
  readonly cmpBlocksRowDesc: (a: Block, b: Block) => number;
}

/** Clés ajoutées aux JSON (non typées dans core/types.ts, demande d'ajout faite). */
interface BallsExtra {
  split: { angleDeg?: number };
}
interface WavesExtra {
  startRows?: number;
}

export function createCtx(cfg: GameConfig, meta: MetaModifiers, rng: Rng, isDaily: boolean, dailyDate: string | null): Ctx {
  const board = cfg.blocks.board;
  const ballDefs: Partial<Record<BallElement, BallDef>> = {};
  const elementOrder: Partial<Record<BallElement, number>> = {};
  cfg.balls.defs.forEach((d, i) => {
    ballDefs[d.id] = d;
    elementOrder[d.id] = i;
  });
  const stoneDef = ballDefs.stone;
  if (!stoneDef) throw new Error('sim : balle "stone" absente de la config');
  const blockDefs: Partial<Record<BlockKind, BlockDef>> = {};
  for (const d of cfg.blocks.defs) blockDefs[d.kind] = d;
  const minA = (board.minAimAngleDeg * Math.PI) / 180;
  const splitDeg = (cfg.balls as unknown as BallsExtra).split.angleDeg ?? DEFAULT_SPLIT_ANGLE_DEG;
  const splitA = (splitDeg * Math.PI) / 180;
  const startRows = (cfg.waves as unknown as WavesExtra).startRows;
  const cells = board.cols * board.rows;
  return {
    cfg,
    meta,
    isDaily,
    dailyDate,
    s: undefined as unknown as SimState,
    rng,
    events: [],
    grid: new Int32Array(cells).fill(-1),
    gridDirty: true,
    blocksDied: false,
    occ: new Uint8Array(board.cols * (board.rows + 2)),
    spareBalls: [],
    spareDrops: [],
    spareBlocks: [],
    scratch: new Array<number>(Math.max(board.cols, 8)).fill(0),
    ballDefs,
    stoneDef,
    elementOrder,
    blockDefs,
    relic: { bouncy: 0, piggy: 0, firstblood: false, bigboom: 1, safetynet: false, magnet: false },
    sinMinAngle: Math.sin(minA),
    cosMinAngle: Math.cos(minA),
    splitCos: Math.cos(splitA),
    splitSin: Math.sin(splitA),
    startRows: typeof startRows === 'number' ? startRows : DEFAULT_START_ROWS,
    cmpVolley: (a, b) =>
      (elementOrder[a.element] ?? 99) - (elementOrder[b.element] ?? 99) || a.tier - b.tier,
    cmpBlocksRowDesc: (a, b) => b.row - a.row || a.col - b.col,
  };
}

export function emit(ctx: Ctx, e: GameEvent): void {
  ctx.events.push(e);
}

export function newId(ctx: Ctx): number {
  return ctx.s.internal.nextId++;
}

export function ballDef(ctx: Ctx, el: BallElement): BallDef {
  return ctx.ballDefs[el] ?? ctx.stoneDef;
}

/** Un bloc est mort (détruit, en attente de compaction) ; une cheville ne meurt jamais. */
export function isDead(b: Block): boolean {
  return b.kind !== 'peg' && b.hp <= 0;
}

export function isBreakable(b: Block): boolean {
  return b.kind !== 'peg' && b.hp > 0;
}
