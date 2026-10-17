// sim/constants.ts — constantes GÉOMÉTRIQUES et techniques (pas d'équilibrage).
// Tout ce qui relève de l'équilibrage vit dans src/config/*.json.

/** Sous-pas physique : 240 Hz. */
export const SUBSTEP_MS = 1000 / 240;
/** Tolérance de l'accumulateur de pas (évite de perdre un sous-pas sur l'arrondi flottant). */
export const STEP_EPS = 1e-6;
/** Micro-pas anti-tunneling : déplacement max par micro-pas = fraction du rayon de la balle. */
export const MICROSTEP_RADIUS_FRACTION = 0.9;
/** Rayon d'une cheville (peg), en cellules. */
export const PEG_RADIUS = 0.3;
/** Or + balle garantie sur le même bloc : décalage horizontal des deux drops (cellules). */
export const GOLD_DROP_OFFSET = 0.3;
/** Rayon d'un drop, en cellules. */
export const DROP_RADIUS = 0.25;
/** Marge du point de lancement par rapport aux murs. */
export const LAUNCH_MARGIN = 0.3;
/** Longueur du segment réfléchi de la prévisualisation de visée. */
export const PREVIEW_REFLECT_LEN = 1.5;
/** Seuil sous lequel un bloc est considéré détruit (PV flottants). */
export const HP_EPS = 1e-6;
/** Durée de la rampe d'accélération automatique des longues volées (1 → recallSpeed). */
export const AUTO_SPEEDUP_RAMP_MS = 1500;
/** Valeurs de repli si les clés optionnelles ajoutées aux JSON manquent. */
export const DEFAULT_SPLIT_ANGLE_DEG = 25;
export const DEFAULT_START_ROWS = 3;
