// audio/music.render.test.ts — propriétaire : audio-dev.
// Validation objective des trois partitions, par construction (Node n'a pas d'OfflineAudioContext :
// le rendu audio réel est vérifié dans Chromium par music.pw.ts).
import { describe, expect, it } from 'vitest';
import type { MusicTrackId } from '../core/types';
import {
  BEATS_PER_BAR,
  BOSS_BASS_FLOOR,
  buildBar,
  buildResolution,
  formBars,
  pcOf,
  TONAL_PARTS,
  VEL_JITTER,
  type NoteEvent,
  type TrackDef,
} from './score';
import { NOTATION_ERRORS, TRACK_IDS, TRACKS } from './tracks';
import { encodeWav } from './wav';
import { analyseChannels } from './analysis';

const ALL = { melody: true, third: true, boss: false } as const;
const PASSES = 2;

interface Abs extends NoteEvent {
  t: number;
}

/** toutes les notes de `passes` passages, en temps absolu (noires) */
function timeline(def: TrackDef, opts: { melody: boolean; third: boolean; boss: boolean }, passes = PASSES): Abs[] {
  const out: Abs[] = [];
  const bars = formBars(def) * passes;
  for (let b = 0; b < bars; b++) {
    for (const e of buildBar(def, b, opts).events) out.push({ ...e, t: b * BEATS_PER_BAR + e.beat });
  }
  return out;
}

function maxSimultaneous(notes: readonly Abs[]): number {
  const edges: [number, number][] = [];
  for (const n of notes) {
    edges.push([n.t, 1], [n.t + n.dur, -1]);
  }
  // fin avant début au même instant : une note qui s'arrête libère sa voix
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of edges) {
    cur += d;
    if (cur > max) max = cur;
  }
  return max;
}

const sharedPcs = (a: readonly number[], b: readonly number[]): number => {
  const pa = new Set(a.map(pcOf));
  return new Set(b.map(pcOf).filter((p) => pa.has(p))).size;
};

describe('notation', () => {
  it('aucune erreur de longueur ni de barre de mesure', () => {
    expect(NOTATION_ERRORS).toEqual([]);
  });
});

describe.each(TRACK_IDS)('piste %s', (id: MusicTrackId) => {
  const def = TRACKS[id];

  it('structure : ≥ 16 mesures, ≥ 2 sections distinctes, tempo 80-110', () => {
    expect(formBars(def)).toBeGreaterThanOrEqual(16);
    expect(formBars(def)).toBeLessThanOrEqual(32);
    expect(new Set(def.form.map((s) => s.name)).size).toBeGreaterThanOrEqual(2);
    expect(def.bpm).toBeGreaterThanOrEqual(80);
    expect(def.bpm).toBeLessThanOrEqual(110);
    for (const s of def.form) expect(s.chords.length).toBeGreaterThanOrEqual(4);
  });

  it('toutes les notes sont dans la gamme (passages 0 et 1, toutes couches)', () => {
    const scale = new Set(def.scale);
    const bad = timeline(def, ALL)
      .filter((n) => TONAL_PARTS.includes(n.part) && !scale.has(pcOf(n.midi)))
      .map((n) => `${n.part}@${n.t}:${n.midi}`);
    expect(bad).toEqual([]);
  });

  it('mode boss : toutes les notes dans le mineur harmonique, basse une octave plus bas', () => {
    const scale = new Set(def.bossScale);
    const tl = timeline(def, { ...ALL, boss: true });
    const bad = tl.filter((n) => TONAL_PARTS.includes(n.part) && !scale.has(pcOf(n.midi)));
    expect(bad).toEqual([]);
    // la sensible du mineur harmonique est bien entendue
    const leading = def.bossScale.find((p) => !def.scale.includes(p));
    expect(leading).toBeDefined();
    expect(tl.some((n) => pcOf(n.midi) === leading)).toBe(true);
    const calm = timeline(def, ALL).filter((n) => n.part === 'bass');
    const tense = tl.filter((n) => n.part === 'bass');
    expect(tense.length).toBe(calm.length);
    tense.forEach((n, i) => {
      const c = calm[i]!;
      if (c.midi - 12 >= BOSS_BASS_FLOOR) expect(n.midi).toBeLessThanOrEqual(c.midi - 11);
      expect(n.midi).toBeGreaterThanOrEqual(BOSS_BASS_FLOOR);
    });
  });

  it('accords voisins : ≥ 1 note commune, déplacement minimal des voix (boucle comprise)', () => {
    const bars = formBars(def);
    for (let b = 0; b < bars; b++) {
      const a = buildBar(def, b, ALL).chord;
      const n = buildBar(def, b + 1, ALL).chord;
      expect(a.voicing.length).toBe(3);
      expect(sharedPcs(a.voicing, n.voicing), `${a.name} → ${n.name}`).toBeGreaterThanOrEqual(1);
      // voix triées grave → aigu : aucune ne saute plus d'une quinte
      a.voicing.forEach((v, i) => expect(Math.abs((n.voicing[i] ?? v) - v), `${a.name} → ${n.name}`).toBeLessThanOrEqual(7));
    }
  });

  it('jamais plus de 6 voix simultanées (percussion comprise)', () => {
    expect(maxSimultaneous(timeline(def, ALL))).toBeLessThanOrEqual(6);
    expect(maxSimultaneous(timeline(def, { ...ALL, boss: true }))).toBeLessThanOrEqual(6);
  });

  it('mélodie, contre-chant et basse sont monophoniques', () => {
    const tl = timeline(def, ALL);
    for (const part of ['melody', 'counter', 'bass'] as const) {
      expect(maxSimultaneous(tl.filter((n) => n.part === part)), part).toBeLessThanOrEqual(1);
    }
  });

  it('couches : vague 1 = basse + accords ; vague 3 = + mélodie ; vague 6 = + troisième couche', () => {
    const w1 = new Set(timeline(def, { melody: false, third: false, boss: false }, 1).map((n) => n.part));
    expect([...w1].sort()).toEqual(['bass', 'chord']);
    const w3 = new Set(timeline(def, { melody: true, third: false, boss: false }, 1).map((n) => n.part));
    expect(w3.has('melody')).toBe(true);
    const w6 = new Set(timeline(def, ALL, 1).map((n) => n.part));
    if (def.third === 'counter') expect(w6.has('counter')).toBe(true);
    else expect(w6.has('kick') && w6.has('snare') && w6.has('hat')).toBe(true);
  });

  it('aucun silence : basse et accords présents à chaque mesure', () => {
    for (let b = 0; b < formBars(def); b++) {
      const ev = buildBar(def, b, { melody: false, third: false, boss: false }).events;
      expect(ev.some((e) => e.part === 'bass' && e.beat === 0)).toBe(true);
      expect(ev.filter((e) => e.part === 'chord').length).toBe(3);
    }
  });

  it('déterministe ; seul aléa = vélocité ±10 % ; variation au passage impair', () => {
    const bars = formBars(def);
    let i = 0;
    const rand = (): number => [0, 1, 0.5, 0.25][i++ % 4]!;
    for (let b = 0; b < bars; b++) {
      const a = buildBar(def, b, ALL).events;
      const r = buildBar(def, b, { ...ALL, rand }).events;
      expect(r.map((e) => [e.part, e.beat, e.midi, e.dur])).toEqual(a.map((e) => [e.part, e.beat, e.midi, e.dur]));
      r.forEach((e, k) => {
        const v = a[k]!.vel;
        expect(e.vel).toBeGreaterThanOrEqual(v * (1 - VEL_JITTER) - 1e-9);
        expect(e.vel).toBeLessThanOrEqual(v * (1 + VEL_JITTER) + 1e-9);
        expect(e.vel).toBeLessThanOrEqual(1);
      });
    }
    const mel = (pass: number): string =>
      timeline(def, ALL, pass + 1)
        .filter((n) => n.part === 'melody' && n.t >= pass * bars * BEATS_PER_BAR)
        .map((n) => `${n.t - pass * bars * BEATS_PER_BAR}:${n.midi}`)
        .join(' ');
    expect(mel(1)).not.toBe(mel(0));
    expect(mel(2)).toBe(mel(0));
  });

  it('résolution run:over : accord I majeur sur la tonique', () => {
    const ev = buildResolution(def, true);
    const chordPcs = ev.filter((e) => e.part === 'chord').map((e) => pcOf(e.midi));
    const root = pcOf(def.resolution.bass);
    expect(root).toBe(def.scale[0]);
    expect(new Set(chordPcs)).toEqual(new Set([root, (root + 4) % 12, (root + 7) % 12]));
  });
});

describe('wav', () => {
  it('encode un PCM 16 bits stéréo valide', async () => {
    const l = new Float32Array([0, 0.5, -0.5, 1]);
    const r = new Float32Array([0, -1, 2, -2]);
    const blob = encodeWav([l, r], 48000);
    const buf = new DataView(await blob.arrayBuffer());
    const str = (o: number): string => String.fromCharCode(buf.getUint8(o), buf.getUint8(o + 1), buf.getUint8(o + 2), buf.getUint8(o + 3));
    expect(str(0)).toBe('RIFF');
    expect(str(8)).toBe('WAVE');
    expect(buf.getUint16(22, true)).toBe(2);
    expect(buf.getUint32(24, true)).toBe(48000);
    expect(buf.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(buf.getInt16(44 + 4 * 1, true)).toBe(Math.round(0.5 * 32767));
    expect(buf.getInt16(44 + 4 * 2 + 2, true)).toBe(32767); // écrêté
  });
});

describe('analyse de rendu', () => {
  it('mesure pic, silence et sauts de RMS entre mesures', () => {
    const sr = 1000;
    const ch = new Float32Array(sr * 8);
    // mesures de 1 s : 0,1 / 0,1 / silence 3 s / 0,5 …
    for (let i = 0; i < ch.length; i++) {
      const s = Math.floor(i / sr);
      const amp = s < 2 ? 0.1 : s < 5 ? 0 : 0.5;
      ch[i] = amp * (i % 2 === 0 ? 1 : -1);
    }
    const a = analyseChannels([ch], sr, 1, 0);
    expect(a.peak).toBeCloseTo(0.5);
    expect(a.barRmsDb.length).toBe(8);
    expect(a.maxSilenceS).toBeCloseTo(3, 1);
    expect(a.maxBarJumpDb).toBe(Infinity);
    const b = analyseChannels([ch.subarray(0, 2 * sr)], sr, 1, 0);
    expect(b.maxBarJumpDb).toBeCloseTo(0);
    expect(b.maxSilenceS).toBe(0);
  });
});
