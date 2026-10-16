// audio/mixer.ts — propriétaire : audio-dev.
// Limiteur de polyphonie : au plus MAX_PER_WINDOW déclenchements par fenêtre de WINDOW_MS.
// Priorités par réservation : les rebonds (priorité 0) ne peuvent prendre que les premières
// places, les block:hit (1) un peu plus, le reste (2) toutes. Ainsi une rafale de 30 balles
// qui rebondissent ne peut jamais affamer un block:destroyed ou un combo:milestone.
// Garde-fou supplémentaire : plafond de voix simultanées.

export const WINDOW_MS = 50;
export const MAX_PER_WINDOW = 12;
/** places cumulées accessibles à chaque priorité dans une fenêtre */
const CAP_BY_PRIORITY = [6, 9, MAX_PER_WINDOW] as const;
/** au-delà, seules les priorités 2 passent encore */
const MAX_VOICES = 48;

export type Priority = 0 | 1 | 2;

export interface MixerStats {
  accepted: number;
  dropped: number;
  /** maximum de déclenchements acceptés dans une même fenêtre */
  maxInWindow: number;
}

export interface Mixer {
  /** true si le son peut être joué maintenant (et le comptabilise) */
  admit(priority: Priority, nowMs: number, voicesActive: number): boolean;
  readonly stats: MixerStats;
}

export function createMixer(): Mixer {
  let windowStart = -Infinity;
  let used = 0;
  const stats: MixerStats = { accepted: 0, dropped: 0, maxInWindow: 0 };
  return {
    stats,
    admit(priority, nowMs, voicesActive) {
      if (nowMs - windowStart >= WINDOW_MS) {
        windowStart = nowMs;
        used = 0;
      }
      const cap = CAP_BY_PRIORITY[priority];
      if (used >= cap || (priority < 2 && voicesActive >= MAX_VOICES)) {
        stats.dropped++;
        return false;
      }
      used++;
      stats.accepted++;
      if (used > stats.maxInWindow) stats.maxInWindow = used;
      return true;
    },
  };
}
