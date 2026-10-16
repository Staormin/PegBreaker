// audio/tracks.ts — propriétaire : audio-dev.
// Les trois compositions écrites (partitions). Notation : voir score.ts.
//   accord : « Nom: basse / voix1 voix2 voix3 » (voicing à 3 voix, voisins avec ≥ 1 note commune)
//   ligne  : « note:durée » en noires, r = silence, « | » = barre de mesure (contrôlée par les tests)
//   basse  : « R@temps:durée » (R fondamentale, 5 quinte, O octave, A approche de l'accord suivant)
import type { MusicTrackId } from '../core/types';
import { barlineErrors, bassLine, BEATS_PER_BAR, chord, lineLength, parseLine, type BassStep, type ChordDef, type Note, type SectionDef, type TrackDef } from './score';

/** erreurs de notation détectées au chargement (longueur de ligne, barres de mesure) — vide attendu */
export const NOTATION_ERRORS: string[] = [];

/** ligne validée : longueur = mesures × 4, barres de mesure aux bons endroits ; '' = couche vide */
function L(where: string, src: string, bars: number): Note[] {
  if (src.trim() === '') return [];
  const len = lineLength(src);
  if (Math.abs(len - bars * BEATS_PER_BAR) > 1e-9) NOTATION_ERRORS.push(`${where}: ${len} temps au lieu de ${bars * BEATS_PER_BAR}`);
  for (const b of barlineErrors(src)) NOTATION_ERRORS.push(`${where}: barre de mesure au temps ${b}`);
  return parseLine(src);
}

function sec(
  track: string,
  name: string,
  chords: readonly ChordDef[],
  lines: { melody: string; melodyAlt?: string; counter: string },
  bass: readonly BassStep[],
): SectionDef {
  const n = chords.length;
  const w = `${track} ${name}`;
  const s: SectionDef = {
    name,
    chords,
    melody: L(`${w} mélodie`, lines.melody, n),
    counter: L(`${w} contre-chant`, lines.counter, n),
    bass,
  };
  if (lines.melodyAlt !== undefined) s.melodyAlt = L(`${w} mélodie alt`, lines.melodyAlt, n);
  return s;
}

const C = (...xs: string[]) => xs.map(chord);

// =====================================================================================
// NEON — ré dorien, 88 BPM. Calme, aérien : flûte avec vibrato, pad doux, basse ronde.
// Forme A (8) – B (8) – A' (8) = 24 mesures. Pas de percussion ; vague 6 : contre-chant.
// =====================================================================================
const NEON_A_CHORDS = C(
  'Dm9: D2 / F3 A3 E4',
  'Cadd9: C2 / E3 G3 D4',
  'G: G2 / D3 G3 B3',
  'Dm: D2 / D3 F3 A3',
  'Fmaj7: F2 / E3 A3 C4',
  'C: C2 / E3 G3 C4',
  'G: G2 / D3 G3 B3',
  'Am7: A2 / E3 G3 C4',
);
const NEON_A_MEL_1_4 = 'A4:1.5 D5:.5 E5:2 | D5:1 C5:1 G4:2 | B4:1.5 A4:.5 G4:1 D5:1 | A4:3 r:1 | ';
const NEON_A_ALT_1_4 = 'A4:1 D5:.5 E5:.5 F5:1 E5:1 | D5:1.5 C5:.5 G4:2 | B4:1 A4:.5 B4:.5 G4:1 D5:1 | F5:1 E5:.5 D5:.5 A4:2 | ';
const NEON_A_MEL_5_8 = 'C5:1.5 E5:.5 F5:2 | E5:1 D5:1 C5:1 G4:1 | B4:2 D5:1 C5:1 | C5:1 B4:1 A4:2';
const NEON_A2_MEL_5_8 = 'C5:1.5 E5:.5 A5:2 | G5:1 E5:1 D5:1 C5:1 | B4:1 D5:1 G5:2 | E5:3 r:1';
const NEON_A_COUNTER = 'F4:4 | E4:4 | D4:4 | F4:4 | A4:4 | E4:4 | G4:4 | E4:4';
const NEON_BASS_A = bassLine('R@0:1.75 5@2:1.25 A@3.5:.5');

const NEON: TrackDef = {
  id: 'neon',
  title: 'Néon (ré dorien, 88 BPM)',
  bpm: 88,
  scale: [2, 4, 5, 7, 9, 11, 0],
  bossScale: [2, 4, 5, 7, 9, 10, 1],
  bossMap: { 11: 10, 0: 1 },
  form: [
    sec('neon', 'A', NEON_A_CHORDS, { melody: NEON_A_MEL_1_4 + NEON_A_MEL_5_8, melodyAlt: NEON_A_ALT_1_4 + NEON_A_MEL_5_8, counter: NEON_A_COUNTER }, NEON_BASS_A),
    sec('neon', 'B', C(
        'F: F2 / F3 A3 C4',
        'Dm7: D2 / F3 A3 D4',
        'G7: G2 / F3 B3 D4',
        'Em7: E2 / G3 B3 D4',
        'Am7: A2 / G3 C4 E4',
        'Fmaj7: F2 / A3 C4 E4',
        'G6: G2 / B3 D4 E4',
        'Asus4: A2 / A3 D4 E4',
      ), { melody: 
        'C5:1 E5:1 A5:2 | G5:1.5 F5:.5 D5:2 | F5:1 D5:1 B4:2 | E5:2 D5:1 B4:1 | ' +
          'C5:1.5 E5:.5 G5:2 | A5:2 G5:1 E5:1 | D5:1.5 E5:.5 B4:2 | E5:1 D5:1 A4:2', counter: 'A4:4 | F4:4 | F4:2 G4:2 | G4:4 | E4:4 | A4:4 | G4:4 | D4:4' }, bassLine('R@0:1.5 R@1.5:.5 5@2:1.5 A@3.5:.5')),
    sec('neon', "A'", NEON_A_CHORDS, { melody: NEON_A_MEL_1_4 + NEON_A2_MEL_5_8, melodyAlt: NEON_A_ALT_1_4 + NEON_A2_MEL_5_8, counter: NEON_A_COUNTER }, NEON_BASS_A),
  ],
  third: 'counter',
  drums: null,
  passVariation: 'alt',
  timbre: {
    melody: 'flute',
    chordCutoff: 1400,
    chordAttack: 0.18,
    chordRelease: 0.6,
    bassCutoff: 320,
    reverbSend: { chord: 0.28, melody: 0.3, counter: 0.25, bass: 0.04 },
    delay: { beats: 0.75, feedback: 0.22, wet: 0.2 },
    level: 1,
  },
  resolution: { ...chord('D: D2 / F#3 A3 D4'), melody: 74 },
};

// =====================================================================================
// ARCADE — la mineur / do majeur, 104 BPM. Entraînante : pluck en croches, basse en
// octaves qui bouge, percussion légère (vague 6). Forme A – B (do majeur) – A'.
// =====================================================================================
const ARC_A_CHORDS = C(
  'Am: A2 / A3 C4 E4',
  'F: F2 / A3 C4 F4',
  'C: C2 / G3 C4 E4',
  'G6: G2 / G3 B3 E4',
  'Am: A2 / A3 C4 E4',
  'F: F2 / A3 C4 F4',
  'Dm: D2 / A3 D4 F4',
  'Esus4: E2 / A3 B3 E4',
);
const ARC_A_MEL_1_4 =
  'E5:.5 C5:.5 A4:.5 C5:.5 E5:1 D5:.5 C5:.5 | C5:.5 A4:.5 F4:.5 A4:.5 C5:1 B4:.5 A4:.5 | ' +
  'G4:.5 C5:.5 E5:.5 G5:.5 E5:1 D5:.5 C5:.5 | B4:1 D5:.5 E5:.5 D5:1 r:1 | ';
const ARC_A_ALT_1_4 =
  'A4:.5 E5:.5 A5:.5 E5:.5 C5:1 B4:.5 C5:.5 | A4:.5 F5:.5 C5:.5 A4:.5 F4:1 A4:.5 C5:.5 | ' +
  'E5:.5 G5:.5 C5:.5 E5:.5 G5:1 E5:.5 D5:.5 | D5:1 B4:.5 G4:.5 B4:1 r:1 | ';
const ARC_A_MEL_5_8 =
  'E5:.5 C5:.5 A4:.5 C5:.5 E5:.5 G5:.5 E5:.5 D5:.5 | C5:.5 A4:.5 F4:.5 A4:.5 C5:.5 F5:.5 E5:.5 C5:.5 | ' +
  'D5:1 F5:.5 E5:.5 D5:.5 C5:.5 A4:1 | B4:1 A4:.5 B4:.5 E5:2';
const ARC_A2_MEL_5_8 =
  'A5:.5 G5:.5 E5:.5 C5:.5 E5:.5 A5:.5 G5:.5 E5:.5 | F5:.5 E5:.5 C5:.5 A4:.5 C5:.5 F5:.5 A5:.5 F5:.5 | ' +
  'D5:.5 F5:.5 A5:.5 F5:.5 E5:1 D5:1 | B4:1 D5:.5 B4:.5 A4:2';
const ARC_BASS_A = bassLine('R@0:.5 O@1:.5 R@1.5:.5 5@2:.5 R@2.5:.5 O@3:.5 A@3.5:.5');

const ARCADE: TrackDef = {
  id: 'arcade',
  title: 'Arcade (la mineur, 104 BPM)',
  bpm: 104,
  scale: [9, 11, 0, 2, 4, 5, 7],
  bossScale: [9, 11, 0, 2, 4, 5, 8],
  bossMap: { 7: 8 },
  form: [
    sec('arcade', 'A', ARC_A_CHORDS, { melody: ARC_A_MEL_1_4 + ARC_A_MEL_5_8, melodyAlt: ARC_A_ALT_1_4 + ARC_A_MEL_5_8, counter: '' }, ARC_BASS_A),
    sec('arcade', 'B', C(
        'C: C2 / G3 C4 E4',
        'G: G2 / G3 B3 D4',
        'Am7: A2 / G3 C4 E4',
        'F: F2 / A3 C4 F4',
        'C: C2 / G3 C4 E4',
        'G: G2 / G3 B3 D4',
        'F6: F2 / A3 C4 D4',
        'Esus4: E2 / A3 B3 E4',
      ), { melody: 
        'E5:.5 G5:.5 E5:.5 C5:.5 G5:1 E5:1 | D5:.5 G5:.5 D5:.5 B4:.5 D5:1 G4:1 | ' +
          'C5:.5 E5:.5 A5:.5 G5:.5 E5:1 C5:1 | A4:.5 C5:.5 F5:.5 E5:.5 C5:1 A4:1 | ' +
          'G4:.5 C5:.5 E5:.5 G5:.5 A5:1 G5:1 | G5:.5 F5:.5 D5:.5 B4:.5 D5:1 G5:1 | ' +
          'A5:1 F5:.5 D5:.5 C5:1 A4:1 | B4:1 A4:.5 B4:.5 E5:1 r:1', counter: '' }, bassLine('R@0:1 5@1:.5 O@1.5:.5 R@2:.5 R@2.5:.5 5@3:.5 A@3.5:.5')),
    sec('arcade', "A'", ARC_A_CHORDS, { melody: ARC_A_MEL_1_4 + ARC_A2_MEL_5_8, melodyAlt: ARC_A_ALT_1_4 + ARC_A2_MEL_5_8, counter: '' }, ARC_BASS_A),
  ],
  third: 'perc',
  // 16 doubles-croches ; X accent, x normal. Charleston uniquement sur les contretemps
  // (jamais en même temps que la grosse caisse ou la caisse claire).
  drums: {
    main: { kick: 'X......xX.......', snare: '....X.......X...', hat: '..x...x...x...x.' },
    fill: { kick: 'X......xX.......', snare: '....X.....x.XxXx', hat: '..x...x.........' },
  },
  passVariation: 'alt',
  timbre: {
    melody: 'pluck',
    chordCutoff: 1800,
    chordAttack: 0.08,
    chordRelease: 0.4,
    bassCutoff: 400,
    reverbSend: { chord: 0.2, melody: 0.2, counter: 0.15, bass: 0.03 },
    delay: { beats: 0.75, feedback: 0.2, wet: 0.15 },
    level: 0.9,
  },
  resolution: { ...chord('A: A2 / A3 C#4 E4'), melody: 69 },
};

// =====================================================================================
// DEEP — mi mineur, 80 BPM. Sombre et lent : basse profonde, accords larges, mélodie rare
// et longue (jouée une octave plus bas un passage sur deux). Forme A – B – A'.
// =====================================================================================
const DEEP_A_CHORDS = C(
  'Em(add9): E2 / E3 B3 F#4',
  'Cmaj7: C2 / E3 B3 G4',
  'Am: A1 / E3 C4 A4',
  'Bsus4: B1 / E3 B3 F#4',
  'Em: E2 / E3 B3 G4',
  'G: G1 / D3 B3 G4',
  'Cmaj7: C2 / E3 B3 G4',
  'Bm: B1 / D3 B3 F#4',
);
const DEEP_A_MEL_1_4 = 'r:4 | r:2 B4:2 | E5:4 | B4:2 F#4:2 | ';
const DEEP_A_COUNTER = 'G3:8 | C4:4 | F#3:4 | G3:4 | D4:4 | E4:4 | D4:4';
const DEEP_BASS_A = bassLine('R@0:3.75');

const DEEP: TrackDef = {
  id: 'deep',
  title: 'Deep (mi mineur, 80 BPM)',
  bpm: 80,
  scale: [4, 6, 7, 9, 11, 0, 2],
  bossScale: [4, 6, 7, 9, 11, 0, 3],
  bossMap: { 2: 3 },
  form: [
    sec('deep', 'A', DEEP_A_CHORDS, { melody: DEEP_A_MEL_1_4 + 'B4:6 G4:2 | r:2 E5:2 | D5:2 F#4:2', counter: DEEP_A_COUNTER }, DEEP_BASS_A),
    sec('deep', 'B', C(
        'Cmaj9: C2 / D3 B3 G4',
        'D: D2 / D3 A3 F#4',
        'Bm: B1 / D3 B3 F#4',
        'Em: E2 / E3 B3 G4',
        'Am: A1 / E3 C4 A4',
        'C: C2 / E3 C4 G4',
        'Dadd9: D2 / E3 A3 F#4',
        'Bsus4: B1 / E3 B3 F#4',
      ), { melody: 'E5:4 | D5:4 | B4:6 G4:2 | r:2 C5:2 | E5:3 D5:1 | D5:2 A4:2 | B4:4', counter: 'G3:4 | A3:4 | F#3:4 | G3:4 | A3:4 | G3:4 | F#3:8' }, bassLine('R@0:2.5 5@2.5:1.25')),
    sec('deep', "A'", DEEP_A_CHORDS, { melody: DEEP_A_MEL_1_4 + 'G5:4 | F#5:2 D5:2 | E5:4 | B4:4', counter: DEEP_A_COUNTER }, DEEP_BASS_A),
  ],
  third: 'counter',
  drums: null,
  passVariation: 'octaveDown',
  timbre: {
    melody: 'flute',
    chordCutoff: 1200,
    chordAttack: 0.2,
    chordRelease: 0.8,
    bassCutoff: 200,
    reverbSend: { chord: 0.3, melody: 0.3, counter: 0.28, bass: 0.04 },
    delay: { beats: 0.75, feedback: 0.25, wet: 0.2 },
    level: 1.08,
  },
  resolution: { ...chord('E: E2 / E3 B3 G#4'), melody: 76 },
};

export const TRACKS: Readonly<Record<MusicTrackId, TrackDef>> = { neon: NEON, arcade: ARCADE, deep: DEEP };
export const TRACK_IDS: readonly MusicTrackId[] = ['neon', 'arcade', 'deep'];

export function isTrackId(v: unknown): v is MusicTrackId {
  return v === 'neon' || v === 'arcade' || v === 'deep';
}

/** sections d'une piste (aide aux tests) */
export function sectionsOf(id: MusicTrackId): readonly SectionDef[] {
  return TRACKS[id].form;
}
