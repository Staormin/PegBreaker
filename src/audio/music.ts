// audio/music.ts — propriétaire : audio-dev.
// Musique générative discrète : drone (deux sinus détunés) + pad filtré + arpège triangle avec
// delay en feedback. La mineur pentatonique, 92 BPM. Toutes les 4 mesures, une phrase est tirée
// au hasard parmi 4 motifs (jamais deux fois le même d'affilée) avec une progression de fondamentales
// elle aussi tirée au hasard : pas de boucle fixe.
// Intensité (vague) → volume du pad, densité et volume de l'arpège. Tension (boss) → échelle
// dissonante, drone avec seconde mineure, filtre du pad plus ouvert.
// Planification « lookahead » : un setInterval de 25 ms planifie les notes 120 ms à l'avance.
import type { Engine } from './engine';

const BPM = 92;
const EIGHTH = 60 / BPM / 2;
const STEPS_PER_BAR = 8;
const BARS_PER_PHRASE = 4;
const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;
const FLOOR = 0.0001;

const A2 = 110;
const ARP_BASE = 220;
const SCALE_CALM = [0, 3, 5, 7, 10] as const; // la mineur pentatonique
const SCALE_TENSE = [0, 1, 3, 6, 7] as const; // seconde mineure + triton

/** motifs d'une mesure (degrés de l'échelle, -1 = silence) */
const MOTIFS: readonly (readonly number[])[] = [
  [0, -1, 2, 4, 5, -1, 4, 2],
  [4, 3, 2, -1, 0, 2, -1, 1],
  [5, -1, 7, 5, 4, -1, 2, -1],
  [0, 2, 4, 2, 5, 4, 7, -1],
];
/** progressions de fondamentales (degrés) sur 4 mesures */
const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 0, 3, 2],
  [0, 3, 2, 0],
  [0, 2, 3, 1],
  [0, 1, 3, 2],
];

function pick<T>(arr: readonly T[], avoid?: T): T {
  for (let i = 0; i < 4; i++) {
    const v = arr[Math.floor(Math.random() * arr.length)] as T;
    if (v !== avoid) return v;
  }
  return arr[0] as T;
}

function degreeSemis(scale: readonly number[], d: number): number {
  const n = scale.length;
  const oct = Math.floor(d / n);
  const idx = ((d % n) + n) % n;
  return (scale[idx] ?? 0) + 12 * oct;
}

const hz = (base: number, semis: number): number => base * Math.pow(2, semis / 12);

interface Layer {
  out: GainNode;
  drone: OscillatorNode[];
  tensionGain: GainNode;
  pad: OscillatorNode[];
  padFilter: BiquadFilterNode;
  padGain: GainNode;
  arpIn: GainNode;
  stoppers: AudioScheduledSourceNode[];
}

export interface Music {
  /** démarre après `delayS` secondes de silence (fondu d'entrée) ; idempotent */
  start(delayS: number): void;
  /** fondu de sortie puis arrêt complet */
  stop(fadeS: number): void;
  /** fin de run : accord de résolution (la majeur) puis extinction douce */
  resolve(): void;
  setWave(wave: number): void;
  setTension(on: boolean): void;
  /** onglet caché : suspend la planification et coupe la couche */
  pause(): void;
  resume(): void;
  readonly playing: boolean;
}

export function createMusic(e: Engine): Music {
  let layer: Layer | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  let intensity = 0;
  let tension = false;
  let nextTime = 0;
  let step = 0;
  let motif: readonly number[] = MOTIFS[0] as readonly number[];
  let prog: readonly number[] = PROGRESSIONS[0] as readonly number[];

  function buildLayer(): Layer | null {
    const ctx = e.ctx;
    const out = e.gain(FLOOR);
    const droneGain = e.gain(0.09);
    const tensionGain = e.gain(FLOOR);
    const padFilter = e.filter('lowpass', 700, 0.8);
    const padGain = e.gain(0.03);
    const arpIn = e.gain(1);
    const delay = e.delay(1);
    const fb = e.gain(0.35);
    const wet = e.gain(0.5);
    const d1 = e.osc('sine', 55);
    const d2 = e.osc('sine', 55.35);
    const dt = e.osc('sine', 58.27);
    if (!ctx || !out || !droneGain || !tensionGain || !padFilter || !padGain || !arpIn || !delay || !fb || !wet || !d1 || !d2 || !dt || !e.musicOut) return null;
    const pad: OscillatorNode[] = [];
    for (const s of [0, 7, 12]) {
      const o = e.osc('sawtooth', hz(A2, s));
      if (!o) return null;
      o.detune.value = (Math.random() * 2 - 1) * 6;
      o.connect(padFilter);
      pad.push(o);
    }
    out.connect(e.musicOut);
    d1.connect(droneGain);
    d2.connect(droneGain);
    droneGain.connect(out);
    dt.connect(tensionGain);
    tensionGain.connect(out);
    padFilter.connect(padGain);
    padGain.connect(out);
    // arpège : sec + delay en feedback (0,35 ; 375 ms)
    delay.delayTime.value = 0.375;
    arpIn.connect(out);
    arpIn.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(out);
    const t = ctx.currentTime;
    const stoppers: AudioScheduledSourceNode[] = [d1, d2, dt, ...pad];
    for (const s of stoppers) s.start(t);
    return { out, drone: [d1, d2], tensionGain, pad, padFilter, padGain, arpIn, stoppers };
  }

  function teardown(at: number): void {
    if (!layer) return;
    for (const s of layer.stoppers) {
      try {
        s.stop(at);
      } catch {
        /* déjà arrêté */
      }
    }
    const out = layer.out;
    setTimeout(() => out.disconnect(), Math.max(0, (at - (e.ctx?.currentTime ?? 0)) * 1000) + 3000);
    layer = null;
  }

  function applyMix(t: number): void {
    if (!layer) return;
    const padLevel = (tension ? 0.06 : 0.025) + 0.05 * intensity;
    layer.padGain.gain.setTargetAtTime(padLevel, t, 0.8);
    layer.padFilter.frequency.setTargetAtTime(tension ? 1400 : 600 + 500 * intensity, t, 0.8);
    layer.tensionGain.gain.setTargetAtTime(tension ? 0.07 : FLOOR, t, 0.6);
  }

  function setPadChord(rootSemis: number, t: number): void {
    if (!layer) return;
    const chord = tension ? [0, 1, 6] : [0, 7, 12];
    layer.pad.forEach((o, i) => o.frequency.setTargetAtTime(hz(A2, rootSemis + (chord[i] ?? 0)), t, 0.15));
  }

  function arpNote(freq: number, t: number, dur: number, gain: number): void {
    if (!layer) return;
    const o = e.osc('triangle', freq);
    const g = e.gain(FLOOR);
    if (!o || !g) return;
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
    o.connect(g);
    g.connect(layer.arpIn);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function scheduleStep(t: number): void {
    const inPhrase = step % (STEPS_PER_BAR * BARS_PER_PHRASE);
    if (inPhrase === 0) {
      motif = pick(MOTIFS, motif);
      prog = pick(PROGRESSIONS);
    }
    const bar = Math.floor(inPhrase / STEPS_PER_BAR);
    const s = inPhrase % STEPS_PER_BAR;
    const scale = tension ? SCALE_TENSE : SCALE_CALM;
    const rootDeg = prog[bar] ?? 0;
    if (s === 0) setPadChord(degreeSemis(scale, rootDeg) - 12 * Math.floor(rootDeg / 5), t);
    const deg = motif[s] ?? -1;
    const density = 0.35 + 0.55 * intensity + (tension ? 0.1 : 0);
    if (deg >= 0 && Math.random() < density) {
      const f = hz(ARP_BASE, degreeSemis(scale, deg + rootDeg));
      const g = 0.035 + 0.03 * intensity;
      arpNote(f, t, EIGHTH * 0.9, g);
      // intensité haute : double-croche ornementale occasionnelle
      if (intensity > 0.5 && Math.random() < intensity * 0.4) {
        arpNote(hz(ARP_BASE, degreeSemis(scale, deg + rootDeg + 2)), t + EIGHTH / 2, EIGHTH * 0.45, g * 0.7);
      }
    }
    step++;
  }

  function tick(): void {
    const ctx = e.ctx;
    if (!ctx || !layer || !e.running || paused) return;
    // contexte resté suspendu : on ne rattrape pas le retard, on repart d'ici
    if (nextTime < ctx.currentTime - 0.2) nextTime = ctx.currentTime + 0.05;
    while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
      scheduleStep(nextTime);
      nextTime += EIGHTH;
    }
  }

  function clearTimers(): void {
    if (timer !== null) clearInterval(timer);
    if (startTimer !== null) clearTimeout(startTimer);
    timer = null;
    startTimer = null;
  }

  function begin(): void {
    startTimer = null;
    const ctx = e.ctx;
    if (!ctx || !e.running) return;
    if (!layer) layer = buildLayer();
    if (!layer) return;
    const t = ctx.currentTime;
    applyMix(t);
    layer.out.gain.cancelScheduledValues(t);
    layer.out.gain.setValueAtTime(Math.max(FLOOR, layer.out.gain.value), t);
    layer.out.gain.exponentialRampToValueAtTime(1, t + 3);
    step = 0;
    nextTime = t + 0.1;
    if (timer === null) timer = setInterval(tick, TICK_MS);
  }

  return {
    get playing() {
      return layer !== null && timer !== null;
    },
    start(delayS) {
      if (!e.running) return;
      if (layer && timer !== null) return;
      clearTimers();
      startTimer = setTimeout(begin, Math.max(0, delayS) * 1000);
    },
    stop(fadeS) {
      clearTimers();
      const ctx = e.ctx;
      if (!ctx || !layer) return;
      const t = ctx.currentTime;
      const g = layer.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(FLOOR, g.value), t);
      g.exponentialRampToValueAtTime(FLOOR, t + Math.max(0.05, fadeS));
      teardown(t + Math.max(0.05, fadeS) + 0.05);
    },
    resolve() {
      clearTimers();
      const ctx = e.ctx;
      if (!ctx || !layer) return;
      const t = ctx.currentTime;
      // pad vers la majeur (la, do#, mi), drone qui s'éteint, dernière arpège lente
      tension = false;
      layer.tensionGain.gain.setTargetAtTime(FLOOR, t, 0.3);
      const chord = [0, 4, 7];
      layer.pad.forEach((o, i) => o.frequency.setTargetAtTime(hz(A2 * 2, chord[i] ?? 0), t, 0.4));
      layer.padFilter.frequency.setTargetAtTime(900, t, 0.5);
      layer.padGain.gain.setTargetAtTime(0.06, t, 0.4);
      [0, 4, 7, 12].forEach((s, i) => arpNote(hz(440, s), t + 0.3 + i * 0.35, 0.9, 0.04));
      const g = layer.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(FLOOR, g.value), t);
      g.setValueAtTime(Math.max(FLOOR, g.value), t + 1.8);
      g.exponentialRampToValueAtTime(FLOOR, t + 5.5);
      teardown(t + 5.6);
    },
    setWave(wave) {
      intensity = Math.max(0, Math.min(1, (wave - 1) / 12));
      if (e.ctx) applyMix(e.ctx.currentTime);
    },
    setTension(on) {
      tension = on;
      if (e.ctx) applyMix(e.ctx.currentTime);
    },
    pause() {
      if (paused) return;
      paused = true;
      const ctx = e.ctx;
      if (!ctx || !layer) return;
      const t = ctx.currentTime;
      layer.out.gain.cancelScheduledValues(t);
      layer.out.gain.setTargetAtTime(FLOOR, t, 0.05);
    },
    resume() {
      if (!paused) return;
      paused = false;
      const ctx = e.ctx;
      if (!ctx || !layer) return;
      const t = ctx.currentTime;
      nextTime = t + 0.1;
      layer.out.gain.cancelScheduledValues(t);
      layer.out.gain.setTargetAtTime(1, t, 0.4);
    },
  };
}
