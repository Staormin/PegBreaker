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
  /** multiplicateur de dégâts de la volée, figé au tir : 1 − spreadDamagePenalty × aimSpread */
  shotDamageMult: number;
  /** multiplicateur de la balle dorée, figé au tir selon le nombre de balles lancées */
  goldenMult: number;
  /** effets par balle en vol, ALIGNÉ sur RunState.balls (même index, swap-remove miroir dans pools.ts) */
  bfx: BallFx[];
  /** acide : charges par bloc, quadruplets à plat [blockId, pct, toursRestants, plafondParTour, ...] */
  acidQ: number[];
  /** ancien format (triplets sans plafond), migré à la reprise d'un snapshot */
  acid?: number[];
  /** rouille : ids des blocs déjà rouillés (une fois par bloc) */
  rusted: number[];
  /** choc : paires à plat [blockId, reculs ce tir, ...], remis à zéro à chaque tir */
  shocked: number[];
}

/**
 * Effets d'une balle en vol (JSON pur). Contournement local : `Ball` (core/types.ts) n'a pas ces champs.
 * Une mini-balle (`mini`) n'a aucun hook d'élément, n'est jamais dorée et compte dans balls.maxLiveBalls.
 */
export interface BallFx {
  mini: boolean;
  /** multiplicateur de dégâts propre à la balle (jumelle, mini-balles, écho) */
  dmgMult: number;
  /** multiplicateur de vitesse (géante, comète) appliqué à ctx.ballSpeed */
  speedMult: number;
  /** traverse les blocs comme un fantôme (copie d'écho, boomerang au retour) */
  pass: boolean;
  /** rebonds comptés (cristal) */
  bounces: number;
  /** perforante : traversées restantes, bloc en cours de traversée (−1 = aucun) */
  pierceLeft: number;
  piercingId: number;
  /** boomerang : ms de vol de l'aller courant, retour en cours, allers-retours restants */
  flightMs: number;
  returning: boolean;
  returnsLeft: number;
  /** direction de départ (boomerang : repart dans cette direction) */
  dirX: number;
  dirY: number;
  /** essaim : mini-balles libérées par cette balle */
  spawned: number;
  /** vampire : soins déjà rendus par cette balle */
  heals: number;
}

export function createFx(): BallFx {
  return {
    mini: false,
    dmgMult: 1,
    speedMult: 1,
    pass: false,
    bounces: 0,
    pierceLeft: 0,
    piercingId: -1,
    flightMs: 0,
    returning: false,
    returnsLeft: 0,
    dirX: 0,
    dirY: -1,
    spawned: 0,
    heals: 0,
  };
}

export function resetFx(f: BallFx): void {
  f.mini = false;
  f.dmgMult = 1;
  f.speedMult = 1;
  f.pass = false;
  f.bounces = 0;
  f.pierceLeft = 0;
  f.piercingId = -1;
  f.flightMs = 0;
  f.returning = false;
  f.returnsLeft = 0;
  f.dirX = 0;
  f.dirY = -1;
  f.spawned = 0;
  f.heals = 0;
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
    shotDamageMult: 1,
    goldenMult: 1,
    bfx: [],
    acidQ: [],
    rusted: [],
    shocked: [],
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
