// sim/state.ts — état interne de la run (JSON pur).
import type { BallElement, RunState, RunStats, VolleyBall } from '../core/types';

/**
 * Champs internes nécessaires à une reprise EXACTE depuis un snapshot.
 * Contournement local : RunState ne les prévoit pas (demande d'ajout à l'architecte).
 * Ils voyagent dans le snapshot sous la clé `internal`.
 */
export interface SimInternal {
  /** compteur d'identifiants (balles, blocs, drops) */
  nextId: number;
  /** reliquat de l'accumulateur de sous-pas (ms) */
  acc: number;
  /** ms avant le prochain lancement de la rafale */
  launchTimer: number;
  /** copie de la volée au moment du tir (la volée peut changer pendant le vol) */
  launchQueue: VolleyBall[];
  /** ms écoulées depuis le début de la volée */
  volleyElapsed: number;
  /** origine et direction figées au tir */
  originX: number;
  dirX: number;
  dirY: number;
  /** une balle de la volée a déjà touché le sol */
  firstGrounded: boolean;
  splitsThisShot: number;
  firstbloodUsed: boolean;
  safetynetUsed: boolean;
  /** combo hérité (relique safetynet) par la prochaine balle lancée, 0 = aucun */
  inheritCombo: number;
  /** boss 'absorb' : premier élément l'ayant touché dans le tir */
  absorbElement: BallElement | null;
  /** pièces accumulées pour la relique piggy */
  piggyCoins: number;
  wavesCleared: number;
  restarts: number;
}

export interface SimState extends RunState {
  internal: SimInternal;
}

export function createInternal(nextId: number): SimInternal {
  return {
    nextId,
    acc: 0,
    launchTimer: 0,
    launchQueue: [],
    volleyElapsed: 0,
    originX: 0,
    dirX: 0,
    dirY: -1,
    firstGrounded: false,
    splitsThisShot: 0,
    firstbloodUsed: false,
    safetynetUsed: false,
    inheritCombo: 0,
    absorbElement: null,
    piggyCoins: 0,
    wavesCleared: 0,
    restarts: 0,
  };
}

export function createStats(): RunStats {
  return {
    shots: 0,
    blocksDestroyed: 0,
    bestCombo: 0,
    bestShotDamage: 0,
    totalDamage: 0,
    coinsEarned: 0,
    fragmentsEarned: 0,
    fusions: 0,
    bossesKilled: 0,
    durationMs: 0,
  };
}
