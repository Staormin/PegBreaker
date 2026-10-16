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
  /** recall() appelé pendant la volée en cours (désactive l'accélération automatique) */
  manualRecall: boolean;
  /** blocs dégelés au dernier avancement : immunisés au gel pendant le tour suivant */
  thawedIds: number[];
  /** le joueur a perdu des PV pendant la vague courante (stats.perfectWaves) */
  damagedThisWave: boolean;
  /** pyromane : ids des blocs qui brûlent au prochain tir */
  embers: number[];
  /** radar : ids des balles ayant déjà touché un bloc dans ce tir */
  radarUsed: number[];
  /** glace : blocs gelés pendant le tir en cours */
  frozenThisShot: number;
  /** éventail : directions de départ (x0, y0, x1, y1, ...) dans l'ordre de launchQueue */
  launchDirs: number[];
  /** état du flux aléatoire dédié aux contrats (n'altère pas le flux principal) */
  contractRng: number;
  /** id du dernier contrat proposé (jamais deux fois le même d'affilée) */
  lastContractId: string | null;
  /** blocs cassés pendant le tir en cours (contrat destroyInOneShot) */
  shotKills: number;
  /** un boss a été tué pendant la vague courante (reward:offered source 'boss') */
  bossKilledThisWave: boolean;
  /** run:over déjà émis pour cette run (giveUp / restart) */
  overEmitted: boolean;
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
    manualRecall: false,
    thawedIds: [],
    damagedThisWave: false,
    embers: [],
    radarUsed: [],
    frozenThisShot: 0,
    launchDirs: [],
    contractRng: 1,
    lastContractId: null,
    shotKills: 0,
    bossKilledThisWave: false,
    overEmitted: false,
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
    perfectWaves: 0,
    contractsCompleted: 0,
    durationMs: 0,
  };
}
