// systems/daily.ts — défi quotidien : clé de date locale, seed, historique.
import type { DailyResult } from '../core/types';

/** Nombre max d'entrées conservées (DESIGN §4 : historique des 30 derniers jours). */
export const DAILY_HISTORY = 30;

const pad = (n: number): string => String(n).padStart(2, '0');

/** YYYY-MM-DD en heure locale. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Seed lisible et déterministe ; la sim la hache via createRng (core/rng hashString). */
export function dailySeedFor(date: string): string {
  return `daily-${date}`;
}

/** Enregistre un résultat en gardant le meilleur score du jour ; élague au-delà de DAILY_HISTORY dates. */
export function recordDaily(daily: Readonly<Record<string, DailyResult>>, date: string, res: DailyResult): Record<string, DailyResult> {
  const prev = daily[date];
  const out: Record<string, DailyResult> = { ...daily };
  if (!prev || res.score > prev.score) out[date] = res;
  const keys = Object.keys(out).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAILY_HISTORY))) delete out[k];
  return out;
}
