// sim/elements/index.ts — registre des 27 éléments : un objet de hooks (sans état) par BallElement.
// Les mini-balles (fx.mini) n'ont aucun hook : elles « n'héritent pas des effets ».
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
};

const ORDER = Object.keys(REGISTRY) as BallElement[];

/** Hooks d'un élément (indépendamment de la balle). */
export function elementHooks(el: BallElement): ElementHooks {
  return REGISTRY[el] ?? NONE;
}

/** Hooks applicables à une balle en vol : aucun pour une mini-balle. */
export function hooksOf(b: Ball, fx: BallFx): ElementHooks {
  return fx.mini ? NONE : (REGISTRY[b.element] ?? NONE);
}

/** Début de tir : hooks onShotStart de tous les éléments, dans l'ordre du registre. */
export function elementsShotStart(ctx: Ctx): void {
  for (let i = 0; i < ORDER.length; i++) {
    const h = REGISTRY[ORDER[i] as BallElement];
    if (h.onShotStart) h.onShotStart(ctx);
  }
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
}
