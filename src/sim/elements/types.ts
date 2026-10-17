// sim/elements/types.ts — contrat des hooks d'élément (un objet de hooks par BallElement).
// Les hooks sont sans état : tout l'état vit dans RunState / internal (JSON pur). Paramètres : balls.json → params.
import type { Ball, Block, Drop } from '../../core/types';
import type { Ctx } from '../ctx';
import type { BallFx } from '../state';

export interface ElementHooks {
  /** traverse les blocs (fantôme) */
  readonly passThrough?: boolean;
  /** n'accumule jamais de combo (plomb) */
  readonly noCombo?: boolean;
  /** les rebonds de mur ne donnent pas de combo de relique (géante) */
  readonly noWallCombo?: boolean;
  /** toujours dorée au lancement, en plus de la dorée normale (Divine) */
  readonly alwaysGolden?: boolean;
  /** clés de params obligatoires dans balls.json (validées à createSim) */
  readonly params?: readonly string[];
  /** au lancement, avant le calcul de la vitesse : rayon (b.radius) et fx.speedMult */
  modifyBall?(ctx: Ctx, b: Ball, fx: BallFx): void;
  /** après ball:launched */
  onLaunch?(ctx: Ctx, b: Ball, fx: BallFx): void;
  /** dégâts d'impact (target = bloc frappé, null pour un effet dérivé) ; peut écrire ctx.hit.crit / ignoreArmor */
  modifyDamage?(ctx: Ctx, b: Ball, fx: BallFx, dmg: number, target: Block | null): number;
  /** après les dégâts directs d'un impact (bloc ou cheville) ; `dmg` = dégâts calculés de l'impact */
  onBlockHit?(ctx: Ctx, b: Ball, fx: BallFx, bi: number, blk: Block, px: number, py: number, dmg: number, isPeg: boolean): void;
  /** un bloc vient d'être détruit par cette balle (ou un de ses effets) ; vrai = le drop est déjà géré */
  onBlockDestroyed?(ctx: Ctx, b: Ball, fx: BallFx, blk: Block, x: number, y: number): boolean;
  /** après tout rebond (mur, plafond, bloc, cheville) et son ball:bounce ; bi = bloc rebondi (−1 = mur) */
  onBounce?(ctx: Ctx, b: Ball, fx: BallFx, surface: 'wall' | 'block' | 'peg', nx: number, ny: number, bi: number): void;
  /** rebond sur un mur latéral (wallX = 0 ou cols), après ball:bounce */
  onWallBounce?(ctx: Ctx, b: Ball, fx: BallFx, wallX: number): void;
  /** rebond de plafond (y = 0), avant ball:bounce (le combo affiché inclut le bonus) */
  onCeilingBounce?(ctx: Ctx, b: Ball, fx: BallFx): void;
  /** après ball:grounded (balle morte, combo remis à 0) */
  onGrounded?(ctx: Ctx, b: Ball, fx: BallFx): void;
  /** chaque micro-pas, avant le déplacement */
  onTick?(ctx: Ctx, b: Ball, fx: BallFx, dtMs: number): void;
  /** palier de combo franchi (après combo:milestone) */
  onComboMilestone?(ctx: Ctx, b: Ball, fx: BallFx, level: 1 | 2 | 3, combo: number): void;
  /** rayon de ramassage des drops (aimant), 0 = contact */
  collectRadius?(ctx: Ctx, b: Ball, fx: BallFx): number;
  /** drop ramassé par cette balle : multiplicateur de valeur */
  onDropCollected?(ctx: Ctx, b: Ball, fx: BallFx, d: Drop): number;
  /** début de chaque tir (après la brûlure pyromane), que l'élément soit dans la volée ou non */
  onShotStart?(ctx: Ctx): void;
  /** n'importe quel bloc vient d'être détruit (quelle que soit la cause), que l'élément soit dans la volée ou non */
  onAnyBlockDestroyed?(ctx: Ctx, blk: Block, x: number, y: number): void;
}
