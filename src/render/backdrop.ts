// render/backdrop.ts — fond statique posé en CSS sur le canvas (canvas transparent).
// Pourquoi : remplir 2 Mpx par frame (blit du fond + de la grille) coûtait ~30 ms à CPU 4×
// en raster logiciel. En CSS, le fond est composé par le navigateur, une fois.
// Les chaînes sont pré-calculées au resize / changement de vague : 16 niveaux de « lumière »
// (montée en puissance du tir) → aucun travail ni allocation par frame, juste un swap de style
// quand le niveau change.
import type { Layout } from './layout';
import { mixHex, PALETTE } from './palette';

export const POWER_LEVELS = 16;

/** Teinte de profondeur : bg1 tire vers le violet avec la vague (plafonné, très subtil). */
function depthTint(wave: number): number {
  const t = (wave - 1) / 14;
  return (t < 0 ? 0 : t > 1 ? 1 : t) * 0.75;
}

export function buildBackdrops(l: Layout, wave: number): string[] {
  const t = depthTint(wave);
  const bg0 = mixHex(PALETTE.bg0, '#120a1e', t * 0.6);
  const bg1 = mixHex(PALETTE.bg1, '#2a1642', t);
  const bw = l.cols * l.scale, bh = l.rows * l.scale;
  const panel = `linear-gradient(rgba(11,15,26,0.55), rgba(11,15,26,0.55)) ${l.offX.toFixed(1)}px ${l.offY.toFixed(1)}px / ${bw.toFixed(1)}px ${bh.toFixed(1)}px no-repeat`;
  const base = `linear-gradient(${bg0}, ${bg1})`;
  const cx = l.offX + bw / 2, cy = l.offY + bh * 0.82;
  const out: string[] = [];
  for (let i = 0; i < POWER_LEVELS; i++) {
    if (i === 0) { out.push(`${panel}, ${base}`); continue; }
    const k = i / (POWER_LEVELS - 1);
    const a = (0.2 * k).toFixed(3);
    const a2 = (0.09 * k).toFixed(3);
    // lumière chaude qui monte du bas du plateau + léger liseré doré autour du plateau
    const glow = `radial-gradient(${(bw * 0.8).toFixed(0)}px ${(bh * (0.5 + 0.25 * k)).toFixed(0)}px at ${cx.toFixed(0)}px ${cy.toFixed(0)}px, rgba(255,190,110,${a}) 0%, rgba(255,190,110,0) 100%) 0 0 / 100% 100% no-repeat`;
    const rim = `radial-gradient(${(bw * 0.75).toFixed(0)}px ${(bh * 0.62).toFixed(0)}px at ${cx.toFixed(0)}px ${(l.offY + bh / 2).toFixed(0)}px, rgba(255,233,92,0) 70%, rgba(255,233,92,${a2}) 100%) 0 0 / 100% 100% no-repeat`;
    out.push(`${glow}, ${rim}, ${panel}, ${base}`);
  }
  return out;
}

/** Niveau 0..15 à partir des dégâts du tir (log : 50 → bas, 16 000 → max). */
export function powerTarget(shotDamage: number): number {
  if (shotDamage <= 30) return 0;
  const v = (Math.log10(shotDamage) - 1.5) / 2.7; // ~30 → 0 ; ~16 000 → 1
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
