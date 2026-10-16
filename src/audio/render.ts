// audio/render.ts — propriétaire : audio-dev. Rendu hors temps réel d'une piste (navigateur :
// OfflineAudioContext). Sert à l'export WAV de la preview et à la validation Playwright.
// Même code que le jeu (score + synth) : seule l'horloge diffère (toutes les mesures planifiées d'avance).
import type { MusicTrackId } from '../core/types';
import { analyseChannels, type RenderAnalysis } from './analysis';
import { layersFor } from './music';
import { secondsPerBar } from './score';
import { createRig, createTrackBus, planBar } from './synth';
import { TRACKS } from './tracks';
import { encodeWav } from './wav';

/** gain de la musique dans le jeu par défaut : volume musique 0,5 × bus master 0,8 */
export const GAME_MUSIC_GAIN = 0.5 * 0.8;
const START_S = 0.05;

export interface RenderOptions {
  track: MusicTrackId;
  seconds: number;
  wave: number;
  boss: boolean;
  sampleRate?: number;
  gain?: number;
  /** échantillonne un AnalyserNode toutes les 50 ms pendant le rendu */
  analyser?: boolean;
}

export interface AnalyserReport {
  /** pic vu par l'AnalyserNode */
  peak: number;
  /** RMS (dBFS) par mesure vu par l'AnalyserNode */
  barRmsDb: number[];
  samples: number;
}

export interface RenderResult {
  buffer: AudioBuffer;
  barSeconds: number;
  /** mesures du buffer rendu (exactes) */
  analysis: RenderAnalysis;
  analyser: AnalyserReport | null;
}

type OfflineCtor = typeof OfflineAudioContext;

export function offlineAvailable(): boolean {
  return typeof globalThis !== 'undefined' && typeof (globalThis as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext === 'function';
}

export async function renderMusic(o: RenderOptions): Promise<RenderResult> {
  const Ctor = (globalThis as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext;
  if (!Ctor) throw new Error('OfflineAudioContext indisponible');
  const sr = o.sampleRate ?? 44100;
  const ctx = new Ctor(2, Math.ceil(sr * o.seconds), sr);
  const out = ctx.createGain();
  out.gain.value = o.gain ?? GAME_MUSIC_GAIN;
  out.connect(ctx.destination);
  const rig = createRig(ctx, out, (n) => n);
  const def = TRACKS[o.track];
  const bus = createTrackBus(rig, def, 1);
  const barS = secondsPerBar(def);
  const opts = { ...layersFor(o.wave), boss: o.boss, rand: Math.random };
  for (let bar = 0, t = START_S; t < o.seconds; bar++, t += barS) planBar(rig, bus, bar, t, opts);

  let report: AnalyserReport | null = null;
  if (o.analyser) {
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    out.connect(an);
    const buf = new Float32Array(an.fftSize);
    const step = 0.05;
    const perBar = new Map<number, { s: number; n: number }>();
    const r: AnalyserReport = { peak: 0, barRmsDb: [], samples: 0 };
    for (let t = step; t < o.seconds - step; t += step) {
      const at = t;
      void ctx.suspend(at).then(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i] ?? 0;
          if (Math.abs(v) > r.peak) r.peak = Math.abs(v);
          s += v * v;
        }
        const b = Math.floor((at - START_S) / barS);
        const acc = perBar.get(b) ?? { s: 0, n: 0 };
        acc.s += s;
        acc.n += buf.length;
        perBar.set(b, acc);
        r.samples++;
        void ctx.resume();
      });
    }
    report = r;
    const rendered = await ctx.startRendering();
    const bars = [...perBar.keys()].filter((b) => b >= 0).sort((a, b) => a - b);
    // dernière mesure incomplète exclue
    for (const b of bars) {
      if ((b + 1) * barS + START_S > o.seconds) continue;
      const acc = perBar.get(b);
      if (acc) r.barRmsDb.push(20 * Math.log10(Math.sqrt(acc.s / Math.max(1, acc.n)) || 1e-9));
    }
    return { buffer: rendered, barSeconds: barS, analysis: analyse(rendered, barS), analyser: report };
  }
  const rendered = await ctx.startRendering();
  return { buffer: rendered, barSeconds: barS, analysis: analyse(rendered, barS), analyser: null };
}

function analyse(b: AudioBuffer, barS: number): RenderAnalysis {
  const chans: Float32Array[] = [];
  for (let c = 0; c < b.numberOfChannels; c++) chans.push(b.getChannelData(c));
  // les mesures complètes à partir du début de la musique
  const a = analyseChannels(chans, b.sampleRate, barS, START_S);
  return a;
}

/** rendu WAV normalisé à −1 dBFS (écoute hors jeu) */
export async function exportWav(track: MusicTrackId, seconds: number, wave: number, boss: boolean): Promise<Blob> {
  const r = await renderMusic({ track, seconds, wave, boss, gain: 1 });
  const chans: Float32Array[] = [];
  for (let c = 0; c < r.buffer.numberOfChannels; c++) chans.push(r.buffer.getChannelData(c));
  const k = r.analysis.peak > 0 ? 0.89 / r.analysis.peak : 1;
  for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] ?? 0) * k;
  return encodeWav(chans, r.buffer.sampleRate);
}
