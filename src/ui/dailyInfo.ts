// ui/dailyInfo.ts — F8 : données d'affichage du quotidien muté (mutateurs, série, multiplicateur).
// Lecture seule de MetaSystem (dailyMods / dailyStreak / dailyStreakMultiplier) et de config.meta.runMods.
import type { GameConfig, MetaSystem, RunModDef } from '../core/types';
import { el } from './dom';

/** icône texte par id de mutateur (pas d'image ; repli « ✦ ») */
const MOD_GLYPH: Record<string, string> = {
  glass: '◇',
  rush: '⇊',
  inferno: '✹',
  armored: '▣',
  swift: '»',
  rich: '¤',
  pegfest: '⁘',
  heavy: '▼',
};
const MOD_COLOR: Record<string, string> = {
  glass: '#8fe3ff',
  rush: '#ff9d5c',
  inferno: '#ff6a3d',
  armored: '#b8c2d6',
  swift: '#5cff9d',
  rich: '#ffe95c',
  pegfest: '#ff7ab8',
  heavy: '#c08cff',
};

export interface ModView {
  id: string;
  name: string;
  description: string;
  fragmentMultiplier: number;
  glyph: string;
  color: string;
}

export function modView(config: GameConfig, id: string): ModView {
  const def: RunModDef | undefined = config.meta.runMods.find((m) => m.id === id);
  return {
    id,
    name: def?.name ?? id,
    description: def?.description ?? '',
    fragmentMultiplier: def?.fragmentMultiplier ?? 1,
    glyph: MOD_GLYPH[id] ?? '✦',
    color: MOD_COLOR[id] ?? '#e8ecf5',
  };
}

/** mutateurs du jour (vide si la méta ne les fournit pas encore) */
export function dailyModViews(config: GameConfig, meta: MetaSystem, date?: string): ModView[] {
  const ids = typeof meta.dailyMods === 'function' ? meta.dailyMods(date) : [];
  return ids.map((id) => modView(config, id));
}

export function streakOf(meta: MetaSystem, date?: string): number {
  return typeof meta.dailyStreak === 'function' ? Math.max(0, meta.dailyStreak(date)) : 0;
}

export function streakMult(meta: MetaSystem, streak: number): number {
  return typeof meta.dailyStreakMultiplier === 'function' ? meta.dailyStreakMultiplier(Math.max(1, streak)) : 1;
}

const multFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
export function fmtMult(m: number): string {
  return `×${multFmt.format(Math.round(m * 100) / 100)}`;
}
export function fmtDays(n: number): string {
  return `${n} jour${n > 1 ? 's' : ''}`;
}

/** 'YYYY-MM-DD' → Date locale à midi (évite les bascules de fuseau) */
export function parseKey(k: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}
export function keyOf(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** les `n` derniers jours (du plus ancien à `today` inclus) */
export function lastDays(today: string, n: number): string[] {
  const t = parseKey(today);
  if (!t) return [today];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(keyOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() - i, 12)));
  return out;
}

/** pastille de mutateur : icône seule, nom + description au survol et pour les lecteurs d'écran */
export function modChip(v: ModView, className = 'mod-chip'): HTMLSpanElement {
  const chip = el('span', className, v.glyph);
  chip.dataset.mod = v.id;
  chip.style.setProperty('--mc', v.color);
  chip.setAttribute('role', 'img');
  const label = v.description ? `${v.name} : ${v.description}` : v.name;
  chip.setAttribute('aria-label', label);
  chip.title = label;
  return chip;
}
