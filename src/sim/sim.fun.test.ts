// Lot 1 (docs/FUN.md) : éventail (F1), contrats (F2), balle dorée (F3), seconde chance (F4), offre de boss.
import { describe, expect, it } from 'vitest';
import type { ContractDef, GameConfig, GameEvent, Sim, VolleyBall } from '../core/types';
import { createSim } from './index';
import { block, config, createRng, FRAME, lowestBlockDir, meta, mut, newSim, ofType, randomDir, settle, setup, shoot } from './test-helpers';

const UP = { x: 0, y: -1 };
const stones = (n: number): VolleyBall[] => Array.from({ length: n }, () => ({ element: 'stone', tier: 1 }));
const deg = (x: number, y: number): number => (Math.atan2(x, -y) * 180) / Math.PI;

describe('F1 tir en éventail', () => {
  it('aim(dir, spread) : clamp 0..1, inchangé si omis, cancelAim ne touche pas aimSpread', () => {
    const sim = newSim('fan-aim');
    expect(sim.state.aimSpread).toBe(0);
    sim.aim(UP, 0.4);
    expect(sim.state.aimSpread).toBe(0.4);
    sim.aim(UP);
    expect(sim.state.aimSpread).toBe(0.4);
    sim.aim(UP, 3);
    expect(sim.state.aimSpread).toBe(1);
    sim.aim(UP, -2);
    expect(sim.state.aimSpread).toBe(0);
    sim.aim(UP, 0.6);
    sim.cancelAim();
    expect(sim.state.aimDir).toBeNull();
    expect(sim.state.aimSpread).toBe(0.6);
  });

  it('N = 5, spread 1 : angles base ± maxSpreadDeg répartis, ordre de départ centré, volley:start.spread', () => {
    const sim = newSim('fan-5');
    const max = sim.config.blocks.board.maxSpreadDeg;
    setup(sim, [block(sim, 'normal', 0, 0, 1000)], stones(5), { rowsLeft: 3 });
    sim.aim(UP, 1);
    sim.fire();
    const it = mut(sim).internal;
    const angles: number[] = [];
    for (let k = 0; k < 5; k++) angles.push(deg(it.launchDirs[2 * k]!, it.launchDirs[2 * k + 1]!));
    // ordre de départ 2, 1, 3, 0, 4 → offsets 0, −½, +½, −1, +1 (× maxSpreadDeg)
    const expected = [0, -max / 2, max / 2, -max, max];
    angles.forEach((a, k) => expect(a).toBeCloseTo(expected[k]!, 9));
    const start = ofType(sim.step(0), 'volley:start')[0]!;
    expect(start.spread).toBe(1);
    expect(start.dir).toEqual(UP);
    // les balles partent réellement dans ces directions, dans cet ordre
    const launched: number[] = [];
    for (let f = 0; f < 400 && launched.length < 5; f++) {
      for (const e of sim.step(1000 / 240)) {
        if (e.type !== 'ball:launched') continue;
        const b = sim.state.balls.find((x) => x.id === e.ballId)!;
        launched.push(deg(b.vel.x, b.vel.y));
      }
    }
    launched.forEach((a, k) => expect(a).toBeCloseTo(expected[k]!, 6));
  });

  it('N = 4, spread 0,5 : offsets ±⅓ et ±1 de la demi-ouverture, ordre 1, 2, 0, 3', () => {
    const sim = newSim('fan-4');
    const half = sim.config.blocks.board.maxSpreadDeg * 0.5;
    setup(sim, [block(sim, 'normal', 0, 0, 1000)], stones(4), { rowsLeft: 3 });
    const base = { x: 0.3, y: -1 };
    sim.aim(base, 0.5);
    const b0 = deg(sim.state.aimDir!.x, sim.state.aimDir!.y);
    sim.fire();
    const it = mut(sim).internal;
    const got = [0, 1, 2, 3].map((k) => deg(it.launchDirs[2 * k]!, it.launchDirs[2 * k + 1]!) - b0);
    [-1 / 3, 1 / 3, -1, 1].forEach((f, k) => expect(got[k]).toBeCloseTo(f * half, 9));
  });

  it('N = 1 : angle de base quel que soit spread ; spread 0 : directions exactement aimDir, ordre de la volée', () => {
    const one = newSim('fan-1');
    setup(one, [block(one, 'normal', 0, 0, 1000)], stones(1), { rowsLeft: 3 });
    one.aim({ x: 0.4, y: -1 }, 1);
    const d = { ...one.state.aimDir! };
    one.fire();
    expect(mut(one).internal.launchDirs).toEqual([d.x, d.y]);

    const zero = newSim('fan-0');
    const mixed: VolleyBall[] = [
      { element: 'stone', tier: 1 },
      { element: 'fire', tier: 1 },
      { element: 'lightning', tier: 1 },
    ];
    setup(zero, [block(zero, 'normal', 0, 0, 1000)], mixed, { rowsLeft: 3 });
    zero.aim({ x: -0.2, y: -1 }, 0);
    const z = { ...zero.state.aimDir! };
    zero.fire();
    const it = mut(zero).internal;
    expect(it.launchDirs).toEqual([z.x, z.y, z.x, z.y, z.x, z.y]);
    expect(it.launchQueue.map((q) => q.element)).toEqual(zero.state.volley.map((v) => v.element));
  });

  it('angle minimal respecté aux bords de l éventail ; preview inchangé par spread ; launchPos = première balle au sol', () => {
    const sim = newSim('fan-edge');
    setup(sim, [block(sim, 'normal', 0, 0, 1000)], stones(5), { rowsLeft: 3 });
    const rasant = { x: 1, y: -0.2 };
    sim.aim(rasant, 0);
    const p0 = sim.preview(rasant);
    sim.aim(rasant, 1);
    expect(sim.preview(rasant)).toEqual(p0);
    sim.fire();
    const minDeg = sim.config.blocks.board.minAimAngleDeg;
    const it = mut(sim).internal;
    for (let k = 0; k < 5; k++) {
      const x = it.launchDirs[2 * k]!;
      const y = it.launchDirs[2 * k + 1]!;
      expect(y).toBeLessThan(0);
      expect((Math.atan2(-y, Math.abs(x)) * 180) / Math.PI).toBeGreaterThanOrEqual(minDeg - 1e-9);
    }
    const evs: GameEvent[] = [];
    for (let f = 0; f < 5000 && sim.state.phase === 'firing'; f++) evs.push(...sim.step(FRAME));
    const first = ofType(evs, 'ball:grounded')[0]!;
    const { cols } = sim.config.blocks.board;
    expect(sim.state.launchPos.x).toBeCloseTo(Math.min(cols - 0.3, Math.max(0.3, first.pos.x)), 9);
  });

  it('déterminisme : spread 0 explicite ≡ visée sans spread ; même seed + spreads aléatoires → mêmes snapshots', () => {
    const cfg = config();
    const play = (sim: Sim, botSeed: number, spread: 'none' | 'zero' | 'random'): void => {
      const rng = createRng(botSeed);
      for (let i = 0; i < 80; i++) {
        if (sim.state.phase === 'gameover') sim.restart();
        settle(sim);
        const dir = randomDir(rng);
        const sp = rng.next();
        if (spread === 'none') sim.aim(dir);
        else sim.aim(dir, spread === 'zero' ? 0 : sp);
        sim.fire();
        for (let f = 0; f < 5000; f++) {
          sim.step(FRAME);
          const p = sim.state.phase;
          if (p !== 'firing' && p !== 'advancing') break;
        }
      }
    };
    const a = newSim('det-fan', cfg);
    const b = newSim('det-fan', cfg);
    play(a, 5, 'none');
    play(b, 5, 'zero');
    expect(b.snapshot()).toEqual(a.snapshot());
    const c = newSim('det-fan-r', cfg);
    const d = newSim('det-fan-r', cfg);
    play(c, 6, 'random');
    play(d, 6, 'random');
    expect(d.snapshot()).toEqual(c.snapshot());
  });
});

describe('F3 balle dorée', () => {
  it('seule la dernière balle lancée est dorée et fait × lastBallMultiplier', () => {
    const sim = newSim('golden');
    const t = block(sim, 'normal', 3, 4, 100000);
    setup(sim, [t], stones(3), { rowsLeft: 3, launchX: 3.5 });
    const evs = shoot(sim, UP);
    const launched = ofType(evs, 'ball:launched');
    expect(launched.map((e) => e.golden)).toEqual([false, false, true]);
    const goldId = launched[2]!.ballId;
    const hits = ofType(evs, 'block:hit');
    expect(hits).toHaveLength(3);
    for (const h of hits) {
      expect(h.combo).toBe(0);
      const bc = sim.config.balls;
      const gold = Math.min(bc.lastBallMultiplierMax, bc.lastBallMultiplier + bc.lastBallMultiplierPerBall * 2);
      expect(h.damage).toBe(h.ballId === goldId ? Math.round(10 * gold) : 10);
    }
    expect(hits.map((h) => h.ballId).sort()).toEqual(launched.map((e) => e.ballId).sort());
  });

  it('multiplicateur doré = min(max, base + parBalle × (N − 1)) : N = 1, 3, plafond ; scissions non comptées', () => {
    const cfg = config();
    cfg.balls.lastBallMultiplier = 2;
    cfg.balls.lastBallMultiplierPerBall = 0.5;
    cfg.balls.lastBallMultiplierMax = 3;
    const goldHit = (volley: VolleyBall[]): number => {
      const sim = newSim('golden-n', cfg);
      setup(sim, [block(sim, 'normal', 3, 4, 100000)], volley, { rowsLeft: 3, launchX: 3.5 });
      const evs = shoot(sim, UP);
      const goldId = ofType(evs, 'ball:launched').find((e) => e.golden)!.ballId;
      return ofType(evs, 'block:hit').find((h) => h.ballId === goldId)!.damage;
    };
    expect(goldHit(stones(1))).toBe(20); // 2 + 0,5 × 0
    expect(goldHit(stones(2))).toBe(25); // 2 + 0,5 × 1
    expect(goldHit(stones(5))).toBe(30); // 2 + 0,5 × 4 = 4 → plafond 3
    // une seule balle de scission : N = 1 malgré les filles
    const sim = newSim('golden-split-n', cfg);
    setup(sim, [block(sim, 'normal', 3, 4, 100000)], [{ element: 'split', tier: 1 }], { rowsLeft: 3, launchX: 3.5 });
    const first = ofType(shoot(sim, UP), 'block:hit')[0]!;
    expect(first.damage).toBe(20);
  });

  it('pénalité d éventail : dégâts × (1 − spreadDamagePenalty × spread), figée au tir, dorée comprise', () => {
    const cfg = config();
    cfg.balls.spreadDamagePenalty = 0.4;
    cfg.balls.lastBallMultiplierPerBall = 0;
    cfg.blocks.board.maxSpreadDeg = 0; // même trajectoire quel que soit spread : seuls les dégâts changent
    const hits = (spread: number, changeAfter?: number): number[] => {
      const sim = newSim('spread-pen', cfg);
      setup(sim, [block(sim, 'normal', 3, 4, 100000)], stones(2), { rowsLeft: 3, launchX: 3.5 });
      sim.aim(UP, spread);
      sim.fire();
      if (changeAfter !== undefined) sim.aim(UP, changeAfter); // ne change rien à la volée en cours
      const evs: GameEvent[] = [];
      for (let f = 0; f < 5000 && sim.state.phase === 'firing'; f++) evs.push(...sim.step(FRAME));
      return ofType(evs, 'block:hit').map((h) => h.damage);
    };
    expect(hits(0)).toEqual([10, 20]);
    expect(hits(1)).toEqual([6, 12]);
    expect(hits(0.5)).toEqual([8, 16]);
    expect(hits(1, 0)).toEqual([6, 12]);
  });

  it('split : les filles d une balle dorée ne sont pas dorées', () => {
    const sim = newSim('golden-split');
    setup(sim, [block(sim, 'normal', 3, 4, 100000)], [{ element: 'split', tier: 1 }], { rowsLeft: 3, launchX: 3.5 });
    sim.aim(UP);
    sim.fire();
    let checked = false;
    const evs: GameEvent[] = [];
    for (let f = 0; f < 2000 && sim.state.phase === 'firing'; f++) {
      evs.push(...sim.step(1000 / 240));
      if (!checked && sim.state.balls.length >= 2) {
        expect(sim.state.balls.filter((b) => b.golden)).toHaveLength(1);
        checked = true;
      }
    }
    expect(checked).toBe(true);
    const goldId = ofType(evs, 'ball:launched')[0]!.ballId;
    for (const h of ofType(evs, 'block:hit')) if (h.ballId !== goldId) expect(h.damage).toBe(Math.round(10 * (1 + 0.1 * h.combo)));
  });

  it('fin forcée de volée avant la dernière balle : aucune dorée', () => {
    const cfg = config();
    cfg.blocks.board.maxVolleyMs = 30;
    const sim = newSim('golden-forced', cfg);
    setup(sim, [block(sim, 'normal', 0, 0, 1000)], stones(3), { rowsLeft: 3 });
    const evs = shoot(sim, UP);
    const launched = ofType(evs, 'ball:launched');
    expect(launched.length).toBeLessThan(3);
    expect(launched.some((e) => e.golden)).toBe(false);
  });
});

// ----------------------------------------------------------------------
// F2 contrats
// ----------------------------------------------------------------------

function contractCfg(defs: Partial<ContractDef>[], chance = 1): GameConfig {
  const cfg = config();
  cfg.contracts.chance = chance;
  cfg.contracts.defs = defs.map((d, i) => ({
    id: `c${i}`,
    kind: 'collectCoins',
    target: 1,
    text: 'test {n}',
    reward: { kind: 'coins', amount: 7 },
    minWave: 1,
    weight: 1,
    ...d,
  }));
  return cfg;
}

function contractSim(def: Partial<ContractDef>, seed = 'contract'): Sim {
  return newSim(seed, contractCfg([def]));
}

describe('F2 contrats', () => {
  it('offert à la vague 1 : RunState.contract + contract:offered', () => {
    const sim = contractSim({ kind: 'reachCombo', target: 8 });
    expect(sim.state.contract).toEqual({ id: 'c0', progress: 0, target: 8, status: 'active' });
    const off = ofType(sim.step(0), 'contract:offered');
    expect(off).toHaveLength(1);
    expect(off[0]!.def.id).toBe('c0');
    expect(off[0]!.contract).toEqual(sim.state.contract);
    // chance 0 : jamais de contrat
    expect(newSim('none', contractCfg([{}], 0)).state.contract).toBeNull();
  });

  it('destroyInOneShot : 2 blocs dans le même tir → done, récompense (soin) appliquée, stats', () => {
    const sim = contractSim({ kind: 'destroyInOneShot', target: 2, reward: { kind: 'heal', amount: 1 } });
    setup(sim, [block(sim, 'normal', 3, 4, 1), block(sim, 'normal', 3, 2, 1)], stones(2), { rowsLeft: 3, launchX: 3.5 });
    mut(sim).hp = 2;
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'contract:progress').map((e) => e.progress)).toEqual([1, 2]);
    const done = ofType(evs, 'contract:completed');
    expect(done).toHaveLength(1);
    expect(done[0]!.reward).toEqual({ kind: 'heal', amount: 1 });
    expect(sim.state.contract!.status).toBe('done');
    expect(sim.state.hp).toBe(3);
    expect(sim.state.stats.contractsCompleted).toBe(1);
  });

  it('destroyInOneShot : progress = max par tir (pas de cumul) ; actif en fin de vague → failed', () => {
    const sim = contractSim({ kind: 'destroyInOneShot', target: 2 });
    setup(sim, [block(sim, 'normal', 3, 4, 1), block(sim, 'normal', 0, 0, 1000)], stones(1), { rowsLeft: 3, launchX: 3.5 });
    shoot(sim, UP);
    expect(sim.state.contract!.progress).toBe(1);
    mut(sim).blocks = [block(sim, 'normal', 3, 4, 1)];
    mut(sim).rowsLeftInWave = 0;
    const evs = shoot(sim, UP);
    expect(sim.state.contract!.progress).toBe(1);
    expect(sim.state.contract!.status).toBe('failed');
    expect(ofType(evs, 'contract:failed')).toHaveLength(1);
    expect(ofType(evs, 'contract:completed')).toHaveLength(0);
    expect(sim.state.stats.contractsCompleted).toBe(0);
  });

  it('reachCombo : combo de départ (bouncy) suffit → done, récompense balle ajoutée à la volée', () => {
    const sim = contractSim({ kind: 'reachCombo', target: 2, reward: { kind: 'ball', element: 'stone', tier: 1 } });
    setup(sim, [block(sim, 'normal', 0, 0, 1000)], stones(1), { rowsLeft: 3 });
    mut(sim).relics = ['bouncy'];
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'contract:completed')).toHaveLength(1);
    expect(sim.state.contract!.status).toBe('done');
    expect(sim.state.volley).toHaveLength(2);
  });

  it('noDamage : reste à 0 pendant la vague, validé à la fin sans dégâts ; échoue dès un player:damaged', () => {
    const ok = contractSim({ kind: 'noDamage', target: 1, reward: { kind: 'heal', amount: 1 } });
    setup(ok, [block(ok, 'normal', 0, 0, 1000)], stones(1), { rowsLeft: 3 });
    shoot(ok, UP);
    expect(ok.state.contract!.progress).toBe(0);
    mut(ok).blocks = [block(ok, 'normal', 3, 4, 1)];
    mut(ok).rowsLeftInWave = 0;
    mut(ok).hp = 3;
    const evs = shoot(ok, UP, 5000);
    expect(ofType(evs, 'wave:cleared')).toHaveLength(1);
    expect(ok.state.contract).toEqual({ id: 'c0', progress: 1, target: 1, status: 'done' });
    expect(ok.state.hp).toBe(4);

    const ko = contractSim({ kind: 'noDamage', target: 1 });
    setup(ko, [block(ko, 'normal', 0, 8, 1000)], stones(1), { rowsLeft: 3 });
    const e2 = shoot(ko, UP);
    expect(ofType(e2, 'player:damaged')).toHaveLength(1);
    expect(ofType(e2, 'contract:failed')).toHaveLength(1);
    expect(ko.state.contract!.status).toBe('failed');
  });

  it('collectCoins et collectBalls : drops ramassés', () => {
    const coins = contractSim({ kind: 'collectCoins', target: 5, reward: { kind: 'coins', amount: 7 } });
    setup(coins, [block(coins, 'normal', 0, 0, 1000)], stones(1), { rowsLeft: 3 });
    mut(coins).drops.push({ id: 9000, kind: 'coin', pos: { x: 6.5, y: 8.5 }, value: 5, element: null });
    const e1 = shoot(coins, UP);
    expect(ofType(e1, 'contract:progress').map((e) => e.progress)).toEqual([5]);
    expect(coins.state.contract!.status).toBe('done');
    expect(coins.state.coins).toBe(12);

    const balls = contractSim({ kind: 'collectBalls', target: 1 });
    setup(balls, [block(balls, 'normal', 0, 0, 1000)], stones(1), { rowsLeft: 3 });
    mut(balls).drops.push({ id: 9001, kind: 'ball', pos: { x: 6.5, y: 8.5 }, value: 1, element: 'stone' });
    shoot(balls, UP);
    expect(balls.state.contract!.status).toBe('done');
    expect(balls.state.coins).toBe(7);
  });

  it('killWithElement : compte les casses de l élément ; jamais proposé si l élément est absent de la volée', () => {
    const sim = contractSim({ kind: 'killWithElement', element: 'fire', target: 1 });
    expect(sim.state.contract).toBeNull(); // volée de départ : que des pierres
    const cfg = contractCfg([{ kind: 'killWithElement', element: 'fire', target: 1 }]);
    cfg.waves.start.elements = ['fire', 'stone', 'stone', 'stone', 'stone'];
    const fire = newSim('fire-kill', cfg);
    expect(fire.state.contract?.id).toBe('c0');
    setup(fire, [block(fire, 'normal', 3, 4, 1), block(fire, 'normal', 0, 0, 1000)], [{ element: 'fire', tier: 1 }], { rowsLeft: 3, launchX: 3.5 });
    shoot(fire, UP);
    expect(fire.state.contract!.status).toBe('done');
  });

  it('clearUnderShots : progress = tirs utilisés ; done si nettoyée à temps, failed dès le dépassement', () => {
    const ok = contractSim({ kind: 'clearUnderShots', target: 1 });
    setup(ok, [block(ok, 'normal', 3, 4, 1)], stones(1), { rowsLeft: 0, launchX: 3.5 });
    const e1 = shoot(ok, UP);
    expect(ofType(e1, 'wave:cleared')).toHaveLength(1);
    expect(ok.state.contract).toEqual({ id: 'c0', progress: 1, target: 1, status: 'done' });

    const ko = contractSim({ kind: 'clearUnderShots', target: 1 });
    setup(ko, [block(ko, 'normal', 0, 0, 1000)], stones(1), { rowsLeft: 3 });
    shoot(ko, UP);
    expect(ko.state.contract!.status).toBe('active');
    ko.aim(UP);
    ko.fire();
    const e2 = [...ko.step(0)];
    expect(ofType(e2, 'contract:failed')).toHaveLength(1);
    expect(ko.state.contract).toEqual({ id: 'c0', progress: 2, target: 1, status: 'failed' });
  });

  it('goldenKill : seule la balle dorée compte', () => {
    const ok = contractSim({ kind: 'goldenKill', target: 1 });
    setup(ok, [block(ok, 'normal', 3, 4, 1), block(ok, 'normal', 0, 0, 1000)], stones(1), { rowsLeft: 3, launchX: 3.5 });
    shoot(ok, UP);
    expect(ok.state.contract!.status).toBe('done');

    const ko = contractSim({ kind: 'goldenKill', target: 1 });
    // la première balle (non dorée) casse le bloc ; la dorée ne touche plus rien
    setup(ko, [block(ko, 'normal', 3, 4, 1), block(ko, 'normal', 0, 0, 1000)], stones(2), { rowsLeft: 3, launchX: 3.5 });
    shoot(ko, UP);
    expect(ko.state.contract).toEqual({ id: 'c0', progress: 0, target: 1, status: 'active' });
  });

  it('jamais deux fois le même contrat d affilée (2 défs : alternance ; 1 déf : une vague sur deux)', () => {
    const ids = (cfg: GameConfig): (string | null)[] => {
      const sim = newSim('no-repeat', cfg);
      const out: (string | null)[] = [];
      for (let w = 0; w < 7; w++) {
        out.push(sim.state.contract?.id ?? null);
        setup(sim, [block(sim, 'normal', 3, 4, 1)], stones(1), { rowsLeft: 0, launchX: 3.5 });
        shoot(sim, UP);
        settle(sim);
      }
      return out;
    };
    const two = ids(contractCfg([{ weight: 100 }, { weight: 1 }]));
    expect(two.every((x) => x !== null)).toBe(true);
    for (let i = 1; i < two.length; i++) expect(two[i]).not.toBe(two[i - 1]);
    expect(ids(contractCfg([{}]))).toEqual(['c0', null, 'c0', null, 'c0', null, 'c0']);
  });

  it('config réelle : contrats tirés selon minWave, contract:progress à chaque changement', () => {
    const cfg = config();
    const waves = new Set<string>();
    let progress = 0;
    for (let i = 0; i < 5; i++) {
      const sim = newSim(`real-contracts-${i}`, cfg);
      let prev: string | null = null;
      let prevWave = 0;
      for (let k = 0; k < 120 && sim.state.phase !== 'gameover'; k++) {
        settle(sim);
        const c = sim.state.contract;
        if (sim.state.wave !== prevWave) {
          if (c && prev) expect(c.id).not.toBe(prev);
          prev = c?.id ?? null;
          prevWave = sim.state.wave;
        }
        if (c) {
          const def = cfg.contracts.defs.find((d) => d.id === c.id)!;
          expect(def.minWave).toBeLessThanOrEqual(sim.state.wave);
          waves.add(`${i}:${sim.state.wave}`);
        }
        for (const e of shoot(sim, lowestBlockDir(sim))) if (e.type === 'contract:progress') progress++;
      }
    }
    expect(waves.size).toBeGreaterThan(10);
    expect(progress).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------------------
// F4 seconde chance
// ----------------------------------------------------------------------

/** Tue le joueur : 1 PV, un bloc en rangée 8 qui franchit la ligne. */
function die(sim: Sim, extra: ReturnType<typeof block>[] = [], rowsLeft = 3): GameEvent[] {
  const s = mut(sim);
  s.hp = 1;
  s.blocks = [block(sim, 'normal', 0, 8, 1000), ...extra];
  s.rowsLeftInWave = rowsLeft;
  return shoot(sim, UP);
}

describe('F4 seconde chance', () => {
  it('mort → run:lost (pas de run:over) ; revive : PV, rangées du bas et drops effacés, aiming', () => {
    const sim = newSim('revive');
    setup(sim, [], stones(1), { launchX: 3.5 });
    const keep2 = block(sim, 'normal', 6, 1, 1000);
    const keep5 = block(sim, 'normal', 6, 4, 1000);
    const gone6 = block(sim, 'normal', 6, 5, 1000);
    const [k2, k5, g6] = [keep2.id, keep5.id, gone6.id];
    mut(sim).drops.push({ id: 9100, kind: 'coin', pos: { x: 5.5, y: 6.5 }, value: 1, element: null });
    mut(sim).drops.push({ id: 9101, kind: 'coin', pos: { x: 5.5, y: 2.5 }, value: 1, element: null });
    const evs = die(sim, [keep2, keep5, gone6]);
    expect(sim.state.phase).toBe('gameover');
    expect(ofType(evs, 'run:over')).toHaveLength(0);
    expect(ofType(evs, 'run:lost')).toEqual([{ type: 'run:lost', canRevive: true, wave: 1, depth: sim.state.depth }]);

    expect(sim.revive()).toBe(true);
    const r = sim.config.economy.revive;
    const rows = sim.config.blocks.board.rows;
    const hp = Math.max(1, Math.ceil(sim.state.maxHp * r.hpRatio));
    expect(sim.state.hp).toBe(hp);
    expect(sim.state.revivesUsed).toBe(1);
    expect(sim.state.phase).toBe('aiming');
    expect(sim.state.blocks.some((b) => b.row >= rows - 1 - r.clearRows)).toBe(false);
    const ids = sim.state.blocks.map((b) => b.id);
    expect(ids).toContain(k2);
    expect(ids).toContain(k5);
    expect(ids).not.toContain(g6);
    expect(sim.state.drops.map((d) => d.id)).toEqual([9101]);
    expect(ofType(sim.step(0), 'run:revived')).toEqual([{ type: 'run:revived', hpLeft: hp, revivesUsed: 1 }]);

    // seconde mort : plus de seconde chance
    const e2 = die(sim);
    expect(ofType(e2, 'run:lost')[0]!.canRevive).toBe(false);
    expect(sim.revive()).toBe(false);
    expect(sim.state.phase).toBe('gameover');
    sim.giveUp();
    const over = ofType(sim.step(0), 'run:over');
    expect(over).toHaveLength(1);
    expect(over[0]!.summary.revivesUsed).toBe(1);
    expect(over[0]!.summary.contractsCompleted).toBe(sim.state.stats.contractsCompleted);
    sim.giveUp();
    expect(ofType(sim.step(0), 'run:over')).toHaveLength(0);
    sim.restart('next');
    const e3 = [...sim.step(0)];
    expect(ofType(e3, 'run:over')).toHaveLength(0);
    expect(ofType(e3, 'run:started')).toHaveLength(1);
    expect(sim.state.revivesUsed).toBe(0);
  });

  it('après giveUp, revive refusé ; hors gameover, revive/giveUp sans effet', () => {
    const sim = newSim('giveup');
    expect(sim.revive()).toBe(false);
    sim.giveUp();
    expect(ofType(sim.step(0), 'run:over')).toHaveLength(0);
    setup(sim, [], stones(1), { launchX: 3.5 });
    die(sim);
    sim.giveUp();
    expect(sim.revive()).toBe(false);
    expect(sim.state.phase).toBe('gameover');
  });

  it('restart depuis gameover sans giveUp : run:over une seule fois, avant run:started ; restart en cours de run : pas de run:over', () => {
    const sim = newSim('restart-over');
    setup(sim, [], stones(1), { launchX: 3.5 });
    die(sim);
    sim.restart();
    const evs = [...sim.step(0)];
    const types = evs.map((e) => e.type);
    expect(types.filter((t) => t === 'run:over')).toHaveLength(1);
    expect(types.indexOf('run:over')).toBeLessThan(types.indexOf('run:started'));
    sim.restart();
    expect(ofType(sim.step(0), 'run:over')).toHaveLength(0);
  });

  it('revive qui vide le plateau d une vague sans rangée restante : vague nettoyée directement', () => {
    const sim = newSim('revive-clear');
    setup(sim, [], stones(1), { launchX: 3.5 });
    die(sim, [block(sim, 'normal', 6, 5, 1000)], 0);
    expect(sim.state.phase).toBe('gameover');
    expect(sim.revive()).toBe(true);
    expect(sim.state.phase).toBe('reward');
    expect(ofType(sim.step(0), 'wave:cleared')).toHaveLength(1);
  });
});

describe('snapshot avec contrat, éventail et seconde chance', () => {
  it('reprise exacte après revive, contrat actif et spread', () => {
    const cfg = config();
    cfg.contracts.chance = 1;
    const m = meta(cfg);
    const a = createSim(cfg, { seed: 'snap-fun', meta: m });
    const rng = createRng(11);
    for (let i = 0; i < 400 && a.state.phase !== 'gameover'; i++) {
      settle(a);
      a.aim(lowestBlockDir(a), rng.next());
      a.fire();
      for (let f = 0; f < 5000 && (a.state.phase === 'firing' || a.state.phase === 'advancing'); f++) a.step(FRAME);
    }
    expect(a.state.phase).toBe('gameover');
    expect(a.revive()).toBe(true);
    settle(a);
    a.aim({ x: 0.2, y: -1 }, 0.8);
    a.fire();
    for (let i = 0; i < 12; i++) a.step(FRAME);
    a.step(2.1);
    const snap = a.snapshot();
    expect(snap.revivesUsed).toBe(1);
    expect(snap.aimSpread).toBe(0.8);
    expect(snap.contract).not.toBeNull();
    const b = createSim(cfg, { seed: 'snap-fun', meta: m, snapshot: snap });
    expect(b.snapshot()).toEqual(snap);
    for (const s of [a, b]) {
      const r = createRng(12);
      for (let i = 0; i < 30; i++) {
        if (s.state.phase === 'gameover') s.giveUp();
        if (s.state.phase === 'gameover') s.restart();
        for (let f = 0; f < 5000 && (s.state.phase === 'firing' || s.state.phase === 'advancing'); f++) s.step(FRAME);
        settle(s);
        s.aim(randomDir(r), r.next());
        s.fire();
      }
    }
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it('snapshot antérieur au lot 1 (champs absents) : reprise tolérante', () => {
    const cfg = config();
    const a = newSim('old-snap', cfg);
    const old = a.snapshot() as unknown as Record<string, unknown> & { internal: Record<string, unknown>; stats: Record<string, unknown> };
    delete old.aimSpread;
    delete old.contract;
    delete old.revivesUsed;
    delete old.stats.contractsCompleted;
    delete old.internal.launchDirs;
    delete old.internal.contractRng;
    delete old.internal.overEmitted;
    const b = createSim(cfg, { seed: 'old-snap', meta: meta(cfg), snapshot: old as never });
    expect(b.state.aimSpread).toBe(0);
    expect(b.state.revivesUsed).toBe(0);
    expect(b.state.contract).toBeNull();
    const evs = shoot(b, UP);
    expect(ofType(evs, 'volley:start')).toHaveLength(1);
  });
});

describe('reward:offered source', () => {
  const rarity = (cfg: GameConfig, id: string): string => cfg.relics.defs.find((d) => d.id === id)!.rarity;

  it('vague normale : source wave ; boss tué : 3 reliques rares/épiques, pas de balle', () => {
    const sim = newSim('src-wave');
    setup(sim, [block(sim, 'normal', 3, 4, 1)], stones(1), { rowsLeft: 0, launchX: 3.5 });
    expect(ofType(shoot(sim, UP), 'reward:offered')[0]!.source).toBe('wave');

    const boss = newSim('src-boss');
    mut(boss).wave = 5;
    const b = block(boss, 'boss', 2, 4, 1, 3);
    b.bossId = 'regen';
    setup(boss, [b], stones(1), { rowsLeft: 0, launchX: 3.5 });
    const evs = shoot(boss, UP);
    expect(ofType(evs, 'boss:killed')).toHaveLength(1);
    const off = ofType(evs, 'reward:offered')[0]!;
    expect(off.source).toBe('boss');
    expect(off.options).toHaveLength(3);
    for (const o of off.options) {
      expect(o.kind).toBe('relic');
      if (o.kind === 'relic') expect(rarity(boss.config, o.relicId)).not.toBe('common');
    }
    expect(boss.state.rewardOffer).toEqual(off.options);
  });

  it('boss sans relique rare disponible : reliques communes, puis pièces/soin, jamais de balle', () => {
    const cfg = config();
    const commons = cfg.relics.defs.filter((d) => d.rarity === 'common').map((d) => d.id);
    const run = (unlocked: string[]): GameEvent[] => {
      const sim = newSim('src-boss-2', cfg, { unlockedRelics: unlocked });
      mut(sim).wave = 5;
      const b = block(sim, 'boss', 2, 4, 1, 3);
      b.bossId = 'regen';
      setup(sim, [b], stones(1), { rowsLeft: 0, launchX: 3.5 });
      return shoot(sim, UP);
    };
    const o1 = ofType(run(commons), 'reward:offered')[0]!.options;
    expect(o1.every((o) => o.kind === 'relic')).toBe(true);
    const o2 = ofType(run([]), 'reward:offered')[0]!.options;
    // aucune relique disponible : repli pièces puis soin (options distinctes), jamais de balle ni de fusion
    expect(o2.map((o) => o.kind)).toEqual(['coins', 'heal']);
  });
});
