import { describe, expect, it } from 'vitest';
import type { Sim } from '../core/types';
import { createSim } from './index';
import { config, createRng, meta, newSim, randomDir, settle, shoot, FRAME } from './test-helpers';

/** Bot aléatoire : vise, tire, avance jusqu'à aiming/reward/shop/gameover ; option 0 ; quitte la boutique. */
function randomBot(sim: Sim, botSeed: number, shots: number, onStep?: (sim: Sim) => void): void {
  const rng = createRng(botSeed);
  for (let i = 0; i < shots; i++) {
    if (sim.state.phase === 'gameover') sim.restart();
    settle(sim);
    sim.aim(randomDir(rng));
    sim.fire();
    if (rng.chance(0.2)) sim.recall();
    for (let f = 0; f < 5000; f++) {
      sim.step(FRAME);
      onStep?.(sim);
      const p = sim.state.phase;
      if (p !== 'firing' && p !== 'advancing') break;
    }
  }
}

describe('déterminisme', () => {
  it('même seed + mêmes entrées → snapshots identiques après 200 tirs', () => {
    const cfg = config();
    const a = newSim('det-seed', cfg);
    const b = newSim('det-seed', cfg);
    randomBot(a, 42, 200);
    randomBot(b, 42, 200);
    expect(a.state.stats.shots + a.state.depth).toBeGreaterThan(0);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('seeds différentes → runs différentes', () => {
    const a = newSim('seed-a');
    const b = newSim('seed-b');
    expect(a.snapshot().blocks).not.toEqual(b.snapshot().blocks);
  });
});

describe('snapshot / reprise', () => {
  it('reprise exacte, y compris au milieu d une volée', () => {
    const cfg = config();
    const m = meta(cfg);
    const a = createSim(cfg, { seed: 'snap', meta: m });
    randomBot(a, 7, 25);
    settle(a);
    if (a.state.phase === 'gameover') a.restart();
    a.aim({ x: 0.3, y: -1 });
    a.fire();
    for (let i = 0; i < 20; i++) a.step(FRAME);
    a.step(3.3); // reliquat d'accumulateur non multiple du sous-pas
    expect(a.state.phase).toBe('firing');
    const snap = a.snapshot();
    const b = createSim(cfg, { seed: 'snap', meta: m, snapshot: snap });
    expect(b.snapshot()).toEqual(snap);
    // l'instantané est une copie profonde
    expect(snap.balls).not.toBe(a.state.balls);
    for (const s of [a, b]) {
      for (let i = 0; i < 400; i++) s.step(FRAME);
      randomBot(s, 99, 30);
    }
    expect(b.snapshot()).toEqual(a.snapshot());
  });
});

function assertFinite(v: unknown, path: string): void {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`valeur non finie en ${path}: ${v}`);
  } else if (Array.isArray(v)) v.forEach((x, i) => assertFinite(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertFinite(x, `${path}.${k}`);
}

describe('robustesse', () => {
  it('1 000 tirs aléatoires sur 5 seeds : invariants respectés', () => {
    const cfg = config();
    const { cols, rows } = cfg.blocks.board;
    let shotsTotal = 0;
    for (let k = 0; k < 5; k++) {
      const sim = newSim(`robust-${k}`, cfg);
      const check = (s: Sim): void => {
        const st = s.state;
        for (const b of st.balls) {
          if (!b.alive) continue;
          if (!(Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y) && Number.isFinite(b.vel.x) && Number.isFinite(b.vel.y)))
            throw new Error(`balle ${b.id} non finie`);
          if (!(b.pos.x >= 0 && b.pos.x <= cols && b.pos.y >= 0 && b.pos.y <= rows))
            throw new Error(`balle ${b.id} hors plateau (${b.pos.x}, ${b.pos.y})`);
        }
        if (!(st.hp <= st.maxHp) || !Number.isFinite(st.hp)) throw new Error(`hp ${st.hp} > maxHp ${st.maxHp}`);
        if (st.volley.length < 1) throw new Error('volée vide');
        const seen = new Set<number>();
        for (const b of st.blocks) {
          for (let c = b.col; c < b.col + b.width; c++) {
            const key = b.row * 100 + c;
            if (seen.has(key)) throw new Error(`deux blocs sur la cellule ${c},${b.row}`);
            seen.add(key);
          }
        }
      };
      randomBot(sim, 1000 + k, 200, check);
      assertFinite(sim.snapshot(), 'state');
      shotsTotal += 200;
    }
    expect(shotsTotal).toBe(1000);
  }, 120_000);

  it('step(0), dt négatif ou NaN, actions hors phase : aucun effet indésirable', () => {
    const sim = newSim('edge');
    const before = sim.snapshot();
    sim.step(0);
    sim.step(-5);
    sim.step(Number.NaN);
    sim.recall();
    sim.chooseReward(0);
    sim.buy(0);
    sim.leaveShop();
    sim.fire(); // sans visée : rien
    expect(sim.snapshot()).toEqual(before);
    sim.aim({ x: 1, y: 0.05 }); // vers le bas et trop rasant → forcé vers le haut, angle min
    const d = sim.state.aimDir!;
    expect(d.y).toBeLessThan(0);
    expect(Math.abs(Math.atan2(-d.y, Math.abs(d.x)) * 180 / Math.PI - sim.config.blocks.board.minAimAngleDeg)).toBeLessThan(1e-6);
    const pts = sim.preview({ x: 0, y: -1 });
    expect(pts).toHaveLength(3);
    for (const p of pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('le tableau d événements est réutilisé et ne garde que les événements du pas', () => {
    const sim = newSim('events');
    const first = sim.step(FRAME);
    expect(first.some((e) => e.type === 'run:started')).toBe(true);
    const second = sim.step(FRAME);
    expect(second).toBe(first);
    expect(second.some((e) => e.type === 'run:started')).toBe(false);
    const evs = shoot(sim, { x: 0, y: -1 });
    expect(evs[0]?.type).toBe('volley:start');
  });
});
