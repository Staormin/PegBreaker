// audio/score.ts — propriétaire : audio-dev.
// Partitions et lecture de partition : AUCUN WebAudio ici (testable sous Node).
// Une piste = forme en sections (A, B, A'…) ; chaque section = une progression d'accords écrite
// (un accord par mesure, voicing à 3 voix, basse écrite), une mélodie et un contre-chant écrits
// en notation texte, un motif de basse. `buildBar` produit les notes d'une mesure donnée.
// Seuls aléas : la vélocité (±10 %, via `rand`) ; la variation par passage est déterministe.

export type Part = 'bass' | 'chord' | 'melody' | 'counter' | 'kick' | 'snare' | 'hat';
export const TONAL_PARTS: readonly Part[] = ['bass', 'chord', 'melody', 'counter'];
export const BEATS_PER_BAR = 4;
/** variation de vélocité autorisée (±) */
export const VEL_JITTER = 0.1;

export interface Note {
  /** temps (noires) depuis le début de la section */
  beat: number;
  midi: number;
  /** durée en noires */
  dur: number;
}

export interface NoteEvent {
  part: Part;
  /** temps (noires) depuis le début de la mesure (peut dépasser 4 pour une note liée) */
  beat: number;
  midi: number;
  dur: number;
  vel: number;
}

export interface ChordDef {
  name: string;
  /** fondamentale jouée par la basse (MIDI) */
  bass: number;
  /** voicing du pad, 3 voix, grave → aigu (MIDI) */
  voicing: readonly number[];
}

/** pas de basse : R fondamentale, 5 quinte, O octave, A approche diatonique de l'accord suivant */
export interface BassStep {
  beat: number;
  deg: 'R' | '5' | 'O' | 'A';
  dur: number;
}

export interface DrumBar {
  kick: string;
  snare: string;
  hat: string;
}

export interface SectionDef {
  name: string;
  chords: readonly ChordDef[];
  melody: readonly Note[];
  /** mélodie des passages impairs (variation écrite) ; absente = même mélodie */
  melodyAlt?: readonly Note[];
  counter: readonly Note[];
  bass: readonly BassStep[];
}

export interface Timbre {
  melody: 'flute' | 'pluck';
  /** coupure du passe-bas du pad (Hz) */
  chordCutoff: number;
  chordAttack: number;
  chordRelease: number;
  bassCutoff: number;
  /** envoi vers la réverbération par couche (0..1) */
  reverbSend: { chord: number; melody: number; counter: number; bass: number };
  /** delay de la mélodie : temps en noires (0,75 = croche pointée), réinjection ≤ 0,25 */
  delay: { beats: number; feedback: number; wet: number };
  /** niveau global de la piste */
  level: number;
}

export interface TrackDef {
  id: 'neon' | 'arcade' | 'deep';
  title: string;
  bpm: number;
  /** classes de hauteur de la gamme (0 = do) */
  scale: readonly number[];
  /** gamme du mode boss (mineur harmonique) */
  bossScale: readonly number[];
  /** remplacement de classes de hauteur en mode boss (gamme → mineur harmonique) */
  bossMap: Readonly<Record<number, number>>;
  form: readonly SectionDef[];
  /** troisième couche (vague ≥ 6) */
  third: 'counter' | 'perc';
  drums: { main: DrumBar; fill: DrumBar } | null;
  /** variation par passage : 'alt' = melodyAlt les passages impairs ; 'octaveDown' = mélodie −12 */
  passVariation: 'alt' | 'octaveDown';
  timbre: Timbre;
  /** accord de résolution (I majeur) pour run:over */
  resolution: ChordDef & { melody: number };
}

// --- notation ----------------------------------------------------------------------

const PC: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C#4' → 61, 'Bb2' → 46 ; lève une erreur sur une note invalide (données statiques) */
export function midiOf(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  const letter = m?.[1];
  const octave = m?.[3];
  if (!m || letter === undefined || octave === undefined) throw new Error(`note invalide: ${name}`);
  const base = PC[letter] ?? 0;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(octave) + 1) + base + acc;
}

export const pcOf = (midi: number): number => ((midi % 12) + 12) % 12;

/**
 * Notation : « A4:1.5 D5:.5 E5:2 | r:4 | … » — note:durée (noires), r = silence.
 * « | » est une barre de mesure facultative (contrôlée par les tests : `barlineErrors`).
 */
export function parseLine(src: string): Note[] {
  const out: Note[] = [];
  let beat = 0;
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === '' || tok === '|') continue;
    const [name, d] = tok.split(':');
    const dur = Number(d);
    if (name === undefined || !Number.isFinite(dur) || dur <= 0) throw new Error(`jeton invalide: ${tok}`);
    if (name !== 'r') out.push({ beat, midi: midiOf(name), dur });
    beat += dur;
  }
  return out;
}

/** longueur totale (noires) d'une ligne, silences compris */
export function lineLength(src: string): number {
  let beat = 0;
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === '' || tok === '|') continue;
    beat += Number(tok.split(':')[1]);
  }
  return beat;
}

/** barres de mesure mal placées (position non multiple de 4 au moment du « | ») */
export function barlineErrors(src: string): number[] {
  const bad: number[] = [];
  let beat = 0;
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === '') continue;
    if (tok === '|') {
      if (Math.abs(beat / BEATS_PER_BAR - Math.round(beat / BEATS_PER_BAR)) > 1e-9) bad.push(beat);
      continue;
    }
    beat += Number(tok.split(':')[1]);
  }
  return bad;
}

/** « Dm9: D2 / F3 A3 E4 » → ChordDef */
export function chord(src: string): ChordDef {
  const [name, rest] = src.split(':');
  const [bass, voicing] = (rest ?? '').split('/');
  if (name === undefined || bass === undefined || voicing === undefined) throw new Error(`accord invalide: ${src}`);
  return { name: name.trim(), bass: midiOf(bass.trim()), voicing: voicing.trim().split(/\s+/).map(midiOf) };
}

export function bassLine(src: string): BassStep[] {
  // « 0R1.75 2-5-1.25 » serait illisible : on écrit « R@0:1.75 5@2:1.25 A@3.5:.5 »
  return src
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const m = /^([R5OA])@([\d.]+):([\d.]+)$/.exec(tok);
      if (!m) throw new Error(`pas de basse invalide: ${tok}`);
      return { deg: m[1] as BassStep['deg'], beat: Number(m[2]), dur: Number(m[3]) };
    });
}

// --- lecture -----------------------------------------------------------------------

export function formBars(def: TrackDef): number {
  let n = 0;
  for (const s of def.form) n += s.chords.length;
  return n;
}

export interface BarPos {
  section: SectionDef;
  sectionIndex: number;
  /** mesure dans la section */
  barInSection: number;
  /** mesure dans la forme */
  barInForm: number;
  /** passage (0, 1, 2…) dans la forme bouclée */
  pass: number;
}

export function barPos(def: TrackDef, barIndex: number): BarPos {
  const total = formBars(def);
  const i = Math.max(0, Math.floor(barIndex));
  const pass = Math.floor(i / total);
  const barInForm = i % total;
  let rest = barInForm;
  for (let s = 0; s < def.form.length; s++) {
    const sec = def.form[s];
    if (!sec) break;
    if (rest < sec.chords.length) return { section: sec, sectionIndex: s, barInSection: rest, barInForm, pass };
    rest -= sec.chords.length;
  }
  const first = def.form[0];
  if (!first) throw new Error('forme vide');
  return { section: first, sectionIndex: 0, barInSection: 0, barInForm: 0, pass };
}

/** accord écrit de la mesure `barIndex` (gamme naturelle) */
export function chordAt(def: TrackDef, barIndex: number): ChordDef {
  const p = barPos(def, barIndex);
  const c = p.section.chords[p.barInSection];
  if (!c) throw new Error('accord manquant');
  return c;
}

export function mapBoss(def: TrackDef, midi: number): number {
  const pc = pcOf(midi);
  const to = def.bossMap[pc];
  return to === undefined ? midi : midi - pc + to;
}

export interface BarOptions {
  /** couche mélodie (vague ≥ 3) */
  melody: boolean;
  /** troisième couche : contre-chant ou percussion (vague ≥ 6) */
  third: boolean;
  /** mode boss : mineur harmonique + basse une octave plus bas */
  boss: boolean;
  /** source d'aléa pour la vélocité (0..1) ; absente = vélocité nominale */
  rand?: () => number;
}

export interface BarPlan {
  events: NoteEvent[];
  chord: ChordDef;
  pos: BarPos;
}

/** accent métrique : temps fort, temps, contretemps */
function accent(beat: number): number {
  const b = beat % BEATS_PER_BAR;
  if (b === 0) return 1;
  if (Number.isInteger(b)) return b === 2 ? 0.95 : 0.9;
  return 0.82;
}

const BASE_VEL: Readonly<Record<Part, number>> = {
  bass: 0.9,
  chord: 0.8,
  melody: 0.85,
  counter: 0.75,
  kick: 1,
  snare: 1,
  hat: 1,
};

/** note la plus haute de la gamme strictement sous `target` */
function stepBelow(scale: readonly number[], target: number): number {
  for (let m = target - 1; m > target - 13; m--) if (scale.includes(pcOf(m))) return m;
  return target - 2;
}

function drumHits(pattern: string, part: Part, out: NoteEvent[]): void {
  const steps = pattern.length;
  for (let i = 0; i < steps; i++) {
    const c = pattern[i];
    if (c !== 'X' && c !== 'x') continue;
    out.push({ part, beat: (i * BEATS_PER_BAR) / steps, midi: 0, dur: 0.25, vel: c === 'X' ? 0.9 : 0.55 });
  }
}

/** toutes les notes de la mesure `barIndex` (temps relatifs au début de la mesure) */
export function buildBar(def: TrackDef, barIndex: number, opts: BarOptions): BarPlan {
  const pos = barPos(def, barIndex);
  const sec = pos.section;
  const c = sec.chords[pos.barInSection];
  if (!c) throw new Error('accord manquant');
  const next = chordAt(def, barIndex + 1);
  const events: NoteEvent[] = [];
  const barStart = pos.barInSection * BEATS_PER_BAR;
  const odd = pos.pass % 2 === 1;

  // basse
  for (const s of sec.bass) {
    let m = c.bass;
    if (s.deg === '5') m = c.bass + 7;
    else if (s.deg === 'O') m = c.bass + 12;
    else if (s.deg === 'A') m = next.bass === c.bass ? c.bass : stepBelow(def.scale, nearest(next.bass, c.bass));
    events.push({ part: 'bass', beat: s.beat, midi: m, dur: s.dur, vel: BASE_VEL.bass * accent(s.beat) });
  }
  // accords : une tenue par mesure, 3 voix
  for (const v of c.voicing) events.push({ part: 'chord', beat: 0, midi: v, dur: BEATS_PER_BAR, vel: BASE_VEL.chord });

  // mélodie
  if (opts.melody) {
    const useAlt = def.passVariation === 'alt' && odd && sec.melodyAlt !== undefined;
    const line = useAlt && sec.melodyAlt ? sec.melodyAlt : sec.melody;
    const shift = def.passVariation === 'octaveDown' && odd ? -12 : 0;
    for (const n of line) {
      if (n.beat < barStart || n.beat >= barStart + BEATS_PER_BAR) continue;
      const b = n.beat - barStart;
      events.push({ part: 'melody', beat: b, midi: n.midi + shift, dur: n.dur, vel: BASE_VEL.melody * accent(b) });
    }
  }
  // troisième couche
  if (opts.third) {
    if (def.third === 'counter') {
      for (const n of sec.counter) {
        if (n.beat < barStart || n.beat >= barStart + BEATS_PER_BAR) continue;
        const b = n.beat - barStart;
        events.push({ part: 'counter', beat: b, midi: n.midi, dur: n.dur, vel: BASE_VEL.counter * accent(b) });
      }
    } else if (def.drums) {
      const last = pos.barInSection === sec.chords.length - 1;
      const kit = last ? def.drums.fill : def.drums.main;
      drumHits(kit.kick, 'kick', events);
      drumHits(kit.snare, 'snare', events);
      drumHits(kit.hat, 'hat', events);
    }
  }

  // boss : mineur harmonique, basse à l'octave inférieure
  if (opts.boss) {
    for (const e of events) {
      if (e.part === 'kick' || e.part === 'snare' || e.part === 'hat') continue;
      e.midi = mapBoss(def, e.midi);
      if (e.part === 'bass') e.midi = bossBass(e.midi);
    }
  }
  // vélocité : seule part d'aléa (±10 %)
  const rand = opts.rand;
  if (rand) for (const e of events) e.vel *= 1 + (rand() * 2 - 1) * VEL_JITTER;

  const chordOut: ChordDef = opts.boss
    ? { name: `${c.name} (boss)`, bass: bossBass(mapBoss(def, c.bass)), voicing: c.voicing.map((v) => mapBoss(def, v)) }
    : c;
  return { events, chord: chordOut, pos };
}

/** plancher de la basse en mode boss : mi 1 (41 Hz) ; en dessous, l'octave inférieure est inaudible */
export const BOSS_BASS_FLOOR = 28;

/** basse du mode boss : une octave plus bas, sauf si l'on passerait sous le plancher */
export function bossBass(midi: number): number {
  return midi - 12 >= BOSS_BASS_FLOOR ? midi - 12 : midi;
}

/** même classe de hauteur que `target`, dans l'octave la plus proche de `ref` */
function nearest(target: number, ref: number): number {
  let m = target;
  while (m - ref > 6) m -= 12;
  while (ref - m > 6) m += 12;
  return m;
}

/** notes de la résolution I majeur (run:over), 2 mesures */
export function buildResolution(def: TrackDef, withMelody: boolean): NoteEvent[] {
  const r = def.resolution;
  const dur = BEATS_PER_BAR * 2;
  const ev: NoteEvent[] = [{ part: 'bass', beat: 0, midi: r.bass, dur, vel: 0.85 }];
  for (const v of r.voicing) ev.push({ part: 'chord', beat: 0, midi: v, dur, vel: 0.85 });
  if (withMelody) ev.push({ part: 'melody', beat: 0, midi: r.melody, dur, vel: 0.7 });
  return ev;
}

export const secondsPerBeat = (def: TrackDef): number => 60 / def.bpm;
export const secondsPerBar = (def: TrackDef): number => (60 / def.bpm) * BEATS_PER_BAR;
