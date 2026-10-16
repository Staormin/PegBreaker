// audio/analysis.ts — propriétaire : audio-dev. Mesures objectives d'un rendu (pur, testable sous Node).

export interface RenderAnalysis {
  /** pic absolu (tous canaux) */
  peak: number;
  peakDb: number;
  /** RMS global (dBFS) */
  rmsDb: number;
  /** RMS par mesure (dBFS), à partir de `startS` */
  barRmsDb: number[];
  /** plus grand écart de RMS entre deux mesures voisines (dB) */
  maxBarJumpDb: number;
  /** plus long passage sous le seuil de silence, après `startS` (s) */
  maxSilenceS: number;
}

const SILENCE_DB = -60;
const WINDOW_S = 0.05;

export const toDb = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);

export function analyseChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  barSeconds: number,
  startS = 0,
): RenderAnalysis {
  const len = channels[0]?.length ?? 0;
  let peak = 0;
  let sum = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] ?? 0;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, len * channels.length));

  const rmsOf = (a: number, b: number): number => {
    let s = 0;
    let n = 0;
    for (const ch of channels) {
      for (let i = a; i < b && i < ch.length; i++) {
        const v = ch[i] ?? 0;
        s += v * v;
        n++;
      }
    }
    return n > 0 ? Math.sqrt(s / n) : 0;
  };

  const start = Math.floor(startS * sampleRate);
  const barN = Math.floor(barSeconds * sampleRate);
  const barRmsDb: number[] = [];
  for (let a = start; a + barN <= len; a += barN) barRmsDb.push(toDb(rmsOf(a, a + barN)));
  let maxBarJumpDb = 0;
  for (let i = 1; i < barRmsDb.length; i++) {
    const d = Math.abs((barRmsDb[i] ?? 0) - (barRmsDb[i - 1] ?? 0));
    if (d > maxBarJumpDb) maxBarJumpDb = d;
  }

  const win = Math.max(1, Math.floor(WINDOW_S * sampleRate));
  let run = 0;
  let maxSilence = 0;
  for (let a = start; a < len; a += win) {
    if (toDb(rmsOf(a, a + win)) < SILENCE_DB) {
      run += Math.min(win, len - a) / sampleRate;
      if (run > maxSilence) maxSilence = run;
    } else run = 0;
  }
  return { peak, peakDb: toDb(peak), rmsDb: toDb(rms), barRmsDb, maxBarJumpDb, maxSilenceS: maxSilence };
}
