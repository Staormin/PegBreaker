// audio/synth.ts — propriétaire : audio-dev.
// Timbres de la musique et graphe d'une piste. Fonctionne sur tout BaseAudioContext (temps réel
// ou OfflineAudioContext pour l'export WAV / la validation). Aucun nœud n'est créé à l'import.
//
// Graphe d'une piste :
//   voix ─► couche (bass|chord|melody|counter|perc|hold) ─► dry ─► fader ─► rig.out
//                       └─► envoi (dosage par couche) ─► send ─► fader ─► rig.reverb ─► rig.out
//   mélodie ─► delay (croche pointée, réinjection ≤ 0,25, passe-bas) ─► dry + envoi
// Timbres : basse sine + triangle à l'octave (passe-bas 200-400 Hz) ; pad triangle + sine
// détunés ±4 cents (passe-bas 1,2-1,8 kHz, attaque 80-200 ms) ; flûte sine + vibrato 5 Hz ;
// pluck triangle + carré filtrés (attaque 2 ms, décroissance 250 ms) ; aucune dent de scie.
import { secondsPerBeat, type BarOptions, type BarPlan, type NoteEvent, type Part, type TrackDef, buildBar } from './score';

const FLOOR = 0.0001;
export const REVERB_SECONDS = 2.2;
/** au-delà, un accord tenu (run:lost) s'éteint de lui-même */
export const HOLD_MAX_S = 14;

export type Counter = <T extends AudioNode>(n: T) => T;

export interface Rig {
  ctx: BaseAudioContext;
  /** sortie de la musique (avant le volume utilisateur) */
  out: GainNode;
  reverb: AudioNode;
  noise: AudioBuffer;
  n: Counter;
}

export type Layer = 'bass' | 'chord' | 'melody' | 'counter' | 'perc' | 'hold';
export const LAYERS: readonly Layer[] = ['bass', 'chord', 'melody', 'counter', 'perc', 'hold'];

export interface TrackBus {
  def: TrackDef;
  layers: Record<Layer, GainNode>;
  /** dry + envoi réverb : toujours automatisés ensemble */
  faders: readonly GainNode[];
  disconnect(): void;
}

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** réponse impulsionnelle synthétique : bruit stéréo décroissant (−60 dB à la fin), assombri au fil du temps */
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.012);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const env = Math.exp(-6.9 * x) * Math.min(1, (i - pre) / (sr * 0.004));
      // passe-bas à un pôle dont la coupure descend avec le temps (queue plus sombre)
      const a = 0.55 - 0.45 * x;
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * env;
    }
  }
  return buf;
}

export function createRig(ctx: BaseAudioContext, dest: AudioNode, n: Counter): Rig {
  const out = n(ctx.createGain());
  out.connect(dest);
  const conv = n(ctx.createConvolver());
  conv.normalize = true;
  conv.buffer = makeImpulse(ctx, REVERB_SECONDS);
  const tone = n(ctx.createBiquadFilter());
  tone.type = 'lowpass';
  tone.frequency.value = 4500;
  const ret = n(ctx.createGain());
  ret.gain.value = 0.8;
  conv.connect(tone);
  tone.connect(ret);
  ret.connect(out);
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return { ctx, out, reverb: conv, noise, n };
}

export function createTrackBus(rig: Rig, def: TrackDef, initialFade: number): TrackBus {
  const { ctx, n } = rig;
  const dry = n(ctx.createGain());
  const send = n(ctx.createGain());
  dry.gain.value = initialFade * def.timbre.level;
  send.gain.value = initialFade * def.timbre.level;
  dry.connect(rig.out);
  send.connect(rig.reverb);
  const sends = def.timbre.reverbSend;
  const amount: Record<Layer, number> = {
    bass: sends.bass,
    chord: sends.chord,
    melody: sends.melody,
    counter: sends.counter,
    perc: 0.08,
    hold: sends.chord,
  };
  const all: AudioNode[] = [dry, send];
  const mk = (l: Layer): GainNode => {
    const g = n(ctx.createGain());
    g.connect(dry);
    const s = n(ctx.createGain());
    s.gain.value = amount[l];
    g.connect(s);
    s.connect(send);
    all.push(g, s);
    return g;
  };
  const layers: Record<Layer, GainNode> = {
    bass: mk('bass'),
    chord: mk('chord'),
    melody: mk('melody'),
    counter: mk('counter'),
    perc: mk('perc'),
    hold: mk('hold'),
  };
  // delay de la mélodie (seule couche avec delay)
  const dl = def.timbre.delay;
  const delay = n(ctx.createDelay(2));
  delay.delayTime.value = dl.beats * secondsPerBeat(def);
  const fb = n(ctx.createGain());
  fb.gain.value = Math.min(0.25, dl.feedback);
  const dlp = n(ctx.createBiquadFilter());
  dlp.type = 'lowpass';
  dlp.frequency.value = 2400;
  const wet = n(ctx.createGain());
  wet.gain.value = dl.wet;
  layers.melody.connect(delay);
  delay.connect(dlp);
  dlp.connect(fb);
  fb.connect(delay);
  dlp.connect(wet);
  wet.connect(dry);
  const ws = n(ctx.createGain());
  ws.gain.value = sends.melody;
  wet.connect(ws);
  ws.connect(send);
  all.push(delay, fb, dlp, wet, ws);
  return {
    def,
    layers,
    faders: [dry, send],
    disconnect() {
      for (const a of all) a.disconnect();
    },
  };
}

/** fondu des faders d'une piste (dry + envoi) de la valeur courante vers `to` entre t0 et t1 */
export function fadeBus(bus: TrackBus, t0: number, t1: number, to: number): void {
  const v = to * bus.def.timbre.level;
  for (const f of bus.faders) {
    const g = f.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(g.value, t0);
    g.linearRampToValueAtTime(v, Math.max(t0 + 0.01, t1));
  }
}

const layerOf = (p: Part): Layer => (p === 'kick' || p === 'snare' || p === 'hat' ? 'perc' : p);

/** enveloppe tenue : attaque linéaire, maintien, relâchement exponentiel, terminée à t+d */
function sustainEnv(g: AudioParam, t: number, d: number, peak: number, atk: number, rel: number, sus = 1): void {
  const a = Math.min(atk, d * 0.4);
  const r = Math.min(rel, d * 0.45);
  g.setValueAtTime(FLOOR, t);
  g.linearRampToValueAtTime(peak, t + a);
  g.setTargetAtTime(peak * sus, t + a, 0.25);
  g.setValueAtTime(peak * sus, t + d - r);
  g.exponentialRampToValueAtTime(FLOOR, t + d);
}

function osc(rig: Rig, type: OscillatorType, f: number, detune = 0): OscillatorNode {
  const o = rig.n(rig.ctx.createOscillator());
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  return o;
}

function gain(rig: Rig, v: number): GainNode {
  const g = rig.n(rig.ctx.createGain());
  g.gain.value = v;
  return g;
}

function filter(rig: Rig, type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
  const b = rig.n(rig.ctx.createBiquadFilter());
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

function noise(rig: Rig): AudioBufferSourceNode {
  const s = rig.n(rig.ctx.createBufferSource());
  s.buffer = rig.noise;
  return s;
}

function pan(rig: Rig, v: number, into: AudioNode): AudioNode {
  const c = rig.ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
  if (typeof c.createStereoPanner !== 'function') return into;
  const p = rig.n(c.createStereoPanner());
  p.pan.value = v;
  p.connect(into);
  return p;
}

/** joue une note de partition à l'instant `t` (secondes) ; `dest` force la couche (accord tenu) */
export function playNote(rig: Rig, bus: TrackBus, ev: NoteEvent, t: number, dest?: Layer): void {
  const def = bus.def;
  const tb = def.timbre;
  const spb = secondsPerBeat(def);
  const d = Math.max(0.05, ev.dur * spb);
  const out = bus.layers[dest ?? layerOf(ev.part)];
  const f = mtof(ev.midi);
  const v = ev.vel;
  switch (ev.part) {
    case 'bass': {
      const lp = filter(rig, 'lowpass', tb.bassCutoff, 0.7);
      const g = gain(rig, FLOOR);
      const o1 = osc(rig, 'sine', f);
      const o2 = osc(rig, 'triangle', f * 2);
      const g2 = gain(rig, 0.3);
      o1.connect(lp);
      o2.connect(g2);
      g2.connect(lp);
      lp.connect(g);
      g.connect(out);
      sustainEnv(g.gain, t, d, 0.24 * v, 0.008, 0.12, 0.7);
      for (const o of [o1, o2]) {
        o.start(t);
        o.stop(t + d + 0.02);
      }
      return;
    }
    case 'chord': {
      const lp = filter(rig, 'lowpass', tb.chordCutoff, 0.5);
      const g = gain(rig, FLOOR);
      const o1 = osc(rig, 'triangle', f, -4);
      const o2 = osc(rig, 'sine', f, 4);
      o1.connect(lp);
      o2.connect(lp);
      lp.connect(g);
      g.connect(pan(rig, ev.midi % 2 === 0 ? -0.2 : 0.2, out));
      sustainEnv(g.gain, t, d, 0.05 * v, tb.chordAttack, tb.chordRelease, 0.85);
      for (const o of [o1, o2]) {
        o.start(t);
        o.stop(t + d + 0.02);
      }
      return;
    }
    case 'melody': {
      if (tb.melody === 'pluck') {
        const dec = Math.min(0.26, d + 0.08);
        const lp = filter(rig, 'lowpass', 2800, 1.2);
        lp.frequency.setValueAtTime(2800, t);
        lp.frequency.exponentialRampToValueAtTime(700, t + dec);
        const g = gain(rig, FLOOR);
        const o1 = osc(rig, 'triangle', f);
        const o2 = osc(rig, 'square', f, 3);
        const g2 = gain(rig, 0.22);
        o1.connect(lp);
        o2.connect(g2);
        g2.connect(lp);
        lp.connect(g);
        g.connect(pan(rig, 0.1, out));
        g.gain.setValueAtTime(FLOOR, t);
        g.gain.linearRampToValueAtTime(0.13 * v, t + 0.002);
        g.gain.exponentialRampToValueAtTime(FLOOR, t + dec);
        for (const o of [o1, o2]) {
          o.start(t);
          o.stop(t + dec + 0.02);
        }
        return;
      }
      flute(rig, out, f, t, d, 0.11 * v, 0.05);
      return;
    }
    case 'counter': {
      const lp = filter(rig, 'lowpass', 1500, 0.5);
      const g = gain(rig, FLOOR);
      const o = osc(rig, 'triangle', f);
      o.connect(lp);
      lp.connect(g);
      g.connect(pan(rig, -0.3, out));
      sustainEnv(g.gain, t, d, 0.05 * v, 0.09, 0.3, 0.9);
      o.start(t);
      o.stop(t + d + 0.02);
      return;
    }
    case 'kick': {
      const o = osc(rig, 'sine', 110);
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
      const g = gain(rig, FLOOR);
      o.connect(g);
      g.connect(out);
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.linearRampToValueAtTime(0.3 * v, t + 0.003);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.09);
      o.start(t);
      o.stop(t + 0.1);
      return;
    }
    case 'hat': {
      const s = noise(rig);
      const hp = filter(rig, 'highpass', 7000, 0.7);
      const g = gain(rig, FLOOR);
      s.connect(hp);
      hp.connect(g);
      g.connect(pan(rig, 0.25, out));
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.linearRampToValueAtTime(0.05 * v, t + 0.001);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.03);
      s.start(t, Math.random() * 0.9);
      s.stop(t + 0.04);
      return;
    }
    case 'snare': {
      const s = noise(rig);
      const bp = filter(rig, 'bandpass', 1800, 0.9);
      const g = gain(rig, FLOOR);
      s.connect(bp);
      bp.connect(g);
      g.connect(out);
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.linearRampToValueAtTime(0.11 * v, t + 0.002);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.11);
      s.start(t, Math.random() * 0.8);
      s.stop(t + 0.12);
      const o = osc(rig, 'sine', 180);
      const go = gain(rig, FLOOR);
      o.connect(go);
      go.connect(out);
      go.gain.setValueAtTime(FLOOR, t);
      go.gain.linearRampToValueAtTime(0.08 * v, t + 0.002);
      go.gain.exponentialRampToValueAtTime(FLOOR, t + 0.07);
      o.start(t);
      o.stop(t + 0.08);
      return;
    }
  }
}

/** flûte : sine + partiel 2 léger, vibrato 5 Hz qui s'installe après l'attaque */
function flute(rig: Rig, out: AudioNode, f: number, t: number, d: number, peak: number, atk: number): void {
  const g = gain(rig, FLOOR);
  const o = osc(rig, 'sine', f);
  const o2 = osc(rig, 'sine', f * 2);
  const g2 = gain(rig, 0.1);
  const lfo = osc(rig, 'sine', 5);
  const depth = gain(rig, 0);
  lfo.connect(depth);
  depth.connect(o.frequency);
  depth.connect(o2.frequency);
  const cents = f * (Math.pow(2, 7 / 1200) - 1);
  depth.gain.setValueAtTime(0, t);
  depth.gain.setValueAtTime(0, t + Math.min(0.25, d * 0.3));
  depth.gain.linearRampToValueAtTime(cents, t + Math.min(0.6, d * 0.6));
  o.connect(g);
  o2.connect(g2);
  g2.connect(g);
  g.connect(pan(rig, 0.1, out));
  sustainEnv(g.gain, t, d, peak, atk, Math.min(0.22, d * 0.3), 0.85);
  for (const x of [o, o2, lfo]) {
    x.start(t);
    x.stop(t + d + 0.02);
  }
}

export interface HeldChord {
  release(at: number, dur: number): void;
}

/** accord tenu (run:lost) : pad sur la couche « hold », s'éteint seul après HOLD_MAX_S */
export function playHold(rig: Rig, bus: TrackBus, voicing: readonly number[], t: number): HeldChord {
  const tb = bus.def.timbre;
  const env = gain(rig, FLOOR);
  const lp = filter(rig, 'lowpass', tb.chordCutoff * 0.8, 0.5);
  lp.connect(env);
  env.connect(bus.layers.hold);
  const end = t + HOLD_MAX_S;
  const oscs: OscillatorNode[] = [];
  for (const m of voicing) {
    const f = mtof(m);
    for (const [type, det] of [['triangle', -4], ['sine', 4]] as const) {
      const o = osc(rig, type, f, det);
      o.connect(lp);
      o.start(t);
      o.stop(end + 0.05);
      oscs.push(o);
    }
  }
  const peak = 0.05;
  env.gain.setValueAtTime(FLOOR, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.6);
  env.gain.setValueAtTime(peak, end - 3);
  env.gain.exponentialRampToValueAtTime(FLOOR, end);
  let released = false;
  return {
    release(at, dur) {
      if (released) return;
      released = true;
      const g = env.gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(Math.max(FLOOR, g.value), at);
      g.exponentialRampToValueAtTime(FLOOR, at + Math.max(0.05, dur));
      for (const o of oscs) {
        try {
          o.stop(at + dur + 0.05);
        } catch {
          /* déjà arrêté */
        }
      }
    },
  };
}

export interface PlanStats {
  notes: number;
  /** notes dont l'instant était déjà passé au moment de la planification */
  late: number;
}

/** planifie toute la mesure `bar` à partir de l'instant `t0` ; renvoie le plan */
export function planBar(rig: Rig, bus: TrackBus, bar: number, t0: number, opts: BarOptions, stats?: PlanStats): BarPlan {
  const plan = buildBar(bus.def, bar, opts);
  const spb = secondsPerBeat(bus.def);
  const now = rig.ctx.currentTime;
  for (const e of plan.events) {
    const t = t0 + e.beat * spb;
    if (stats) {
      stats.notes++;
      if (t < now) stats.late++;
    }
    playNote(rig, bus, e, Math.max(t, now));
  }
  return plan;
}
