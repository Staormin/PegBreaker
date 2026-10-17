// audio/hits.ts — propriétaire : audio-dev.
// Table des voix de `block:hit` : un timbre de base par FAMILLE (FAMILY_HIT) et une variation par
// ÉLÉMENT (HIT_VOICES : fréquence, filtre, couche courte). `Record<BallElement, …>` : le compilateur
// exige les 41 clés. La famille de chaque voix doit rester égale à `family` de config/balls.json,
// et les `parents` d'une hybride à sa `recipe` (vérifié par audio.test.ts). Les recettes qui lisent
// cette table sont dans sfx.ts.
//
// Hybrides : les deux voix parentes superposées (la seconde à −6 dB, décalée de 12 ms) + une
// signature courte propre (HitLayer « hybride » ci-dessous). Divine : accord pur + chœur bref.
import type { BallElement, BallFamily } from '../core/types';

/** timbre de base d'une famille (lu par sfx.ts, base des tests de distinction) */
export interface FamilyHit {
  /** source principale */
  wave: OscillatorType | 'noise';
  /** filtre principal ('none' : pas de filtre) */
  filter: BiquadFilterType | 'none';
  /** fréquence de référence de la famille (Hz) : corps tonal ou centre du bruit */
  baseHz: number;
  /** rapports des partiels tonaux par rapport à baseHz */
  partials: readonly number[];
  /** durée de base (s) */
  dur: number;
  /** description en une ligne */
  note: string;
}

export const FAMILY_HIT: Readonly<Record<BallFamily, FamilyHit>> = {
  elemental: { wave: 'noise', filter: 'lowpass', baseHz: 700, partials: [], dur: 0.11, note: 'bruit soufflé (passe-bas qui se referme) ou crépitant (éclats passe-haut)' },
  heavy: { wave: 'sine', filter: 'lowpass', baseHz: 70, partials: [1], dur: 0.08, note: 'sub sinus grave + bruit très étouffé, sans clic : sourd et gros' },
  tricky: { wave: 'sine', filter: 'none', baseHz: 660, partials: [1, 1.012], dur: 0.12, note: 'deux sinus détunés (~20 cents), attaque douce, brefs' },
  swarm: { wave: 'noise', filter: 'bandpass', baseHz: 1800, partials: [], dur: 0.025, note: 'double clic rapide (bruit passe-bande + square 2 ms)' },
  greed: { wave: 'sine', filter: 'none', baseHz: 1568, partials: [1, 2.76], dur: 0.14, note: '« ding » métallique : sinus + partiel inharmonique ×2,76 + clic' },
  arcane: { wave: 'triangle', filter: 'bandpass', baseHz: 2349, partials: [1], dur: 0.16, note: 'triangle aigu passé dans un passe-bande résonant : cristallin filtré' },
  hybrid: { wave: 'noise', filter: 'none', baseHz: 0, partials: [], dur: 0.15, note: 'les deux voix parentes (2e à −6 dB, +12 ms) + signature propre courte' },
  divine: { wave: 'sine', filter: 'none', baseHz: 523.25, partials: [1, 1.5, 2], dur: 0.32, note: 'accord pur (fondamentale + quinte + octave, sinus) + chœur bref (3 sinus détunés, vibrato)' },
};

/** gain relatif de la seconde voix parente d'une hybride (−6 dB) */
export const HYBRID_SECOND_GAIN = Math.pow(10, -6 / 20);
/** décalage de la seconde voix parente (s) */
export const HYBRID_SECOND_DELAY_S = 0.012;

/** couche courte propre à l'élément (en plus du timbre de famille) */
export type HitLayer =
  | 'none'
  | 'chime' // ice : carillon aigu
  | 'bubble' // acid : bulles montantes
  | 'trail' // comet : traînée qui monte
  | 'boom' // giant : queue longue + octave triangle
  | 'fuse' // bomb : grésillement de mèche avant l'impact
  | 'buzz' // shock : bourdon de scie filtrée
  | 'zip' // pierce : chute rapide
  | 'glide' // homing : glissé montant
  | 'repeat' // echo : réplique retardée
  | 'swing' // boomerang : aller puis retour
  | 'third' // swarm : troisième clic
  | 'stereo' // twin : clics gauche/droite
  | 'sparkle' // lucky : second ding à la quinte
  | 'hum' // magnet : ronflement grave
  | 'warm' // vampire : ding assombri + sous-octave
  | 'neutral' // stone : recette de base de la skill
  | 'fifth' // prism : quinte décalée (arc-en-ciel)
  | 'suck' // void : glissé descendant étouffé
  | 'ring' // crystal : résonance longue + octave
  | 'burst' // nova : étincelle passe-haut
  | 'grain' // rust : grattement granuleux
  // --- signatures des hybrides (jouées après les deux voix parentes) ---
  | 'vent' // steam : jet de vapeur (bruit passe-haut qui siffle)
  | 'pew' // laser : « pew » sinus 3 kHz → 1,2 kHz
  | 'scatter' // cluster : trois mini-pops éparpillés
  | 'phase' // wraith : battement grave spectral (deux sinus à 3 Hz d'écart)
  | 'drip' // abyss : goutte qui tombe dans le vide + sub
  | 'payout' // jackpot : trois dings rapides montants (machine à sous)
  | 'rumble' // quake : grondement passe-bas + sub 38 Hz
  | 'lock' // missile : double bip de verrouillage
  | 'flare' // supernova : souffle qui monte + éclat 4 kHz
  | 'rot' // plague : bourdon de scie grave étouffé (pourriture)
  | 'harmony' // choir : tierce majeure douce (deux voix)
  | 'whirl' // orbit : doppler (bruit passe-bande qui monte puis redescend)
  | 'anvil' // hammer : tintement d'enclume inharmonique + sub
  // --- Divine ---
  | 'halo'; // accord + chœur

export type ElementalMode = 'breath' | 'crackle';

export interface HitVoice {
  family: BallFamily;
  /** fréquence tonale principale (Hz) */
  hz: number;
  /** fréquence du filtre / centre du bruit (Hz) */
  filterHz: number;
  layer: HitLayer;
  /** famille elemental uniquement : soufflé (feu) ou crépitant (foudre) */
  mode?: ElementalMode;
  /** hybride : les deux parents (= recipe de config/balls.json), joués superposés */
  parents?: readonly [BallElement, BallElement];
  /** hybride / Divine : fondamentale du carillon de forge (shop:forged), « couleur » de la balle */
  chimeHz?: number;
  /** identité audible, une ligne */
  note: string;
}

export const HIT_VOICES: Readonly<Record<BallElement, HitVoice>> = {
  // elemental
  fire: { family: 'elemental', mode: 'breath', hz: 150, filterHz: 700, layer: 'none', note: 'souffle grave passe-bas 700→180 Hz + corps sinus 150 Hz' },
  comet: { family: 'elemental', mode: 'breath', hz: 190, filterHz: 2400, layer: 'trail', note: 'souffle brillant (2,4 kHz) + traînée passe-bande qui monte' },
  acid: { family: 'elemental', mode: 'breath', hz: 230, filterHz: 1100, layer: 'bubble', note: 'souffle moyen (1,1 kHz) + deux bulles sinus montantes' },
  lightning: { family: 'elemental', mode: 'crackle', hz: 2400, filterHz: 3200, layer: 'none', note: 'trois éclats passe-haut 3,2 kHz irréguliers + clic 2,4 kHz' },
  ice: { family: 'elemental', mode: 'crackle', hz: 2637, filterHz: 6000, layer: 'chime', note: 'grésil 6 kHz + carillon 2,6/3,9 kHz' },
  // heavy
  lead: { family: 'heavy', hz: 72, filterHz: 320, layer: 'none', note: 'sub 72 Hz + bruit étouffé 320 Hz, mat' },
  giant: { family: 'heavy', hz: 52, filterHz: 220, layer: 'boom', note: 'sub 52 Hz plus long + octave triangle 104 Hz : le plus gros' },
  bomb: { family: 'heavy', hz: 64, filterHz: 420, layer: 'fuse', note: 'grésillement de mèche 20 ms puis sub 64 Hz' },
  shock: { family: 'heavy', hz: 90, filterHz: 520, layer: 'buzz', note: 'sub 90 Hz + bourdon scie 180 Hz filtré (secousse)' },
  // tricky
  ghost: { family: 'tricky', hz: 660, filterHz: 0, layer: 'none', note: 'sinus 660 Hz détunés qui divergent, attaque très douce' },
  pierce: { family: 'tricky', hz: 1046, filterHz: 0, layer: 'zip', note: 'sinus 1 kHz détunés qui chutent d\'une octave en 50 ms (zip)' },
  homing: { family: 'tricky', hz: 784, filterHz: 0, layer: 'glide', note: 'sinus 784 Hz qui glissent vers le haut (verrouillage)' },
  echo: { family: 'tricky', hz: 740, filterHz: 0, layer: 'repeat', note: 'sinus 740 Hz + réplique à 70 ms, plus faible' },
  boomerang: { family: 'tricky', hz: 523, filterHz: 0, layer: 'swing', note: 'sinus 523 Hz qui montent puis redescendent (aller-retour)' },
  // swarm
  split: { family: 'swarm', hz: 1000, filterHz: 1800, layer: 'none', note: 'deux clics 1,8 puis 2,2 kHz espacés de 35 ms' },
  swarm: { family: 'swarm', hz: 1400, filterHz: 2600, layer: 'third', note: 'trois clics serrés 2,6 kHz (18 ms) : bourdonnement' },
  twin: { family: 'swarm', hz: 900, filterHz: 1500, layer: 'stereo', note: 'deux clics identiques 1,5 kHz, gauche puis droite (25 ms)' },
  // greed
  gold: { family: 'greed', hz: 1568, filterHz: 0, layer: 'none', note: 'ding sol 1,57 kHz brillant + partiel ×2,76' },
  lucky: { family: 'greed', hz: 2093, filterHz: 0, layer: 'sparkle', note: 'ding do 2,1 kHz + second ding à la quinte (45 ms)' },
  magnet: { family: 'greed', hz: 1175, filterHz: 0, layer: 'hum', note: 'ding ré 1,18 kHz + ronflement triangle 117 Hz' },
  vampire: { family: 'greed', hz: 932, filterHz: 1800, layer: 'warm', note: 'ding si♭ 932 Hz assombri (passe-bas 1,8 kHz) + sous-octave chaude' },
  // arcane
  stone: { family: 'arcane', hz: 1200, filterHz: 1200, layer: 'neutral', note: 'recette de base : bruit passe-bande 1,2 kHz Q 2 40 ms + clic' },
  prism: { family: 'arcane', hz: 2349, filterHz: 2349, layer: 'fifth', note: 'triangle 2,35 kHz filtré + quinte décalée 12 ms (arc-en-ciel)' },
  void: { family: 'arcane', hz: 587, filterHz: 700, layer: 'suck', note: 'triangle 587 Hz étouffé qui s\'effondre d\'une octave (aspiration)' },
  crystal: { family: 'arcane', hz: 3136, filterHz: 3136, layer: 'ring', note: 'triangle 3,1 kHz résonance longue 250 ms + octave' },
  nova: { family: 'arcane', hz: 1760, filterHz: 1760, layer: 'burst', note: 'triangle 1,76 kHz + étincelle passe-haut 6 kHz' },
  rust: { family: 'arcane', hz: 784, filterHz: 900, layer: 'grain', note: 'triangle 784 Hz terne + grattement de bruit large 2,5 kHz' },
  // hybrid : parents superposés + signature
  steam: { family: 'hybrid', parents: ['fire', 'ice'], hz: 0, filterHz: 4200, layer: 'vent', chimeHz: 659.3, note: 'feu + glace + jet de vapeur (passe-haut 4,2 → 2 kHz, 110 ms)' },
  laser: { family: 'hybrid', parents: ['lightning', 'prism'], hz: 3000, filterHz: 0, layer: 'pew', chimeHz: 987.8, note: 'foudre + prisme + « pew » sinus 3 → 1,2 kHz 45 ms' },
  cluster: { family: 'hybrid', parents: ['bomb', 'split'], hz: 1600, filterHz: 0, layer: 'scatter', chimeHz: 587.3, note: 'bombe + scission + trois mini-pops 1,6 kHz éparpillés (30-70 ms)' },
  wraith: { family: 'hybrid', parents: ['ghost', 'pierce'], hz: 330, filterHz: 0, layer: 'phase', chimeHz: 830.6, note: 'spectre + perce + battement 330/333 Hz à attaque lente (140 ms)' },
  abyss: { family: 'hybrid', parents: ['acid', 'void'], hz: 1200, filterHz: 0, layer: 'drip', chimeHz: 554.4, note: 'acide + néant + goutte 1,2 kHz → 300 Hz à +50 ms et sub 80 Hz' },
  jackpot: { family: 'hybrid', parents: ['gold', 'lucky'], hz: 2637, filterHz: 0, layer: 'payout', chimeHz: 1046.5, note: 'or + chance + trois dings mi-sol-si aigus (25 ms d\'écart)' },
  quake: { family: 'hybrid', parents: ['giant', 'shock'], hz: 38, filterHz: 140, layer: 'rumble', chimeHz: 440, note: 'géant + choc + grondement passe-bas 140 Hz 220 ms et sub 38 Hz' },
  missile: { family: 'hybrid', parents: ['comet', 'homing'], hz: 2000, filterHz: 0, layer: 'lock', chimeHz: 740, note: 'comète + tête chercheuse + double bip carré 2 kHz (verrouillage)' },
  supernova: { family: 'hybrid', parents: ['crystal', 'nova'], hz: 4186, filterHz: 2000, layer: 'flare', chimeHz: 1174.7, note: 'cristal + nova + souffle montant 2 → 10 kHz et éclat 4,2 kHz' },
  plague: { family: 'hybrid', parents: ['vampire', 'acid'], hz: 73, filterHz: 420, layer: 'rot', chimeHz: 493.9, note: 'vampire + acide + bourdon de scie 73 Hz étouffé (420 Hz)' },
  choir: { family: 'hybrid', parents: ['twin', 'echo'], hz: 659.3, filterHz: 0, layer: 'harmony', chimeHz: 880, note: 'jumeau + écho + tierce majeure douce 659/831 Hz' },
  orbit: { family: 'hybrid', parents: ['boomerang', 'magnet'], hz: 0, filterHz: 600, layer: 'whirl', chimeHz: 698.5, note: 'boomerang + aimant + doppler (passe-bande 600 → 2,4 kHz → 600 Hz)' },
  hammer: { family: 'hybrid', parents: ['lead', 'rust'], hz: 1250, filterHz: 0, layer: 'anvil', chimeHz: 392, note: 'plomb + rouille + tintement d\'enclume 1,25/3,1/4,6 kHz et sub 55 Hz' },
  // divine
  divine: { family: 'divine', hz: 523.25, filterHz: 0, layer: 'halo', chimeHz: 523.25, note: 'accord do-sol-do sinus purs + chœur bref (3 sinus détunés, vibrato 5,5 Hz)' },
};

/** les 41 éléments, dans l'ordre de la table (grille de preview, tests) */
export const HIT_ELEMENTS: readonly BallElement[] = Object.keys(HIT_VOICES) as BallElement[];

/** hybrides (13), dans l'ordre de la table */
export const HYBRID_ELEMENTS: readonly BallElement[] = HIT_ELEMENTS.filter((el) => HIT_VOICES[el].family === 'hybrid');

/** priorité de limiteur d'un block:hit : la Divine passe avant tout (2), le reste en 1 */
export function hitPriority(element: BallElement): 1 | 2 {
  return HIT_VOICES[element].family === 'divine' ? 2 : 1;
}

/** variante d'explosion déduite d'un `block:explode` (l'événement ne porte pas toujours sa source) */
export type ExplodeKind = 'normal' | 'bomb' | 'nova' | 'divine' | 'steam' | 'supernova' | 'missile';

/** variante de lightning:chain */
export type ChainKind = 'arc' | 'prism' | 'laser' | 'divine';

/** source d'une chaîne (champ core prioritaire, sinon dernière balle active ; la Divine exige le champ) */
export function chainKindFrom(element: BallElement | undefined, lastBall: BallElement | null): ChainKind {
  if (element === 'divine') return 'divine';
  const src = element ?? lastBall;
  return src === 'prism' ? 'prism' : src === 'laser' ? 'laser' : 'arc';
}

/** rayon ≥ 1,4 : bombe (balls.json bomb.radius = 1,4 / 1,8 / 2,2) */
export const BOMB_MIN_RADIUS = 1.4;
/** nova : rayon 1,2 (balls.json nova.radius) */
export const NOVA_RADIUS = 1.2;

/**
 * Classe une explosion. `fromExplosiveBlock` : un `block:destroyed` de kind 'explosive' vient
 * juste d'être émis (le bloc explosif a aussi un rayon de 1,2, comme la nova).
 */
export function explodeKind(radius: number, fromExplosiveBlock: boolean): ExplodeKind {
  if (fromExplosiveBlock) return 'normal';
  if (radius >= BOMB_MIN_RADIUS) return 'bomb';
  if (Math.abs(radius - NOVA_RADIUS) < 0.03) return 'nova';
  return 'normal';
}

/** source d'explosion portée par `block:explode.element` (absente : déduction par le rayon) */
export function explodeKindFrom(element: BallElement | 'explosive' | undefined, radius: number, fromExplosiveBlock: boolean): ExplodeKind {
  if (element === undefined) return explodeKind(radius, fromExplosiveBlock);
  switch (element) {
    case 'bomb':
      return 'bomb';
    case 'nova':
      return 'nova';
    case 'divine':
      return 'divine';
    case 'steam':
      return 'steam';
    case 'supernova':
      return 'supernova';
    case 'missile':
    case 'cluster': // mini-bombes de la Grappe (3-5 à la fois) : explosion sèche, pas 5 grosses bombes
      return 'missile';
    default:
      return 'normal';
  }
}
