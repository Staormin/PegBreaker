// sim/mods.ts — mutateurs de run (MetaModifiers.runMods, ids de meta.json → runMods).
// Les effets chiffrés vivent dans waves.json → runModEffects (clé non typée dans core/types.ts, demande faite) ;
// les valeurs de repli ci-dessous ne servent que si la clé manque. Les mods sont cumulables : les
// multiplicateurs se multiplient, maxHp prend le plus petit plafond, advanceRows le plus grand.
import type { BallElement, BlockKind, GameConfig, MetaModifiers } from '../core/types';
import type { RunModEffect } from '../core/types';
export type { RunModEffect };

/** Effet d'un mod tel que déclaré dans waves.json → runModEffects[id]. */

/** Effets cumulés de tous les mods actifs (résolus une fois à la création de la sim). */
export interface ModEffects {
  maxHp: number;
  advanceRows: number;
  stoneBecomes: BallElement | null;
  ballSpeedMult: number;
  coinMult: number;
  blockHpMult: number;
  dropChanceMult: number;
  weightMult: Partial<Record<BlockKind, number>>;
  weightFloor: Partial<Record<BlockKind, number>>;
}

/** Repli si waves.json → runModEffects est absent (mêmes valeurs que le JSON livré). */
const FALLBACK_EFFECTS: Record<string, RunModEffect> = {
  glass: { maxHp: 1 },
  rush: { advanceRows: 2 },
  inferno: { stoneBecomes: 'fire' },
  armored: { weights: { armored: { mult: 3, floor: 8 } } },
  swift: { ballSpeedMult: 1.3 },
  rich: { coinMult: 2, maxHp: 3 },
  pegfest: { weights: { peg: { mult: 2.5 } } },
  heavy: { blockHpMult: 1.5, dropChanceMult: 2 },
};

function effectTable(cfg: GameConfig): Record<string, RunModEffect> {
  const t = (cfg.waves as unknown as { runModEffects?: Record<string, RunModEffect> }).runModEffects;
  return t ?? FALLBACK_EFFECTS;
}

export function resolveMods(cfg: GameConfig, meta: MetaModifiers): ModEffects {
  const out: ModEffects = {
    maxHp: Infinity,
    advanceRows: 1,
    stoneBecomes: null,
    ballSpeedMult: 1,
    coinMult: 1,
    blockHpMult: 1,
    dropChanceMult: 1,
    weightMult: {},
    weightFloor: {},
  };
  const table = effectTable(cfg);
  for (const id of meta.runMods ?? []) {
    const e = table[id];
    if (!e) continue;
    if (typeof e.maxHp === 'number') out.maxHp = Math.min(out.maxHp, e.maxHp);
    if (typeof e.advanceRows === 'number') out.advanceRows = Math.max(out.advanceRows, e.advanceRows);
    if (e.stoneBecomes) out.stoneBecomes = e.stoneBecomes;
    out.ballSpeedMult *= e.ballSpeedMult ?? 1;
    out.coinMult *= e.coinMult ?? 1;
    out.blockHpMult *= e.blockHpMult ?? 1;
    out.dropChanceMult *= e.dropChanceMult ?? 1;
    if (e.weights) {
      for (const k of Object.keys(e.weights) as BlockKind[]) {
        const w = e.weights[k];
        if (!w) continue;
        out.weightMult[k] = (out.weightMult[k] ?? 1) * (w.mult ?? 1);
        if (typeof w.floor === 'number') out.weightFloor[k] = Math.max(out.weightFloor[k] ?? 0, w.floor);
      }
    }
  }
  return out;
}

/** Élément effectif d'une balle ajoutée à la volée (mod inferno : pierre → feu). */
export function modElement(mods: ModEffects, el: BallElement): BallElement {
  return el === 'stone' && mods.stoneBecomes ? mods.stoneBecomes : el;
}
