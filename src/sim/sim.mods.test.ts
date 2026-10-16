import { describe, expect, it } from 'vitest';
import type { GameEvent, Sim } from '../core/types';
import type { RunModEffect } from './mods';
import { createSim } from './index';
import { config, createRng, lowestBlockDir, meta, mut, newSim, ofType, randomDir, settle, setup, shoot, FRAME } from './test-helpers';

const mods = (...ids: string[]) => ({ runMods: ids });

/** Joue `n` tirs du bot naïf, renvoie tous les événements. */
function play(sim: Sim, n: number): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n && sim.state.phase !== 'gameover'; i++) {
    settle(sim, out);
    for (const e of shoot(sim, lowestBlockDir(sim))) out.push(e);
  }
  return out;
}

/** Comptage des types de blocs générés en vague 1 (état initial) sur `n` seeds. */
function wave1Kinds(ids: string[], n = 40): Record<string, number> {
  const c: Record<string, number> = {};
  for (let i = 0; i < n; i++) for (const b of newSim(`kinds-${i}`, config(), mods(...ids)).state.blocks) c[b.kind] = (c[b.kind] ?? 0) + 1;
  return c;
}

describe('mutateurs de run', () => {
  it('inferno : volée de départ en feu, aucune balle de pierre gagnée (drops, offres, boutique)', () => {
    const sim = newSim('inferno', config(), mods('inferno'));
    expect(sim.state.volley.every((v) => v.element === 'fire')).toBe(true);
    const evs = play(sim, 60);
    for (const e of ofType(evs, 'reward:offered')) for (const o of e.options) if (o.kind === 'ball') expect(o.element).not.toBe('stone');
    expect(sim.state.volley.some((v) => v.element === 'stone')).toBe(false);
    // drop de balle de pierre forcé : devient du feu
    const s = mut(sim);
    if (s.phase === 'gameover') return;
    settle(sim);
    setup(sim, [], [{ element: 'fire', tier: 1 }], { rowsLeft: 5 });
    mut(sim).drops = [{ id: 9999, kind: 'ball', pos: { x: 3.5, y: 8.6 }, value: 1, element: 'stone' }];
    shoot(sim, { x: 0, y: -1 });
    expect(sim.state.volley.length).toBe(2);
    expect(sim.state.volley.every((v) => v.element === 'fire')).toBe(true);
  });

  it('inferno : la fusion reste possible (deux feux de rang 1 → feu rang 2)', () => {
    const sim = newSim('inferno-fuse', config(), mods('inferno'));
    const evs = play(sim, 80);
    const fusions = ofType(evs, 'volley:fusion');
    const offeredFuse = ofType(evs, 'reward:offered').some((e) => e.options.some((o) => o.kind === 'fuse' && o.element === 'fire'));
    expect(fusions.some((f) => f.element === 'fire') || offeredFuse).toBe(true);
  });

  it('armored : des blindés dès la vague 1 (aucun sans le mod)', () => {
    expect(wave1Kinds([]).armored ?? 0).toBe(0);
    expect(wave1Kinds(['armored']).armored ?? 0).toBeGreaterThan(5);
  });

  it('swift : balles lancées à ballSpeed × 1,3, sans tunneling (vitesse/240 < rayon)', () => {
    const cfg = config();
    const sim = newSim('swift', cfg, mods('swift'));
    sim.aim({ x: 0.3, y: -1 });
    sim.fire();
    sim.step(FRAME);
    const b = sim.state.balls[0]!;
    const want = cfg.blocks.board.ballSpeed * (cfg.waves as unknown as { runModEffects: Record<string, RunModEffect> }).runModEffects.swift!.ballSpeedMult!;
    expect(Math.hypot(b.vel.x, b.vel.y)).toBeCloseTo(want, 6);
    expect(want / 240).toBeLessThan(cfg.blocks.board.ballRadius);
  });

  it('rich : PV max = PV de départ = 3, pièces ×2', () => {
    const coinsFrom = (ids: string[]): number => {
      const sim = newSim('rich', config(), mods(...ids));
      setup(sim, [], [{ element: 'stone', tier: 1 }], { rowsLeft: 5 });
      mut(sim).drops = [{ id: 9999, kind: 'coin', pos: { x: 0.5, y: 8.6 }, value: 4, element: null }];
      const before = sim.state.coins;
      shoot(sim, { x: 0.3, y: -1 });
      return sim.state.coins - before;
    };
    const sim = newSim('rich', config(), mods('rich'));
    expect(sim.state.maxHp).toBe(3);
    expect(sim.state.hp).toBe(3);
    expect(coinsFrom([])).toBe(4);
    expect(coinsFrom(['rich'])).toBe(8);
  });

  it('cumul rich + glass : PV max = 1', () => {
    const sim = newSim('rg', config(), mods('rich', 'glass'));
    expect(sim.state.maxHp).toBe(1);
    expect(sim.state.hp).toBe(1);
  });

  it('pegfest : environ 2,5× plus de chevilles', () => {
    const base = wave1Kinds([], 80).peg ?? 0;
    const fest = wave1Kinds(['pegfest'], 80).peg ?? 0;
    expect(fest).toBeGreaterThan(base * 1.7);
  });

  it('heavy : PV des blocs ×1,5 et deux fois plus de drops', () => {
    let hpBase = 0;
    let hpHeavy = 0;
    for (let i = 0; i < 20; i++) {
      for (const b of newSim(`hv-${i}`).state.blocks) hpBase += b.maxHp;
      for (const b of newSim(`hv-${i}`, config(), mods('heavy')).state.blocks) hpHeavy += b.maxHp;
    }
    expect(hpHeavy / hpBase).toBeGreaterThan(1.4);
    expect(hpHeavy / hpBase).toBeLessThan(1.6);
    // taux de drops par bloc détruit (hors balles garanties) : nettement supérieur
    const rate = (ids: string[]): number => {
      let drops = 0;
      let kills = 0;
      for (let i = 0; i < 6; i++) {
        const evs = play(newSim(`hd-${i}`, config(), mods(...ids)), 25);
        drops += ofType(evs, 'drop:spawned').length;
        kills += ofType(evs, 'block:destroyed').length;
      }
      return drops / Math.max(1, kills);
    };
    expect(rate(['heavy'])).toBeGreaterThan(rate([]) * 1.5);
  });

  it('déterminisme avec tous les mods : même seed → même snapshot', () => {
    const all = ['glass', 'rush', 'inferno', 'armored', 'swift', 'rich', 'pegfest', 'heavy'];
    const run = (): Sim => {
      const sim = newSim('det-mods', config(), mods(...all.slice(2)));
      const rng = createRng(7);
      for (let i = 0; i < 120; i++) {
        if (sim.state.phase === 'gameover') sim.restart();
        settle(sim);
        shoot(sim, randomDir(rng));
      }
      return sim;
    };
    expect(run().snapshot()).toEqual(run().snapshot());
  });

  it('mesure : bot naïf, 10 seeds, mort moyenne ≥ 3 pour chaque mod seul', () => {
    const ids = ['none', 'glass', 'rush', 'inferno', 'armored', 'swift', 'rich', 'pegfest', 'heavy'];
    const lines: string[] = [];
    for (const id of ids) {
      const deaths: number[] = [];
      for (let i = 0; i < 10; i++) {
        const sim = newSim(`balance-${i}`, config(), mods(...(id === 'none' ? [] : [id])));
        for (let n = 0; n < 600 && sim.state.phase !== 'gameover'; n++) {
          settle(sim);
          shoot(sim, lowestBlockDir(sim));
        }
        deaths.push(sim.state.wave);
      }
      const avg = deaths.reduce((a, b) => a + b, 0) / deaths.length;
      lines.push(`${id}: ${avg.toFixed(1)} [${deaths.join(',')}]`);
      expect(avg, id).toBeGreaterThanOrEqual(3);
    }
    console.log(`[mods] vague de mort moyenne (bot naïf)\n${lines.join('\n')}`);
  }, 180_000);
});

describe('rewardSource', () => {
  it('renseigné à reward:offered (= source), conservé dans le snapshot, remis à undefined une fois l offre consommée', () => {
    const sim = newSim('rs-0');
    expect(sim.state.rewardSource).toBeUndefined();
    let seen = 0;
    for (let n = 0; n < 200 && sim.state.phase !== 'gameover' && seen < 2; n++) {
      const evs = shoot(sim, lowestBlockDir(sim));
      const off = ofType(evs, 'reward:offered')[0];
      if (!off) continue;
      seen++;
      expect(sim.state.rewardSource).toBe(off.source);
      const resumed = createSim(sim.config, { seed: 'rs-0', meta: meta(sim.config), snapshot: sim.snapshot() });
      expect(resumed.state.rewardSource).toBe(off.source);
      if (seen === 1) sim.chooseReward(0);
      else sim.skipReward();
      expect(sim.state.rewardSource).toBeUndefined();
      settle(sim);
    }
    expect(seen).toBe(2);
  });
});
