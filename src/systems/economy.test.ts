// Sanity d'économie méta : bot « vise le bloc le plus bas » (sim réelle), achats gloutons
// du nœud le moins cher après chaque run. Cibles (brief T10) : 1er achat après 1-2 runs,
// arbre complet en 25-35 runs (T10c : 16 nœuds, total 1 910).
// Rééquilibrage sim 3d1593f (dorée progressive, contrats, hpByWave) : ~70 ◆/run, arbre en
// 21-24 runs → fin d'arbre relevée (total 1 910 → 2 300).
// Recalage aa89b87+ (PV v4-v5 420, v6 540, v8 680, regen boss 2,4, pénalité d'éventail 0,20,
// revive.cost 30) : ~63 ◆/run, arbre 29-36 runs (revanche : 31-38) → fin d'arbre rabaissée,
// total 2 300 → 2 080 : hp/coins 30/70/125, balls 50/120, reroll 110, el_ice 250, el_ghost 200,
// el_lead 180, mitose/radar 110, berserk 140, glass 90, rush 130 (revive.cost 30 inchangé).
// Mesuré : sans revanche 27-32 runs (moy. 29), ~63 ◆/run ; revanche une run sur deux
// 28-36 runs, ~70 ◆/run, revanche payée 58/79 (73 %), coût = 0,43 run.
// Lot BALLS.md (2026-10-17) : 17 nœuds `unlockElement:` (arsenal), arbre 2 080 → 3 940 ◆
// (contenu long terme voulu). Coûts : magnet 40, acid 45, gold 50, rust 55, pierce 60, twin 80,
// bomb 90, crystal 100, swarm 110, shock 120, homing/boomerang 130, giant/echo 150, vampire 170,
// prism 180, void 200 (BALLS.md : 50-150, bas de gamme abaissé pour que les 5 moins chères
// tombent avant la run 12, haut de gamme relevé). nova/comet/lucky : succès combo15/wave5/shot5000.
// Mesuré (sim actuelle, ~55 ◆/run) : 1er achat run 1 ; 5 balles les moins chères runs 4-11 ;
// 8 premières runs 13-21 ; arbre complet 66-69 runs ; avec revanche une run sur deux 72-77 runs,
// revanche payée 134/189 (71 %), coût = 0,51 run.
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
  // Plafond de tirs : le bot abandonne (cas observé quand beaucoup de balles sont débloquées :
  // le bot naïf ne meurt plus, cf. compteur `capped`).
  capped.push(`${seed}@v${sim.state.wave}`);
  sim.giveUp();
  for (const e of sim.step(0)) if (e.type === 'run:over') return e.summary;
  throw new Error(`run ${seed} : plafond de tirs, giveUp sans run:over (vague ${sim.state.wave})`);
}

/** Runs arrêtées au plafond de tirs (abandon), pour le rapport. */
const capped: string[] = [];

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

/** Les 7 balles d'origine ; les autres nœuds `unlockElement:` sont les « nœuds de balles » (BALLS.md). */
const ORIGINAL_ELEMENTS = ['stone', 'fire', 'lightning', 'ice', 'ghost', 'lead', 'split'];
/** Nœuds de balles (lot BALLS.md) triés par coût croissant (puis id, ordre stable). */
function ballNodes(cfg: GameConfig): { id: string; cost: number }[] {
  return cfg.meta.nodes
    .filter((n) => n.effect.startsWith('unlockElement:') && !ORIGINAL_ELEMENTS.includes(n.effect.slice('unlockElement:'.length)))
    .map((n) => ({ id: n.id, cost: n.costs[0] ?? 0 }))
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
}

/** Run (1-based) à laquelle tous les nœuds `ids` sont achetés, ou Infinity. */
function boughtBy(boughtAt: Record<string, number>, ids: readonly string[]): number {
  return Math.max(...ids.map((id) => boughtAt[id] ?? Infinity));
}

const MAX_RUNS = 150;

describe('économie méta', () => {
  it('1er achat ≤ 2 runs ; 5 balles les moins chères avant la run 12 ; 8 premières balles ≤ 25 runs ; arbre complet en 55-90 runs (5 joueurs simulés)', () => {
    const cfg = structuredClone(loadConfig());
    const balls = ballNodes(cfg);
    expect(balls).toHaveLength(17);
    const cheap5 = balls.slice(0, 5).map((b) => b.id);
    const cheap8 = balls.slice(0, 8).map((b) => b.id);
    const total = cfg.meta.nodes.reduce((t, n) => t + n.costs.reduce((a, b) => a + b, 0), 0);
    const firstBuy: number[] = [];
    const full: number[] = [];
    const at5: number[] = [];
    const at8: number[] = [];
    const perRun: number[] = [];
    const log: string[] = [];
    const run1Ach: number[] = [];
    for (let p = 0; p < 5; p++) {
      const meta = createMeta(createMemoryStorage(), cfg, () => new Date(2026, 9, 16));
      const boughtAt: Record<string, number> = {};
      let first = 0;
      let runs = 0;
      while (!complete(cfg, meta) && runs < MAX_RUNS) {
        const s = playRun(cfg, `eco-${p}-${runs}`, meta);
        runs++;
        perRun.push(s.stats.fragmentsEarned);
        const ach = meta.onRunEnd(s);
        if (runs === 1) {
          run1Ach.push(ach.length);
          log.push(`J${p} run1: ${s.stats.fragmentsEarned} ◆ run + ${meta.data.meta.fragments - s.stats.fragmentsEarned} ◆ succès [${ach.join(',')}]`);
        }
        if (buyGreedy(cfg, meta) > 0 && first === 0) first = runs;
        for (const n of cfg.meta.nodes) if ((meta.data.meta.nodes[n.id] ?? 0) >= 1 && boughtAt[n.id] === undefined) boughtAt[n.id] = runs;
      }
      firstBuy.push(first);
      full.push(complete(cfg, meta) ? runs : Infinity);
      at5.push(boughtBy(boughtAt, cheap5));
      at8.push(boughtBy(boughtAt, cheap8));
      log.push(`J${p} balles (run d'achat) : ${balls.map((b) => `${b.id.slice(3)}@${boughtAt[b.id] ?? '-'}`).join(' ')} | succès ${meta.data.achievements.join(',')}`);
    }
    const mean = perRun.reduce((a, b) => a + b, 0) / perRun.length;
    console.log(log.join('\n'));
    console.log(
      `[economy] arbre ${total} ◆ | 1er achat: run ${firstBuy.join(',')} | 5 balles [${cheap5.join(',')}]: run ${at5.join(',')} | 8 balles: run ${at8.join(',')} | arbre complet: ${full.join(',')} runs | fragments/run moyen ${mean.toFixed(1)} (min ${Math.min(...perRun)}, max ${Math.max(...perRun)}) | runs au plafond de tirs: ${capped.length} [${capped.join(',')}]`,
    );
    // Run 1 bimodale (QA J3-02) : une run courte débloque 1-2 succès, une longue jusqu'à 10.
    const med = [...run1Ach].sort((a, b) => a - b)[Math.floor(run1Ach.length / 2)] ?? 0;
    expect(med).toBeGreaterThanOrEqual(1);
    expect(med).toBeLessThanOrEqual(4);
    for (const f of firstBuy) expect(f).toBeGreaterThanOrEqual(1);
    for (const f of firstBuy) expect(f).toBeLessThanOrEqual(2);
    for (const r of at5) expect(r).toBeLessThan(12);
    for (const r of at8) expect(r).toBeLessThanOrEqual(25);
    for (const r of full) {
      expect(r).toBeGreaterThanOrEqual(55);
      expect(r).toBeLessThanOrEqual(90);
    }
  }, 300_000);
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
  it('revive.cost ≈ 0,35-0,55 run moyenne ; revanche une run sur deux → arbre complet ≤ 90 runs', () => {
    const cfg = structuredClone(loadConfig());
    const full: number[] = [];
    const perRun: number[] = [];
    let taken = 0;
    let wanted = 0;
    for (let p = 0; p < 5; p++) {
      const meta = createMeta(createMemoryStorage(), cfg, () => new Date(2026, 9, 16));
      let runs = 0;
      while (!complete(cfg, meta) && runs < MAX_RUNS) {
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
      full.push(complete(cfg, meta) ? runs : Infinity);
    }
    const mean = perRun.reduce((a, b) => a + b, 0) / perRun.length;
    const ratio = cfg.economy.revive.cost / mean;
    console.log(`[economy revive] cost ${cfg.economy.revive.cost} = ${ratio.toFixed(2)} run moyenne (${mean.toFixed(1)} ◆) | revanches payées ${taken}/${wanted} | arbre complet: ${full.join(',')} runs`);
    expect(ratio).toBeGreaterThanOrEqual(0.35);
    expect(ratio).toBeLessThanOrEqual(0.55);
    for (const r of full) expect(r).toBeLessThanOrEqual(90);
    // le joueur glouton doit quand même pouvoir se payer la majorité des revanches voulues
    expect(taken / wanted).toBeGreaterThanOrEqual(0.5);
    expect(taken / wanted).toBeLessThanOrEqual(0.8); // pas automatique
  }, 300_000);
});
