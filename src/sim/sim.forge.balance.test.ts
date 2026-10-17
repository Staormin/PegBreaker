// Équilibrage des hybrides et de la Divine, accessibilité de la forge : configuration RÉELLE (dorée, contrats,
// pénalité d'éventail actifs), contrairement à sim.forge.test.ts (useNeutralFun).
import { describe, expect, it } from 'vitest';
import type { BallElement, BallTier, MetaModifiers, VolleyBall } from '../core/types';
import { config, lowestBlockDir, mut, newSim, shoot } from './test-helpers';

const CFG = config();
const ALL: BallElement[] = CFG.balls.defs.map((d) => d.id);
const BASE27: BallElement[] = CFG.balls.defs.filter((d) => d.family !== 'hybrid' && d.family !== 'divine').map((d) => d.id);
const HYBRIDS: BallElement[] = CFG.balls.defs.filter((d) => d.family === 'hybrid').map((d) => d.id);
function vb(element: BallElement, tier: BallTier, n = 1): VolleyBall[] {
  return Array.from({ length: n }, () => ({ element, tier }));
}

// ------------------------------------------------------------------------------------------------------
// Équilibrage (docs/HYBRIDS.md, « Équilibrage visé ») : bot naïf (vise le bloc le plus bas), volée de départ
// (5 balles) entièrement de l'élément mesuré, remise avant chaque tir ; 10 seeds × 15 tirs ; PV des blocs
// × 4 × tierDamageMultiplier^(rang−1) (l'excès de dégâts ne plafonne pas les balles fortes) ; PV joueur 999.
// Ratio = dégâts moyens par tir / ceux de 5 pierres au même rang (Divine : contre 5 pierres de rang III).

function meanShotDamage(el: BallElement, tier: BallTier, hpTier: number): number {
  let tot = 0;
  let n = 0;
  for (let s = 0; s < 10; s++) {
    const c = config();
    c.waves.start.hp = 999;
    const k = 4 * Math.pow(c.balls.tierDamageMultiplier, hpTier - 1);
    for (const p of c.waves.hpByWave!) p.baseHp *= k;
    const sim = newSim(`bal-${s}`, c, { unlockedElements: ALL });
    for (let shot = 0; shot < 15 && sim.state.phase !== 'gameover'; shot++) {
      for (let g = 0; g < 10; g++) {
        const p = sim.state.phase;
        if (p === 'reward') sim.skipReward();
        else if (p === 'shop') sim.leaveShop();
        else break;
      }
      if (sim.state.phase !== 'aiming') break;
      mut(sim).volley = vb(el, tier, 5);
      for (const e of shoot(sim, lowestBlockDir(sim))) {
        if (e.type === 'volley:end') {
          tot += e.shotDamage;
          n++;
        }
      }
    }
  }
  return tot / n;
}

describe('équilibrage des hybrides et de la Divine (relatif à la pierre)', () => {
  it('hybride rang I ∈ [1,5 ; 2], rang III ∈ [2,3 ; 3,7], Divine ∈ [5 ; 6] × la pierre III', () => {
    const s1 = meanShotDamage('stone', 1, 1);
    const s3 = meanShotDamage('stone', 3, 3);
    const lines: string[] = [];
    const bad: string[] = [];
    for (const el of HYBRIDS) {
      const r1 = meanShotDamage(el, 1, 1) / s1;
      const r3 = meanShotDamage(el, 3, 3) / s3;
      lines.push(`${el} ${r1.toFixed(2)}/${r3.toFixed(2)}`);
      if (r1 < 1.5 || r1 > 2) bad.push(`${el} I ${r1.toFixed(2)}`);
      if (r3 < 2.3 || r3 > 3.7) bad.push(`${el} III ${r3.toFixed(2)}`);
    }
    const d = meanShotDamage('divine', 1, 3) / s3;
    lines.push(`divine ${d.toFixed(2)}`);
    if (d < 5 || d > 6) bad.push(`divine ${d.toFixed(2)}`);
    console.log(`[balance hybrides] ${lines.join(' | ')}`);
    expect(bad).toEqual([]);
  }, 300_000);
});

// ------------------------------------------------------------------------------------------------------
// Accessibilité de la forge : bot naïf (récompense 0, vise le bloc le plus bas) qui, en boutique, forge si
// possible, sinon achète le catalyseur s'il en a les moyens puis forge. 20 seeds, 27 éléments.

const FULL: Partial<MetaModifiers> = { bonusHp: 3, bonusStartBalls: 2, coinMultiplier: 1.3, unlockedElements: BASE27 };

function accessRun(seed: string, over: Partial<MetaModifiers>): { shops: number; open: number; forged: number } {
  const sim = newSim(seed, config(), over);
  const cat = CFG.economy.forge.catalystCost;
  let shops = 0;
  let open = 0;
  let forged = 0;
  for (let k = 0; k < 600 && sim.state.phase !== 'gameover'; k++) {
    for (let g = 0; g < 10; g++) {
      const s = sim.state;
      if (s.phase === 'reward') sim.chooseReward(0);
      else if (s.phase === 'shop') {
        shops++;
        const items = s.shop!.items;
        const ci = items.findIndex((it) => !it.sold && it.catalyst === true);
        if (sim.forgeOptions().length > 0 || ci >= 0) open++;
        if (sim.forgeOptions().length === 0 && ci >= 0 && s.coins >= cat) sim.buy(ci);
        const o = sim.forgeOptions()[0];
        if (o && sim.forge(o.i, o.j)) forged++;
        sim.leaveShop();
      } else break;
    }
    if (sim.state.phase !== 'aiming') break;
    shoot(sim, lowestBlockDir(sim));
  }
  return { shops, open, forged };
}

describe('accessibilité de la forge (catalyseur)', () => {
  const runs = (over: Partial<MetaModifiers>): { shops: number; open: number; runsForged: number } => {
    let shops = 0;
    let open = 0;
    let runsForged = 0;
    for (let i = 0; i < 20; i++) {
      const r = accessRun(`access-${i}`, over);
      shops += r.shops;
      open += r.open;
      if (r.forged > 0) runsForged++;
    }
    return { shops, open, runsForged };
  };

  // Règle « un parent ≥ II + l'autre ≥ I », catalyseur dès un parent présent (docs/HYBRIDS.md, décision 2026-10-17).
  it('méta complète : forge ou catalyseur dans ≥ 50 % des boutiques, ≥ 8 runs sur 20 forgent', () => {
    const r = runs(FULL);
    console.log(`[forge accès méta] boutiques ${r.shops}, ouvertes ${r.open} (${((100 * r.open) / r.shops).toFixed(0)} %), runs qui forgent ${r.runsForged}/20`);
    expect(r.open / r.shops).toBeGreaterThanOrEqual(0.5);
    expect(r.runsForged).toBeGreaterThanOrEqual(8);
  }, 300_000);

  it('sans méta : au moins 1 run sur 20 forge', () => {
    const r = runs({ unlockedElements: BASE27 });
    console.log(`[forge accès sans méta] boutiques ${r.shops}, ouvertes ${r.open}, runs qui forgent ${r.runsForged}/20`);
    expect(r.runsForged).toBeGreaterThanOrEqual(1);
  }, 300_000);
});
