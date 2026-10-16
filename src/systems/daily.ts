// systems/daily.ts — défi quotidien : clé de date locale, seed, historique.
import { createRng, hashString } from '../core/rng';
import type { DailyResult, RunModDef } from '../core/types';

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

/** Paires de mutateurs qui se contredisent (glass : 1 PV max ; rich : PV réduits contre des pièces). */
export const INCOMPATIBLE_MODS: readonly (readonly [string, string])[] = [['glass', 'rich']];

const clash = (a: string, b: string): boolean => INCOMPATIBLE_MODS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

/**
 * 2 mutateurs distincts tirés parmi les runMods `dailyEligible` (ordre de meta.json),
 * rng = createRng(hashString('daily-mods-' + date)). Paire incompatible : le second est
 * retiré parmi les mods restants compatibles. Moins de 2 éligibles : tous ceux disponibles.
 */
export function pickDailyMods(defs: readonly RunModDef[], date: string): string[] {
  const pool = defs.filter((d) => d.dailyEligible === true).map((d) => d.id);
  const rng = createRng(hashString(`daily-mods-${date}`));
  const first = pool.splice(rng.int(0, pool.length - 1), 1)[0];
  if (first === undefined) return [];
  if (pool.length === 0) return [first];
  let second = pool.splice(rng.int(0, pool.length - 1), 1)[0] ?? '';
  if (clash(first, second)) {
    const ok = pool.filter((id) => !clash(first, id));
    if (ok.length === 0) return [first];
    second = ok[rng.int(0, ok.length - 1)] ?? '';
  }
  return [first, second];
}

/** Veille d'une clé YYYY-MM-DD (calendrier pur, en UTC : pas d'effet heure d'été). */
export function previousDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Jours consécutifs joués en remontant depuis `date` (ou depuis la veille si `date` n'est pas joué). */
export function streakAt(daily: Readonly<Record<string, DailyResult>>, date: string): number {
  let day = daily[date] ? date : previousDay(date);
  let n = 0;
  while (daily[day] && n < 10000) {
    n++;
    day = previousDay(day);
  }
  return n;
}

/** 1 + 0,1 × (série − 1), plafonné à 2 (FUN.md F8). */
export function streakMultiplier(streak: number): number {
  const k = Number.isFinite(streak) ? Math.max(0, Math.floor(streak) - 1) : 0;
  return Math.min(2, Math.round((1 + 0.1 * k) * 1e6) / 1e6);
}

/**
 * Enregistre un résultat en gardant le meilleur score du jour (depth, score, completedAt) ;
 * `mods` et `streak` sont toujours ceux du dernier résultat. Élague au-delà de DAILY_HISTORY dates.
 */
export function recordDaily(daily: Readonly<Record<string, DailyResult>>, date: string, res: DailyResult): Record<string, DailyResult> {
  const prev = daily[date];
  const out: Record<string, DailyResult> = { ...daily };
  if (!prev || res.score > prev.score) out[date] = res;
  else {
    const kept: DailyResult = { ...prev };
    if (res.mods !== undefined) kept.mods = res.mods;
    if (res.streak !== undefined) kept.streak = res.streak;
    out[date] = kept;
  }
  const keys = Object.keys(out).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAILY_HISTORY))) delete out[k];
  return out;
}
