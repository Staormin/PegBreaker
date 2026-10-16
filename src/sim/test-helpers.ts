// sim/test-helpers.ts — utilitaires partagés par les tests Vitest de la sim (non importé par le jeu).
import type { Block, BlockKind, GameConfig, GameEvent, MetaModifiers, Sim, Vec2, VolleyBall } from '../core/types';
import { loadConfig } from '../core/config';
import { createRng, type Rng } from '../core/rng';
import { createSim, defaultMeta } from './index';
import type { SimState } from './state';

export const FRAME = 1000 / 60;

export function config(): GameConfig {
  return structuredClone(loadConfig());
}

export function meta(cfg: GameConfig, over: Partial<MetaModifiers> = {}): MetaModifiers {
  return { ...defaultMeta(cfg), ...over };
}

export function newSim(seed = 'test', cfg: GameConfig = config(), over: Partial<MetaModifiers> = {}): Sim {
  return createSim(cfg, { seed, meta: meta(cfg, over) });
}

/** Accès mutable à l'état (scénarios de test). */
export function mut(sim: Sim): SimState {
  return sim.state as SimState;
}

export function block(sim: Sim, kind: BlockKind, col: number, row: number, hp: number, width = 1): Block {
  const s = mut(sim);
  return {
    id: s.internal.nextId++,
    kind,
    col,
    row,
    width,
    hp: kind === 'peg' ? 0 : hp,
    maxHp: kind === 'peg' ? 0 : hp,
    frozen: false,
    armorSide: kind === 'armored' ? 'down' : 'none',
    bossId: null,
  };
}

/** Plateau de test : remplace blocs/drops/volée, rowsLeftInWave > 0 par défaut (pas de fin de vague). */
export function setup(sim: Sim, blocks: Block[], volley: VolleyBall[], opts: { rowsLeft?: number; launchX?: number } = {}): void {
  const s = mut(sim);
  s.blocks = blocks;
  s.drops = [];
  s.volley = volley;
  s.rowsLeftInWave = opts.rowsLeft ?? 0;
  if (opts.launchX !== undefined) s.launchPos.x = opts.launchX;
  sim.step(0); // purge des événements de démarrage
}

/** Vise, tire et avance jusqu'à la fin du tir (phase hors firing/advancing). Renvoie une copie des événements. */
export function shoot(sim: Sim, dir: Vec2, maxFrames = 5000): GameEvent[] {
  const out: GameEvent[] = [];
  sim.aim(dir);
  sim.fire();
  for (let f = 0; f < maxFrames; f++) {
    for (const e of sim.step(FRAME)) out.push(e);
    const p = sim.state.phase;
    if (p !== 'firing' && p !== 'advancing') break;
  }
  return out;
}

export function ofType<T extends GameEvent['type']>(evs: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Termine récompense/boutique : option 0, quitte la boutique. */
export function settle(sim: Sim, out?: GameEvent[]): void {
  for (let guard = 0; guard < 10; guard++) {
    if (sim.state.phase === 'reward') sim.chooseReward(0);
    else if (sim.state.phase === 'shop') sim.leaveShop();
    else break;
    const evs = sim.step(0);
    if (out) for (const e of evs) out.push(e);
  }
}

export function randomDir(rng: Rng): Vec2 {
  return { x: rng.range(-1, 1), y: -rng.range(0.05, 1) };
}

/** Bot « vise le bloc cassable le plus bas » (le plus proche en x à égalité). */
export function lowestBlockDir(sim: Sim): Vec2 {
  const s = sim.state;
  let best: Block | null = null;
  for (const b of s.blocks) {
    if (b.kind === 'peg' || b.hp <= 0) continue;
    if (
      !best ||
      b.row > best.row ||
      (b.row === best.row && Math.abs(b.col + b.width / 2 - s.launchPos.x) < Math.abs(best.col + best.width / 2 - s.launchPos.x))
    )
      best = b;
  }
  if (!best) return { x: 0, y: -1 };
  return { x: best.col + best.width / 2 - s.launchPos.x, y: best.row + 0.5 - s.launchPos.y };
}

export interface BotRun {
  shots: number;
  deathWave: number;
  dmgByWave: Map<number, number[]>;
}

/** Joue une run complète (ou maxShots tirs) avec une politique de visée. */
export function playRun(sim: Sim, policy: (sim: Sim) => Vec2, maxShots = 400): BotRun {
  const dmgByWave = new Map<number, number[]>();
  let shots = 0;
  while (shots < maxShots && sim.state.phase !== 'gameover') {
    settle(sim);
    if (sim.state.phase !== 'aiming') break;
    const wave = sim.state.wave;
    const evs = shoot(sim, policy(sim));
    shots++;
    for (const e of evs) {
      if (e.type === 'volley:end') {
        const arr = dmgByWave.get(wave) ?? [];
        arr.push(e.shotDamage);
        dmgByWave.set(wave, arr);
      }
    }
  }
  return { shots, deathWave: sim.state.wave, dmgByWave };
}

export { createRng };
