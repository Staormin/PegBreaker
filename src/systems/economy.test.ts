// Sanity d'économie méta : bot « vise le bloc le plus bas » (sim réelle), achats gloutons
// du nœud le moins cher après chaque run. Cibles (brief T10) : 1er achat après 1-2 runs,
// arbre complet en 25-35 runs (T10c : 16 nœuds, total 1 910).
// Rééquilibrage sim 3d1593f (dorée progressive, contrats, hpByWave) : ~70 ◆/run, arbre en
// 21-24 runs → fin d'arbre relevée (total 1 910 → 2 300 : hp/coins niv. 2-3 70/140, balls 130,
// reroll 120, el_ice 280, el_ghost 240, el_lead 220, mitose/radar 115, berserk 165, glass 90,
// rush 155) → arbre en 25-36 runs, moyenne ~29.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config';
import type { GameConfig, RunSummary } from '../core/types';
import { createRng } from '../core/rng';
import { createSim } from '../sim/index';
import { FRAME, lowestBlockDir, settle } from '../sim/test-helpers';
import { createMemoryStorage, createMeta, nextCost, reviveCost } from './index';

/**
 * Joue une run complète. Le bot ignore les contrats (il vise toujours le bloc le plus bas) mais
 * en touche les récompenses quand il les remplit par hasard. À la mort (phase gameover après
 * run:lost) : `onLost()` décide de la revanche (true → sim.revive()), sinon giveUp() → run:over.
 */
function playRun(cfg: GameConfig, seed: string, meta: ReturnType<typeof createMeta>, onLost: () => boolean = () => false): RunSummary {
  const sim = createSim(cfg, { seed, meta: meta.getModifiers() });
  const rng = createRng(seed);
  let lastWave = 0;
  let sinceWave = 0;
  for (let shots = 0; shots < 1200; shots++) {
    settle(sim);
    if (sim.state.phase === 'gameover') {
      // onLost (qui paie) n'est consulté que si la sim accepte encore une revanche.
      const canRevive = sim.state.revivesUsed < cfg.economy.revive.maxPerRun;
      if (canRevive && onLost()) {
        if (!sim.revive()) throw new Error(`run ${seed} : revive refusé`);
        sim.step(0); // purge run:revived
        continue;
      }
      sim.giveUp();
      for (const e of sim.step(0)) if (e.type === 'run:over') return e.summary;
      throw new Error(`run ${seed} : giveUp sans run:over`);
    }
    if (sim.state.wave !== lastWave) {
      lastWave = sim.state.wave;
      sinceWave = 0;
    }
    // Anti-blocage : après 20 tirs dans la même vague, visée aléatoire (voir rapport :
    // un bloc blindé gelé en rangée 8 peut bloquer indéfiniment le bot « plus bas »).
    const a = rng.range(0.2, Math.PI - 0.2);
    sim.aim(++sinceWave > 20 ? { x: Math.cos(a), y: -Math.sin(a) } : lowestBlockDir(sim));
    sim.fire();
    for (let f = 0; f < 5000; f++) {
      for (const e of sim.step(FRAME)) if (e.type === 'run:over') return e.summary;
      const p = sim.state.phase;
      if (p !== 'firing' && p !== 'advancing') break;
    }
  }
  throw new Error(`run ${seed} sans fin : vague ${sim.state.wave}, profondeur ${sim.state.depth}`);
}

/** Achète le nœud achetable le moins cher, tant que possible. Renvoie le nombre d'achats. */
function buyGreedy(cfg: GameConfig, meta: ReturnType<typeof createMeta>): number {
  let n = 0;
  for (;;) {
    const opts = cfg.meta.nodes
      .filter((x) => meta.canBuyNode(x.id))
      .map((x) => ({ id: x.id, cost: nextCost(x, meta.data.meta.nodes[x.id] ?? 0) ?? Infinity }))
      .sort((a, b) => a.cost - b.cost);
    const best = opts[0];
    if (!best || !meta.buyNode(best.id)) return n;
    n++;
  }
}

const complete = (cfg: GameConfig, meta: ReturnType<typeof createMeta>): boolean =>
  cfg.meta.nodes.every((n) => (meta.data.meta.nodes[n.id] ?? 0) >= n.costs.length);

describe('économie méta', () => {
  it('1er achat après ≤ 2 runs, arbre complet en 22-38 runs, moyenne 26-34 ; run 1 médiane ≤ 4 succès (5 joueurs simulés)', () => {
    const cfg = structuredClone(loadConfig());
    const firstBuy: number[] = [];
    const full: number[] = [];
    const perRun: number[] = [];
    const log: string[] = [];
    const run1Ach: number[] = [];
    for (let p = 0; p < 5; p++) {
      const meta = createMeta(createMemoryStorage(), cfg, () => new Date(2026, 9, 16));
      let first = 0;
      let runs = 0;
      while (!complete(cfg, meta) && runs < 60) {
        const s = playRun(cfg, `eco-${p}-${runs}`, meta);
        runs++;
        perRun.push(s.stats.fragmentsEarned);
        const ach = meta.onRunEnd(s);
        if (runs === 1) {
          run1Ach.push(ach.length);
          log.push(`J${p} run1: ${s.stats.fragmentsEarned} ◆ run + ${meta.data.meta.fragments - s.stats.fragmentsEarned} ◆ succès [${ach.join(',')}]`);
        }
        if (runs === 5) log.push(`J${p} 5 runs: ${meta.data.stats.totalFragments} ◆ dont succès ${meta.data.stats.totalFragments - perRun.slice(-5).reduce((a, b) => a + b, 0)} ◆, ${meta.data.achievements.length} succès`);
        if (buyGreedy(cfg, meta) > 0 && first === 0) first = runs;
      }
      firstBuy.push(first);
      full.push(runs);
    }
    const mean = perRun.reduce((a, b) => a + b, 0) / perRun.length;
    console.log(log.join('\n'));
    console.log(`[economy] 1er achat: run ${firstBuy.join(',')} | arbre complet: ${full.join(',')} runs | fragments/run moyen ${mean.toFixed(1)} (min ${Math.min(...perRun)}, max ${Math.max(...perRun)})`);
    // Run 1 bimodale (QA J3-02) : une run courte débloque 1-2 succès, une longue jusqu'à 10.
    const med = [...run1Ach].sort((a, b) => a - b)[Math.floor(run1Ach.length / 2)] ?? 0;
    expect(med).toBeGreaterThanOrEqual(1);
    expect(med).toBeLessThanOrEqual(4);
    for (const f of firstBuy) expect(f).toBeGreaterThanOrEqual(1);
    for (const f of firstBuy) expect(f).toBeLessThanOrEqual(2);
    for (const r of full) {
      expect(r).toBeGreaterThanOrEqual(22);
      expect(r).toBeLessThanOrEqual(38);
    }
    const avgFull = full.reduce((a, b) => a + b, 0) / full.length;
    expect(avgFull).toBeGreaterThanOrEqual(26);
    expect(avgFull).toBeLessThanOrEqual(34);
  }, 120_000);
});

// Seconde chance (FUN.md F4, economy.revive). Cible : un joueur moyen peut se payer une
// revanche environ une run sur deux sans ralentir sensiblement le Puits.
// Mesure lot 1 (sim avec contrats, balle dorée et revive ; bot « plus bas » qui ignore les
// contrats, 5 joueurs) : ~63 ◆/run sans revanche (min 26), ~68 ◆/run en se payant une
// revanche une run sur deux (les vagues rejouées rapportent ~+11 ◆ par run reprise).
// revive.cost 25 → 30 : à 25 (0,37 run) la revanche était presque autofinancée (payée 70 %
// du temps, arbre inchangé) ; à 30 (0,44 run) elle est payée ~63 % du temps, arbre en 26-32
// runs (25-30 sans revanche). Au-delà de 35, moins d'une revanche voulue sur deux est payable.
describe('économie : seconde chance', () => {
  it('revive.cost ≈ 0,35-0,55 run moyenne ; revanche une run sur deux → arbre complet ≤ 36 runs', () => {
    const cfg = structuredClone(loadConfig());
    const full: number[] = [];
    const perRun: number[] = [];
    let taken = 0;
    let wanted = 0;
    for (let p = 0; p < 5; p++) {
      const meta = createMeta(createMemoryStorage(), cfg, () => new Date(2026, 9, 16));
      let runs = 0;
      while (!complete(cfg, meta) && runs < 60) {
        // Revanche une run sur deux (runs 1, 3, 5…) ; payée en fin de run (même solde :
        // les ◆ de la run ne sont crédités qu'au run:over, après la revanche).
        // Revanche une run sur deux (runs 1, 3, 5…), payée au moment de la mort avec le
        // solde courant (les ◆ de la run ne sont crédités qu'au run:over).
        const wantsRevive = runs % 2 === 0;
        let paid = false;
        const s = playRun(cfg, `eco-${p}-${runs}`, meta, () => {
          if (!wantsRevive) return false;
          wanted++;
          paid = meta.spendFragments(reviveCost(meta, cfg));
          if (paid) taken++;
          return paid;
        });
        runs++;
        perRun.push(s.stats.fragmentsEarned);
        expect(s.revivesUsed).toBe(paid ? 1 : 0);
        meta.onRunEnd(s);
        buyGreedy(cfg, meta);
      }
      full.push(runs);
    }
    const mean = perRun.reduce((a, b) => a + b, 0) / perRun.length;
    const ratio = cfg.economy.revive.cost / mean;
    console.log(`[economy revive] cost ${cfg.economy.revive.cost} = ${ratio.toFixed(2)} run moyenne (${mean.toFixed(1)} ◆) | revanches payées ${taken}/${wanted} | arbre complet: ${full.join(',')} runs`);
    expect(ratio).toBeGreaterThanOrEqual(0.35);
    expect(ratio).toBeLessThanOrEqual(0.55);
    for (const r of full) expect(r).toBeLessThanOrEqual(36);
    // le joueur glouton doit quand même pouvoir se payer la majorité des revanches voulues
    expect(taken / wanted).toBeGreaterThanOrEqual(0.5);
    expect(taken / wanted).toBeLessThanOrEqual(0.8); // pas automatique
  }, 120_000);
});
