// sim/index.ts — createSim(config, options): Sim. Simulation pure et déterministe.
// Note J1 : les objets d'événements (et leurs Vec2) sont alloués à l'émission ; le tableau
// renvoyé par step() est réutilisé. Balles, drops et blocs sont poolés.
import type { BallElement, GameConfig, GameEvent, MetaModifiers, RunSnapshot, Sim, SimOptions, Vec2 } from '../core/types';
import { createRng } from '../core/rng';
import { createCtx } from './ctx';
import { createInternal, type SimState } from './state';
import { SUBSTEP_MS, STEP_EPS } from './constants';
import { chooseReward, fire, giveUp, leaveShop, recall, revive, skipReward, startRun, tick } from './machine';
import { contractSeed } from './contracts';
import { buy, reroll } from './shop';
import { clampAim, preview } from './aim';
import { refreshRelics } from './relics';
import { syncFx } from './pools';
import { validateElementParams } from './elements/index';

export { fuseVolley } from './volley';

function maxId(s: RunSnapshot): number {
  let m = 0;
  for (const b of s.balls) m = Math.max(m, b.id);
  for (const b of s.blocks) m = Math.max(m, b.id);
  for (const d of s.drops) m = Math.max(m, d.id);
  return m;
}

/** Modificateurs neutres (aucune méta) : utile avant que systems/ ne fournisse les siens. */
export function defaultMeta(config: GameConfig): MetaModifiers {
  return {
    bonusHp: 0,
    bonusStartBalls: 0,
    coinMultiplier: 1,
    fragmentMultiplier: 1,
    freeRerolls: 0,
    unlockedElements: ['stone', 'fire', 'lightning', 'split'] satisfies BallElement[],
    unlockedRelics: config.relics.defs.map((d) => d.id),
    runMods: [],
  };
}

export function createSim(config: GameConfig, options: SimOptions): Sim {
  validateElementParams(config); // erreur explicite si un paramètre de mécanique manque dans balls.json
  const rng = createRng(options.seed);
  const ctx = createCtx(config, options.meta, rng, options.isDaily ?? false, options.dailyDate ?? null);
  const events = ctx.events;
  let returned = 0;

  const sync = (): void => {
    ctx.s.rngState = rng.getState();
  };

  if (options.snapshot) {
    const s = structuredClone(options.snapshot) as SimState;
    if (!s.internal) s.internal = createInternal(maxId(s) + 1);
    // snapshots antérieurs au lot 1 : champs ajoutés
    const defaults = createInternal(0);
    for (const k of Object.keys(defaults) as (keyof typeof defaults)[]) {
      if (s.internal[k] === undefined) (s.internal as unknown as Record<string, unknown>)[k] = defaults[k];
    }
    if (s.internal.contractRng === defaults.contractRng && s.contract === undefined) s.internal.contractRng = contractSeed(s.seed);
    s.aimSpread ??= 0;
    s.contract ??= null;
    s.revivesUsed ??= 0;
    s.stats.contractsCompleted ??= 0;
    for (const b of s.balls) b.golden ??= false;
    ctx.s = s;
    syncFx(ctx); // snapshot antérieur aux 27 balles : effets neutres
    rng.setState(s.rngState);
    refreshRelics(ctx);
    ctx.gridDirty = true;
  } else {
    startRun(ctx, options.seed, 0);
  }
  sync();

  const sim: Sim = {
    get state() {
      return ctx.s;
    },
    config,
    step(dtMs: number): readonly GameEvent[] {
      // vide les événements déjà rendus ; conserve ceux émis par des actions depuis
      if (returned > 0) {
        events.copyWithin(0, returned);
        events.length -= returned;
      }
      const it = ctx.s.internal;
      if (Number.isFinite(dtMs) && dtMs > 0) it.acc += dtMs;
      while (it.acc >= SUBSTEP_MS - STEP_EPS) {
        it.acc -= SUBSTEP_MS;
        tick(ctx, SUBSTEP_MS);
        if (ctx.s.phase === 'gameover') {
          it.acc = 0;
          break;
        }
      }
      if (it.acc < 0) it.acc = 0;
      sync();
      returned = events.length;
      return events;
    },
    aim(dir: Vec2, spread?: number): void {
      if (ctx.s.phase === 'gameover') return;
      ctx.s.aimDir = clampAim(ctx, dir);
      if (spread !== undefined && Number.isFinite(spread)) ctx.s.aimSpread = Math.min(1, Math.max(0, spread));
    },
    cancelAim(): void {
      ctx.s.aimDir = null;
    },
    fire(): void {
      fire(ctx);
      sync();
    },
    recall(): void {
      recall(ctx);
    },
    chooseReward(index: number): void {
      chooseReward(ctx, index);
      sync();
    },
    skipReward(): void {
      skipReward(ctx);
      sync();
    },
    buy(index: number): void {
      buy(ctx, index);
      sync();
    },
    reroll(): void {
      reroll(ctx);
      sync();
    },
    leaveShop(): void {
      leaveShop(ctx);
      sync();
    },
    revive(): boolean {
      const ok = revive(ctx);
      sync();
      return ok;
    },
    giveUp(): void {
      giveUp(ctx);
    },
    restart(seed?: string): void {
      giveUp(ctx); // depuis gameover : run:over d'abord (si pas déjà émis) pour que la méta crédite la run
      const restarts = ctx.s.internal.restarts + 1;
      const next = seed ?? `${ctx.s.seed}#${restarts}`;
      startRun(ctx, next, restarts);
      sync();
    },
    preview(dir: Vec2): Vec2[] {
      return preview(ctx, dir);
    },
    snapshot(): RunSnapshot {
      sync();
      return structuredClone(ctx.s);
    },
  };
  return sim;
}
