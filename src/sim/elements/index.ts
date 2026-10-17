// sim/elements/index.ts — registre des 41 éléments (27 de base, 13 hybrides, la Divine) : un objet de hooks
// (sans état) par BallElement. Les mini-balles (fx.mini) n'ont aucun hook (« n'héritent pas des effets »), sauf
// les mini-balles à effet (fx.miniFx : mini-bombe de la grappe, miroir du chœur).
import type { Ball, BallElement, GameConfig } from '../../core/types';
import type { Ctx } from '../ctx';
import type { BallFx } from '../state';
import type { ElementHooks } from './types';
import { acid, comet, fire, ice, lightning } from './elemental';
import { bomb, giant, lead, shock } from './heavy';
import { boomerang, echo, ghost, homing, pierce } from './tricky';
import { splitHooks, swarm, twin } from './swarm';
import { gold, lucky, magnet, vampire } from './greed';
import { crystal, nova, prism, rust, stone, voidHooks } from './arcane';
import { HYBRIDS, HYBRID_PARENTS, MINI_HOOKS } from './hybrid';
import { divine } from './divine';
import type { Block } from '../../core/types';

export type { ElementHooks } from './types';

const NONE: ElementHooks = {};

/** Ordre fixe (déterminisme de onShotStart). */
const REGISTRY: Readonly<Record<BallElement, ElementHooks>> = {
  stone,
  fire,
  lightning,
  ice,
  ghost,
  lead,
  split: splitHooks,
  acid,
  magnet,
  pierce,
  bomb,
  homing,
  giant,
  swarm,
  vampire,
  gold,
  prism,
  void: voidHooks,
  echo,
  boomerang,
  crystal,
  shock,
  twin,
  rust,
  nova,
  comet,
  lucky,
  steam: HYBRIDS.steam ?? NONE,
  laser: HYBRIDS.laser ?? NONE,
  cluster: HYBRIDS.cluster ?? NONE,
  wraith: HYBRIDS.wraith ?? NONE,
  abyss: HYBRIDS.abyss ?? NONE,
  jackpot: HYBRIDS.jackpot ?? NONE,
  quake: HYBRIDS.quake ?? NONE,
  missile: HYBRIDS.missile ?? NONE,
  supernova: HYBRIDS.supernova ?? NONE,
  plague: HYBRIDS.plague ?? NONE,
  choir: HYBRIDS.choir ?? NONE,
  orbit: HYBRIDS.orbit ?? NONE,
  hammer: HYBRIDS.hammer ?? NONE,
  divine,
};

const ORDER = Object.keys(REGISTRY) as BallElement[];
/** Hooks globaux de destruction (peste), dans l'ordre du registre. */
const ANY_DESTROYED = ORDER.map((el) => REGISTRY[el].onAnyBlockDestroyed).filter(
  (f): f is NonNullable<ElementHooks['onAnyBlockDestroyed']> => typeof f === 'function',
);

/** Hooks d'un élément (indépendamment de la balle). */
export function elementHooks(el: BallElement): ElementHooks {
  return REGISTRY[el] ?? NONE;
}

/** Hooks applicables à une balle en vol : aucun pour une mini-balle. */
export function hooksOf(b: Ball, fx: BallFx): ElementHooks {
  if (fx.mini) return fx.miniFx ? (MINI_HOOKS[fx.miniFx] ?? NONE) : NONE;
  return REGISTRY[b.element] ?? NONE;
}

/** Début de tir : hooks onShotStart de tous les éléments, dans l'ordre du registre. */
export function elementsShotStart(ctx: Ctx): void {
  for (let i = 0; i < ORDER.length; i++) {
    const h = REGISTRY[ORDER[i] as BallElement];
    if (h.onShotStart) h.onShotStart(ctx);
  }
}

/** Un bloc vient d'être détruit (toute cause) : hooks globaux onAnyBlockDestroyed. */
export function elementsBlockDestroyed(ctx: Ctx, blk: Block, x: number, y: number): void {
  for (let i = 0; i < ANY_DESTROYED.length; i++) (ANY_DESTROYED[i] as NonNullable<ElementHooks['onAnyBlockDestroyed']>)(ctx, blk, x, y);
}

/** Vérifie que balls.json fournit, pour chaque élément présent, ses paramètres obligatoires sur les 3 rangs. */
export function validateElementParams(cfg: GameConfig): void {
  for (const d of cfg.balls.defs) {
    const need = REGISTRY[d.id]?.params;
    if (!need) continue;
    for (const k of need) {
      const v = d.params?.[k];
      if (!Array.isArray(v) || v.length < 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        throw new Error(`config/balls.json : balle "${d.id}", paramètre "params.${k}" manquant ou invalide (3 nombres attendus)`);
      }
    }
  }
  // les recettes de balls.json doivent correspondre aux parents composés dans elements/hybrid.ts
  for (const d of cfg.balls.defs) {
    const p = HYBRID_PARENTS[d.id];
    if (!p) continue;
    const r = d.recipe;
    if (!r || !((r[0] === p[0] && r[1] === p[1]) || (r[0] === p[1] && r[1] === p[0]))) {
      throw new Error(`config/balls.json : hybride "${d.id}", recette attendue ${p[0]} + ${p[1]}`);
    }
  }
}
