// Équilibrage des hybrides et de la Divine, accessibilité de la forge : configuration RÉELLE (dorée, contrats,
// pénalité d'éventail actifs), contrairement à sim.forge.test.ts (useNeutralFun).
import { describe, expect, it } from 'vitest';
import type { BallElement, MetaModifiers, VolleyBall } from '../core/types';
import { config, lowestBlockDir, newSim, protocolD, protocolDamage, shoot, type BalanceProtocol } from './test-helpers';

const CFG = config();
const ALL: BallElement[] = CFG.balls.defs.map((d) => d.id);
const BASE27: BallElement[] = CFG.balls.defs.filter((d) => d.family !== 'hybrid' && d.family !== 'divine').map((d) => d.id);
const FULL: Partial<MetaModifiers> = { bonusHp: 3, bonusStartBalls: 2, coinMultiplier: 1.3, unlockedElements: BASE27 };
const HYBRIDS: BallElement[] = CFG.balls.defs.filter((d) => d.family === 'hybrid').map((d) => d.id);

// ------------------------------------------------------------------------------------------------------
// Équilibrage (docs/HYBRIDS.md, « une forge doit rapporter ») : dégâts d'une volée de 5 balles relatifs à
// 5 pierres de rang I, sur trois protocoles (test-helpers.ts → protocolDamage) :
//  A : plateau normal, PV × 100 (rien ne plafonne) ; B : blocs remis à 2 000 / 2 000 PV avant chaque tir ;
//  C : réplique exacte du protocole QA tests/e2e/balls.spec.ts « forge rangs » (docs/qa/forge.md, FG-05).
// Bandes : A et B : hybride I ∈ [3 ; 4,5], III ∈ [6 ; 9] ; C : III ∈ [6 ; 9] (le rang I y est seulement
// journalisé : la pierre ne touche qu'une fois par tir sur ce plateau clairsemé) ; Divine ≤ 24 partout
// (balle ultime, décision 2026-10-17) et ≥ 6,5 × la run pierre sur plateau réel (protocole D).

describe('équilibrage des hybrides et de la Divine (relatif à 5 pierres de rang I)', () => {
  for (const proto of ['A', 'B', 'C'] as BalanceProtocol[]) {
    it(`protocole ${proto} : ${proto === 'C' ? '' : 'hybride I ∈ [3 ; 4,5], '}III ∈ [6 ; 9], Divine ≤ 24`, () => {
      const s1 = protocolDamage('stone', 1, proto);
      const lines: string[] = [];
      const bad: string[] = [];
      for (const el of HYBRIDS) {
        const r1 = protocolDamage(el, 1, proto) / s1;
        const r3 = protocolDamage(el, 3, proto) / s1;
        lines.push(`${el} ${r1.toFixed(2)}/${r3.toFixed(2)}`);
        if (proto !== 'C' && (r1 < 3 || r1 > 4.5)) bad.push(`${el} I ${r1.toFixed(2)}`);
        if (r3 < 6 || r3 > 9) bad.push(`${el} III ${r3.toFixed(2)}`);
      }
      const d = protocolDamage('divine', 1, proto) / s1;
      lines.push(`divine ${d.toFixed(2)}`);
      if (d > 24) bad.push(`divine ${d.toFixed(2)}`);
      console.log(`[balance hybrides ${proto}] ${lines.join(' | ')}`);
      expect(bad).toEqual([]);
    }, 300_000);
  }
});

describe('Divine sur plateau réel (protocole D, réplique de tests/e2e/forge.spec.ts (d))', () => {
  it('Divine + 3 pierres contre 4 pierres, même plateau de vague 4, meilleur tir sur 3 : ≥ 6,5× sur chacune des 5 graines', () => {
    const stones = (n: number): VolleyBall[] => Array.from({ length: n }, () => ({ element: 'stone' as BallElement, tier: 1 as const }));
    const seeds = ['forge-divine', 'div-d-1', 'div-d-2', 'div-d-3', 'div-d-4'];
    const ratios = seeds.map((s) => protocolD(s, [{ element: 'divine', tier: 1 }, ...stones(3)]) / Math.max(1, protocolD(s, stones(4))));
    console.log(`[divine plateau réel] ${seeds.map((s, i) => `${s} ${ratios[i]!.toFixed(2)}`).join(' | ')}`);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(6.5);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------------
// Test décisif : sur les mêmes 20 graines (méta complète, 27 éléments), un bot qui forge dès que possible (et
// achète le catalyseur) meurt en moyenne au moins 0,5 vague plus tard qu'un bot qui ne forge jamais. Les deux
// bots sont naïfs (récompense 0, vise le bloc le plus bas) ; le forgeur forge la paire de rangs les plus bas.

function deathWave(seed: string, forge: boolean, over: Partial<MetaModifiers>): number {
  const sim = newSim(seed, config(), over);
  for (let k = 0; k < 2000 && sim.state.phase !== 'gameover'; k++) {
    for (let g = 0; g < 10; g++) {
      const s = sim.state;
      if (s.phase === 'reward') sim.chooseReward(0);
      else if (s.phase === 'shop') {
        if (forge) {
          const ci = s.shop!.items.findIndex((it) => !it.sold && it.catalyst === true);
          if (sim.forgeOptions().length === 0 && ci >= 0 && s.coins >= s.shop!.items[ci]!.price) sim.buy(ci);
          for (let f = 0; f < 5; f++) {
            const v = sim.state.volley;
            const opts = sim.forgeOptions().filter((o) => o.cost <= sim.state.coins);
            if (opts.length === 0) break;
            opts.sort((a, b) => v[a.i]!.tier + v[a.j]!.tier - (v[b.i]!.tier + v[b.j]!.tier));
            if (!sim.forge(opts[0]!.i, opts[0]!.j)) break;
          }
        }
        sim.leaveShop();
      } else break;
    }
    if (sim.state.phase !== 'aiming') break;
    shoot(sim, lowestBlockDir(sim));
  }
  return sim.state.wave;
}

describe('une forge doit rapporter', () => {
  const scenarios: [string, Partial<MetaModifiers>][] = [
    ['méta complète', FULL],
    ['sans méta, pool standard (FG-03)', { unlockedElements: BASE27 }],
  ];
  for (const [name, over] of scenarios) {
    it(`${name}, mêmes 20 graines : forger dès que possible ≥ ne jamais forger + 0,5 vague de mort moyenne`, () => {
      const forge: number[] = [];
      const never: number[] = [];
      for (let i = 0; i < 20; i++) {
        forge.push(deathWave(`dec-${i}`, true, over));
        never.push(deathWave(`dec-${i}`, false, over));
      }
      const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
      console.log(`[forge décisif ${name}] forge ${mean(forge).toFixed(2)} (${forge.join(',')}) | jamais ${mean(never).toFixed(2)} (${never.join(',')})`);
      expect(Math.max(...forge)).toBeLessThanOrEqual(35);
      expect(mean(forge)).toBeGreaterThanOrEqual(mean(never) + 0.5);
    }, 600_000);
  }
});

// ------------------------------------------------------------------------------------------------------
// Accessibilité de la forge : bot naïf (récompense 0, vise le bloc le plus bas) qui, en boutique, forge si
// possible, sinon achète le catalyseur s'il en a les moyens puis forge. 20 seeds, 27 éléments.

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
