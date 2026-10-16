// Tests des 27 éléments (sim/elements) : une mécanique observable par nouvelle balle aux rangs I et III,
// plafond de balles vivantes, mini-balles jamais dorées, déterminisme et robustesse avec les 27 éléments.
import { describe, expect, it } from 'vitest';
import type { BallElement, BallTier, Block, Drop, GameConfig, GameEvent, MetaModifiers, RunSnapshot, Sim, Vec2, VolleyBall } from '../core/types';
import { createSim } from './index';
import {
  FRAME,
  block,
  meta as metaOf,
  config,
  createRng,
  mut,
  newSim,
  ofType,
  randomDir,
  settle,
  setup,
  shoot,
  useNeutralFun,
} from './test-helpers';

useNeutralFun(); // dorée ×1, pas de pénalité d'éventail, pas de contrat : dégâts attendus exacts

const UP: Vec2 = { x: 0, y: -1 };
const ALL: BallElement[] = config().balls.defs.map((d) => d.id);
const STURDY = 1_000_000;

function vb(element: BallElement, tier: BallTier, n = 1): VolleyBall[] {
  return Array.from({ length: n }, () => ({ element, tier }));
}

/** Tir unique : plateau `blocks`, volée `volley`, départ launchX (défaut 3.5), direction `dir`. */
function single(
  seed: string,
  volley: VolleyBall[],
  blocks: (sim: Sim) => Block[],
  dir: Vec2 = UP,
  launchX = 3.5,
  prep?: (sim: Sim) => void,
): { sim: Sim; evs: GameEvent[] } {
  const sim = newSim(seed);
  setup(sim, blocks(sim), volley, { launchX, rowsLeft: 1 });
  if (prep) prep(sim);
  const evs = shoot(sim, dir);
  return { sim, evs };
}

function hitsOn(evs: GameEvent[], id: number): Extract<GameEvent, { type: 'block:hit' }>[] {
  return ofType(evs, 'block:hit').filter((e) => e.blockId === id);
}

function coin(sim: Sim, x: number, y: number, value: number): Drop {
  const d: Drop = { id: mut(sim).internal.nextId++, kind: 'coin', pos: { x, y }, value, element: null };
  mut(sim).drops.push(d);
  return d;
}

const TIERS: BallTier[] = [1, 3];
const CFG = config();
/** Paramètre de balls.json au rang `tier`. */
function P(el: BallElement, key: string, tier: BallTier): number {
  return CFG.balls.defs.find((d) => d.id === el)!.params![key]![tier - 1]!;
}
/** Dégâts de base d'une balle (rang, sans combo). */
function base(el: BallElement, tier: BallTier): number {
  return CFG.balls.defs.find((d) => d.id === el)!.baseDamage * Math.pow(CFG.balls.tierDamageMultiplier, tier - 1);
}

describe('éléments : acide', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : charges posées, puis ${tier === 1 ? 6 : 12} % des PV max au début du tir suivant`, () => {
      let id = -1;
      const { sim } = single(`acid-${tier}`, vb('acid', tier), (s) => {
        const b = block(s, 'normal', 3, 3, 1000);
        id = b.id;
        return [b];
      });
      const charges = mut(sim).internal.acidQ;
      expect(charges[0]).toBe(id);
      expect(sim.state.blocks.find((b) => b.id === id)!.acidCharges).toBe(charges.length / 4);
      sim.aim(UP);
      sim.fire();
      const start = ofType(sim.step(0), 'block:hit').filter((e) => e.element === 'acid' && e.ballId === -1);
      expect(start.length).toBeGreaterThanOrEqual(1);
      expect(start[0]!.damage).toBe(tier === 1 ? 60 : 120);
    });
  }
});

describe('éléments : aimant', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : ramasse un drop à ${tier === 1 ? '1,0' : '2,1'} u de sa route`, () => {
      const off = tier === 1 ? 1.0 : 2.1;
      const run = (el: BallElement, t: BallTier): number => {
        const { evs } = single(`magnet-${tier}`, vb(el, t), (s) => [block(s, 'normal', 0, 0, STURDY)], UP, 3.5, (s) => {
          coin(s, 3.5 + off, 5, 3);
        });
        const end = evs.findIndex((e) => e.type === 'volley:end');
        return ofType(evs.slice(0, end), 'drop:collected').length;
      };
      expect(run('magnet', tier)).toBe(1);
      expect(run('stone', 1)).toBe(0);
      if (tier === 3) expect(run('magnet', 1)).toBe(0); // 2,1 u : hors de portée au rang I (1,2 u)
    });
  }
});

describe('éléments : perforante', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : traverse ${tier === 1 ? 1 : 3} bloc(s) (×1,5), puis rebondit`, () => {
      const ids: number[] = [];
      const { evs } = single(`pierce-${tier}`, vb('pierce', tier), (s) => {
        const bs = [5, 4, 3, 2].map((r) => block(s, 'normal', 3, r, STURDY));
        for (const b of bs) ids.push(b.id);
        return bs;
      });
      expect(hitsOn(evs, ids[0]!)[0]!.damage).toBe(Math.round(base('pierce', tier) * P('pierce', 'damageMult', tier)));
      const n = P('pierce', 'pierces', tier);
      // le bloc juste après les traversées est rebondi ; le suivant n'est jamais touché
      expect(hitsOn(evs, ids[n]!).length).toBeGreaterThan(0);
      if (n + 1 < ids.length) expect(hitsOn(evs, ids[n + 1]!).length).toBe(0);
      const firstBounce = ofType(evs, 'ball:bounce')[0]!;
      expect(firstBounce.surface).toBe('block');
    });
  }
});

describe('éléments : bombe', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : explose au sol (rayon ${tier === 1 ? '1,4' : '2,2'}, ×3)`, () => {
      const ids: number[] = [];
      const { evs } = single(`bomb-${tier}`, vb('bomb', tier), (s) => {
        const near = block(s, 'normal', 4, 8, STURDY);
        const far = block(s, 'normal', 5, 8, STURDY);
        ids.push(near.id, far.id);
        return [near, far];
      });
      const ex = ofType(evs, 'block:explode');
      expect(ex.length).toBe(1);
      expect(ex[0]!.element).toBe('bomb');
      expect(ex[0]!.damage).toBeCloseTo(tier === 1 ? 30 : 187.5);
      expect(hitsOn(evs, ids[0]!).length).toBe(1);
      expect(hitsOn(evs, ids[1]!).length).toBe(tier === 1 ? 0 : 1);
    });
  }
});

describe('éléments : traqueuse', () => {
  /** angle (degrés) entre la vitesse de la traqueuse et celle de la pierre juste après le premier rebond de mur */
  function deviation(tier: BallTier): number {
    const velAfterBounce = (el: BallElement): Vec2 => {
      const sim = newSim(`homing-${tier}`);
      setup(sim, [block(sim, 'normal', 0, 8, STURDY)], vb(el, tier), { launchX: 3.5, rowsLeft: 1 });
      sim.aim({ x: 0.5, y: -0.866 });
      sim.fire();
      for (let f = 0; f < 600; f++) {
        if (ofType(sim.step(FRAME), 'ball:bounce').length > 0) break;
      }
      const b = sim.state.balls[0]!;
      return { x: b.vel.x, y: b.vel.y };
    };
    const h = velAfterBounce('homing');
    const s = velAfterBounce('stone');
    return (Math.abs(Math.atan2(h.y, h.x) - Math.atan2(s.y, s.x)) * 180) / Math.PI;
  }
  for (const tier of TIERS) {
    it(`rang ${tier} : dévie de ${tier === 1 ? 12 : 30}° au plus vers le bloc le plus proche`, () => {
      expect(deviation(tier)).toBeCloseTo(tier === 1 ? 12 : 30, 0);
    });
  }
});

describe('éléments : géante', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : rayon ×${tier === 1 ? '1,8' : '2,4'}, vitesse ×0,85, dégâts ×2`, () => {
      const sim = newSim(`giant-${tier}`);
      const b = block(sim, 'normal', 3, 3, STURDY);
      setup(sim, [b], vb('giant', tier), { launchX: 3.5, rowsLeft: 1 });
      sim.aim(UP);
      sim.fire();
      sim.step(FRAME);
      const ball = sim.state.balls[0]!;
      const cfg = sim.config;
      expect(ball.radius).toBeCloseTo(cfg.blocks.board.ballRadius * (tier === 1 ? 1.8 : 2.4));
      expect(Math.hypot(ball.vel.x, ball.vel.y)).toBeCloseTo(cfg.blocks.board.ballSpeed * 0.85);
      const evs: GameEvent[] = [];
      for (let f = 0; f < 2000 && sim.state.phase === 'firing'; f++) evs.push(...sim.step(FRAME));
      expect(hitsOn(evs, b.id)[0]!.damage).toBe(tier === 1 ? 20 : 125);
    });
  }
});

describe('éléments : essaim', () => {
  it('mini-balles « pierre » (rayon ×0,6, jamais dorées), plus fréquentes au rang III qu au rang I', () => {
    const spawns = (tier: BallTier): number => {
      let n = 0;
      for (let i = 0; i < 6; i++) {
        const sim = newSim(`swarm-${tier}-${i}`);
        const roof = [0, 1, 2, 3, 4, 5, 6].map((c) => block(sim, 'normal', c, 0, STURDY));
        setup(sim, roof, vb('swarm', tier, 10), { launchX: 3.5, rowsLeft: 1 });
        sim.aim(UP);
        sim.fire();
        for (let f = 0; f < 3000 && sim.state.phase === 'firing'; f++) {
          const evs = sim.step(FRAME);
          n += ofType(evs, 'ball:split').filter((e) => e.element === 'swarm').length;
          const st = mut(sim);
          st.balls.forEach((b, k) => {
            if (st.internal.bfx[k]!.mini) {
              expect(b.element).toBe('stone');
              expect(b.golden).toBe(false);
              expect(b.radius).toBeCloseTo(sim.config.blocks.board.ballRadius * 0.6);
            }
          });
        }
      }
      return n;
    };
    const one = spawns(1);
    const three = spawns(3);
    expect(one).toBeGreaterThan(0);
    expect(three).toBeGreaterThan(one);
  });
});

describe('éléments : vampire', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : rend 1 PV par bloc détruit, ${tier} fois par tir`, () => {
      const { evs, sim } = single(
        `vamp-${tier}`,
        vb('vampire', tier),
        (s) => [
          block(s, 'explosive', 3, 5, 1),
          block(s, 'normal', 2, 5, 1),
          block(s, 'normal', 4, 5, 1),
          block(s, 'normal', 3, 4, 1),
          block(s, 'normal', 0, 0, STURDY),
        ],
        UP,
        3.5,
        (s) => {
          mut(s).hp = 1;
        },
      );
      const heals = ofType(evs, 'player:healed');
      expect(heals.length).toBe(tier);
      for (const h of heals) expect(h.source).toBe('vampire');
      for (const h of heals) expect(h.pos).toBeDefined();
      expect(sim.state.hp).toBe(1 + tier);
    });
  }
});

describe('éléments : or', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : chaque bloc détruit lâche des pièces (×${tier === 1 ? '1,5' : 3}) ; dégâts ×0,7`, () => {
      const { evs, sim } = single(`gold-${tier}`, vb('gold', tier), (s) => [
        block(s, 'explosive', 3, 5, 1),
        block(s, 'normal', 2, 5, 1),
        block(s, 'normal', 4, 5, 1),
        block(s, 'normal', 0, 0, STURDY),
      ]);
      const killed = ofType(evs, 'block:destroyed').length;
      const spawned = ofType(evs, 'drop:spawned');
      expect(killed).toBe(3);
      expect(spawned.length).toBe(killed);
      for (const d of spawned) expect(d.kind).toBe('coin');
      const t = sim.config.blocks.drops.coinValue;
      const m = P('gold', 'coinMult', tier);
      const values = [...ofType(evs, 'drop:collected').map((e) => e.value), ...sim.state.drops.map((d) => d.value)];
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(Math.round(t.min * m));
        expect(v).toBeLessThanOrEqual(Math.round(t.max * m));
      }
      const hit = single(`gold-dmg-${tier}`, vb('gold', tier), (s) => [block(s, 'normal', 3, 3, STURDY)]);
      expect(ofType(hit.evs, 'block:hit')[0]!.damage).toBe(Math.round(base('gold', tier) * P('gold', 'damageMult', tier)));
    });
  }
});

describe('éléments : prisme', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : rebond de mur → rayon sur la rangée (rowRatio)`, () => {
      const { evs } = single(
        `prism-${tier}`,
        vb('prism', tier),
        (s) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => block(s, 'normal', 0, r, STURDY)),
        { x: 1, y: -1 },
      );
      const rays = ofType(evs, 'lightning:chain').filter((e) => e.element === 'prism');
      expect(rays.length).toBeGreaterThan(0);
      expect(rays[0]!.damage).toBeCloseTo(base('prism', tier) * P('prism', 'rowRatio', tier));
    });
  }
});

describe('éléments : vide', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : +${tier === 1 ? 6 : 12} % des PV max par impact et ignore l armure`, () => {
      const hit = single(`void-${tier}`, vb('void', tier), (s) => [block(s, 'normal', 3, 3, 1000)]);
      expect(ofType(hit.evs, 'block:hit')[0]!.damage).toBe(tier === 1 ? 70 : 183);
      // blindé frappé par le côté : la pierre ne fait rien, le vide si
      const side = (el: BallElement): number => {
        let id = -1;
        const { evs } = single(
          `void-side-${tier}`,
          vb(el, tier),
          (s) => {
            const a = block(s, 'armored', 4, 8, 1000);
            id = a.id;
            return [a];
          },
          { x: Math.cos((20 * Math.PI) / 180), y: -Math.sin((20 * Math.PI) / 180) },
          1,
        );
        return hitsOn(evs, id).reduce((n, e) => n + e.damage, 0);
      };
      expect(side('stone')).toBe(0);
      expect(side('void')).toBeGreaterThan(0);
    });
  }
});

describe('éléments : écho', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : au sol, une copie traversante (${tier === 1 ? 50 : 100} %) repart vers le haut`, () => {
      let id = -1;
      const { evs } = single(`echo-${tier}`, vb('echo', tier), (s) => {
        const b = block(s, 'normal', 3, 0, STURDY);
        id = b.id;
        return [b];
      });
      const launched = ofType(evs, 'ball:launched');
      expect(launched.length).toBe(2);
      const copy = launched[1]!;
      expect(copy.element).toBe('echo');
      expect(copy.golden).toBe(false);
      expect(ofType(evs, 'ball:launched').length).toBe(2);
      const copyHits = hitsOn(evs, id).filter((e) => e.ballId === copy.ballId);
      expect(copyHits.length).toBeGreaterThan(0);
      expect(copyHits[0]!.damage).toBe(tier === 1 ? 5 : 63);
      // une seule fois : la copie ne relance pas de copie
      expect(ofType(evs, 'ball:grounded').length).toBe(2);
    });
  }
});

describe('éléments : boomerang', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : revient se poser au point de lancement (${tier} aller(s)-retour(s))`, () => {
      const { evs } = single(`boom-${tier}`, vb('boomerang', tier), (s) => [block(s, 'normal', 0, 0, STURDY)], { x: 0.4, y: -1 }, 3.5);
      const grounded = ofType(evs, 'ball:grounded');
      expect(grounded.length).toBe(1);
      expect(grounded[0]!.pos.x).toBeCloseTo(3.5, 1);
      const relaunch = ofType(evs, 'ball:bounce').filter((e) => e.normal.y === -1);
      expect(relaunch.length).toBe(tier - 1);
    });
  }
});

describe('éléments : cristal', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : +perBouncePct % par rebond, éclate après ${tier === 1 ? 8 : 12} rebonds en 4 éclats non dorés`, () => {
      const sim = newSim(`crystal-${tier}`);
      const roof = [0, 1, 2, 3, 4, 5, 6].map((c) => block(sim, 'normal', c, 0, STURDY));
      setup(sim, roof, vb('crystal', tier), { launchX: 3.5, rowsLeft: 1 });
      sim.aim({ x: 1, y: -0.2 });
      sim.fire();
      const evs: GameEvent[] = [];
      let shards = 0;
      for (let f = 0; f < 3000 && sim.state.phase === 'firing'; f++) {
        evs.push(...sim.step(FRAME));
        const st = mut(sim);
        st.balls.forEach((b, k) => {
          if (st.internal.bfx[k]!.mini) {
            expect(b.golden).toBe(false);
            shards = Math.max(shards, st.balls.length);
          }
        });
      }
      const crystalId = ofType(evs, 'ball:launched')[0]!.ballId;
      const split = evs.findIndex((e) => e.type === 'ball:split' && e.element === 'crystal');
      expect(split).toBeGreaterThan(0);
      const before = ofType(evs.slice(0, split), 'ball:bounce').filter((e) => e.ballId === crystalId);
      expect(before.length).toBe(tier === 1 ? 8 : 12);
      expect(shards).toBe(4);
      // dégâts : base × combo × (1 + 0,2 × rebonds précédents)
      const b0 = base('crystal', tier);
      const pct = P('crystal', 'perBouncePct', tier) / 100;
      let bounces = 0;
      for (const e of evs.slice(0, split)) {
        if (e.type === 'ball:bounce' && e.ballId === crystalId) bounces++;
        if (e.type === 'block:hit' && e.ballId === crystalId) {
          expect(e.damage).toBe(Math.max(1, Math.round(b0 * (1 + CFG.balls.comboDamagePerBounce * e.combo) * (1 + pct * bounces))));
        }
      }
    });
  }
});

describe('éléments : choc', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : le bloc touché remonte, ${tier} fois par tir au plus`, () => {
      let target: Block | null = null;
      const { sim } = single(`shock-${tier}`, vb('shock', tier, 3), (s) => {
        target = block(s, 'normal', 3, 5, STURDY);
        return [target, block(s, 'normal', 0, 0, STURDY)];
      });
      const b = sim.state.blocks.find((x) => x.id === target!.id)!;
      // 5 − reculs + 1 (avancée de fin de tir)
      expect(b.row).toBe(5 - tier + 1);
    });
  }
  it('ne remonte pas si la case du dessus est occupée', () => {
    let target: Block | null = null;
    const { sim } = single('shock-blocked', vb('shock', 3), (s) => {
      target = block(s, 'normal', 3, 5, STURDY);
      return [target, block(s, 'normal', 3, 4, STURDY)];
    });
    expect(sim.state.blocks.find((x) => x.id === target!.id)!.row).toBe(6);
  });
});

describe('éléments : jumelle', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : ${tier === 1 ? 2 : 4} balles en éventail, ×0,7 chacune`, () => {
      const { evs } = single(`twin-${tier}`, vb('twin', tier), (s) => [0, 1, 2, 3, 4, 5, 6].map((c) => block(s, 'normal', c, 0, STURDY)));
      const launched = ofType(evs, 'ball:launched');
      expect(launched.length).toBe(tier === 1 ? 2 : 4);
      expect(launched.filter((e) => e.golden).length).toBe(1); // seule la balle de la volée garde la dorure
      expect(ofType(evs, 'block:hit')[0]!.damage).toBe(tier === 1 ? 7 : 44);
    });
  }
});

describe('éléments : rouille', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : −${tier === 1 ? 15 : 30} % de PV max (plafonné à cap) définitivement, et perte de l armure`, () => {
      let id = -1;
      const { evs, sim } = single(`rust-${tier}`, vb('rust', tier), (s) => {
        const b = block(s, 'normal', 3, 3, 1000);
        id = b.id;
        return [b];
      });
      const b = sim.state.blocks.find((x) => x.id === id)!;
      const loss = Math.min((P('rust', 'pctMaxHp', tier) / 100) * 1000, P('rust', 'cap', tier));
      expect(b.maxHp).toBe(Math.round(1000 - loss));
      expect(hitsOn(evs, id)[0]!.damage).toBe(Math.round(base('rust', tier) + loss));
      let aid = -1;
      const side = single(
        `rust-side-${tier}`,
        vb('rust', tier),
        (s) => {
          const a = block(s, 'armored', 4, 8, 1000);
          aid = a.id;
          return [a];
        },
        { x: Math.cos((20 * Math.PI) / 180), y: -Math.sin((20 * Math.PI) / 180) },
        1,
      );
      expect(hitsOn(side.evs, aid)[0]!.damage).toBeGreaterThan(0);
    });
  }
});

describe('éléments : nova', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : palier de combo → explosion (combo × ${tier === 1 ? 3 : 6})`, () => {
      const { evs } = single(
        `nova-${tier}`,
        vb('nova', tier),
        (s) => [block(s, 'normal', 3, 3, STURDY), block(s, 'normal', 4, 3, STURDY)],
        UP,
        3.5,
        (s) => {
          mut(s).relics = ['bouncy']; // combo de départ 2 : premier impact = palier 3
        },
      );
      const ex = ofType(evs, 'block:explode').filter((e) => e.element === 'nova');
      expect(ex.length).toBeGreaterThan(0);
      expect(ex[0]!.damage).toBe(3 * (tier === 1 ? 3 : 6));
    });
  }
});

describe('éléments : comète', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : vitesse ×1,4, plafond → +${tier === 1 ? 3 : 6} combo`, () => {
      const sim = newSim(`comet-${tier}`);
      setup(sim, [block(sim, 'normal', 0, 0, STURDY)], vb('comet', tier), { launchX: 3.5, rowsLeft: 1 });
      sim.aim(UP);
      sim.fire();
      sim.step(FRAME);
      const b = sim.state.balls[0]!;
      expect(Math.hypot(b.vel.x, b.vel.y)).toBeCloseTo(sim.config.blocks.board.ballSpeed * 1.4);
      const evs: GameEvent[] = [];
      for (let f = 0; f < 2000 && sim.state.phase === 'firing'; f++) evs.push(...sim.step(FRAME));
      const ceil = ofType(evs, 'ball:bounce').find((e) => e.normal.y === 1)!;
      expect(ceil.combo).toBe(tier === 1 ? 3 : 6);
    });
  }
});

describe('éléments : chance', () => {
  for (const tier of TIERS) {
    it(`rang ${tier} : critiques ×3 (~${tier === 1 ? 20 : 40} %), drops ramassés doublés`, () => {
      const { evs } = single(`lucky-${tier}`, vb('lucky', tier, 30), (s) => [0, 1, 2, 3, 4, 5, 6].map((c) => block(s, 'normal', c, 0, STURDY)));
      const b0 = base('lucky', tier);
      const first = ofType(evs, 'block:hit').filter((e) => e.combo === 0);
      const crits = first.filter((e) => e.crit);
      expect(crits.length).toBeGreaterThan(0);
      for (const c of crits) expect(c.damage).toBe(Math.round(b0 * P('lucky', 'critMult', tier)));
      for (const c of first.filter((e) => !e.crit)) expect(c.damage).toBe(Math.round(b0));
      const rate = crits.length / first.length;
      expect(rate).toBeGreaterThan(tier === 1 ? 0.05 : 0.2);
      expect(rate).toBeLessThan(tier === 1 ? 0.4 : 0.65);
      // drop ramassé : valeur ×2
      const pick = single(`lucky-drop-${tier}`, vb('lucky', tier), (s) => [block(s, 'normal', 0, 0, STURDY)], UP, 3.5, (s) => {
        coin(s, 3.5, 5, 3);
      });
      expect(ofType(pick.evs, 'drop:collected')[0]!.value).toBe(6);
    });
  }
});

// ---------------------------------------------------------------------------------------------------

describe('mini-balles : plafond et dorure', () => {
  for (const el of ['twin', 'swarm', 'crystal', 'echo'] as BallElement[]) {
    it(`${el} III ×10 (jusqu à 40 balles voulues) : jamais plus de maxLiveBalls (30) vivantes, mini-balles jamais dorées`, () => {
      const sim = newSim(`cap-${el}`);
      const roof = [0, 1, 2, 3, 4, 5, 6].map((c) => block(sim, 'normal', c, 0, STURDY));
      setup(sim, roof, vb(el, 3, 10), { launchX: 3.5, rowsLeft: 1 });
      sim.aim({ x: 1, y: -0.2 }); // rasant : beaucoup de rebonds (cristal)
      sim.fire();
      let max = 0;
      let minis = 0;
      for (let f = 0; f < 3000 && sim.state.phase === 'firing'; f++) {
        sim.step(FRAME);
        const st = mut(sim);
        expect(st.internal.bfx.length).toBe(st.balls.length);
        max = Math.max(max, st.balls.length);
        st.balls.forEach((b, k) => {
          if (st.internal.bfx[k]!.mini) {
            minis++;
            expect(b.kind).toBe(el === 'echo' ? 'echo' : 'mini');
            expect(b.golden).toBe(false);
          }
        });
      }
      expect(max).toBeLessThanOrEqual(sim.config.balls.maxLiveBalls);
      expect(minis).toBeGreaterThan(0);
      if (el === 'twin') expect(max).toBe(sim.config.balls.maxLiveBalls); // 10 × 4 > 30 : plafond atteint
    });
  }
});

/** Volée mixte : les 27 éléments, rangs variés. */
function mixedVolley(): VolleyBall[] {
  return ALL.map((element, i) => ({ element, tier: ((i % 3) + 1) as BallTier }));
}

/** Joue `shots` tirs aléatoires ; à la mort, relance et remet la volée mixte. Vérifie l'état à chaque image. */
function playMixed(sim: Sim, seed: string, shots: number, check: boolean): void {
  const rng = createRng(seed);
  const { cols, rows } = sim.config.blocks.board;
  mut(sim).volley = mixedVolley();
  for (let k = 0; k < shots; k++) {
    if (sim.state.phase === 'gameover') {
      sim.restart();
      mut(sim).volley = mixedVolley();
    }
    settle(sim);
    if (sim.state.phase !== 'aiming') continue;
    sim.aim(randomDir(rng), rng.next());
    sim.fire();
    for (let f = 0; f < 5000; f++) {
      sim.step(FRAME);
      const st = sim.state;
      if (check) {
        for (const b of st.balls) {
          if (!Number.isFinite(b.pos.x) || !Number.isFinite(b.pos.y) || !Number.isFinite(b.vel.x) || !Number.isFinite(b.vel.y)) {
            throw new Error(`NaN balle ${b.element}`);
          }
          if (b.pos.x < 0 || b.pos.x > cols || b.pos.y < 0 || b.pos.y > rows) throw new Error(`balle hors plateau ${b.element}`);
        }
        for (const b of st.blocks) if (!Number.isFinite(b.hp) || !Number.isFinite(b.maxHp)) throw new Error('NaN bloc');
        for (const d of st.drops) if (!Number.isFinite(d.pos.y) || !Number.isFinite(d.value)) throw new Error('NaN drop');
        if (!Number.isFinite(st.hp) || !Number.isFinite(st.coins)) throw new Error('NaN joueur');
      }
      if (st.phase !== 'firing' && st.phase !== 'advancing') break;
    }
  }
}

describe('27 éléments : déterminisme et robustesse', () => {
  it('même seed → même snapshot après 200 tirs (volée mixte des 27 éléments)', () => {
    const cfg = config();
    const over = { unlockedElements: ALL };
    const a = newSim('det27', cfg, over);
    const b = newSim('det27', cfg, over);
    playMixed(a, 'det27-aim', 200, false);
    playMixed(b, 'det27-aim', 200, false);
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  }, 120_000);

  it('reprise depuis un snapshot en plein tir : même suite', () => {
    const cfg = config();
    const over = { unlockedElements: ALL };
    const a = newSim('resume27', cfg, over);
    playMixed(a, 'resume27-aim', 20, false);
    settle(a);
    a.aim({ x: 0.3, y: -1 });
    a.fire();
    for (let f = 0; f < 40; f++) a.step(FRAME);
    const snap = a.snapshot();
    const resumed = newSimFromSnapshot(snap, cfg, over);
    for (let f = 0; f < 600; f++) {
      a.step(FRAME);
      resumed.step(FRAME);
    }
    expect(JSON.stringify(resumed.snapshot())).toBe(JSON.stringify(a.snapshot()));
  });

  it('500 tirs aléatoires, volée mixte des 27 : aucun NaN, aucune balle hors plateau', () => {
    const sim = newSim('robust27', config(), { unlockedElements: ALL });
    playMixed(sim, 'robust27-aim', 500, true);
    expect(sim.state.stats.shots).toBeGreaterThan(0);
  }, 300_000);
});

function newSimFromSnapshot(snapshot: RunSnapshot, cfg: GameConfig, over: Partial<MetaModifiers>): Sim {
  return createSim(cfg, { seed: snapshot.seed, meta: metaOf(cfg, over), snapshot });
}

describe('déblocages et contrats', () => {
  it('offres, boutique et drops ne proposent jamais un élément non débloqué', () => {
    const unlocked: BallElement[] = ['stone', 'acid', 'gold', 'twin'];
    const seen = new Set<BallElement>();
    for (let i = 0; i < 6; i++) {
      const sim = newSim(`unlock-${i}`, config(), { unlockedElements: unlocked });
      const rng = createRng(`unlock-aim-${i}`);
      for (let k = 0; k < 120 && sim.state.phase !== 'gameover'; k++) {
        const evs: GameEvent[] = [];
        settle(sim, evs);
        if (sim.state.phase !== 'aiming') break;
        evs.push(...shoot(sim, randomDir(rng)));
        for (const e of evs) {
          if (e.type === 'reward:offered') for (const o of e.options) if (o.kind === 'ball' || o.kind === 'fuse') seen.add(o.element);
          if (e.type === 'shop:opened') for (const it of e.shop.items) if (it.option.kind === 'ball') seen.add(it.option.element);
        }
        for (const d of sim.state.drops) if (d.element) seen.add(d.element);
      }
    }
    for (const el of seen) expect(unlocked).toContain(el);
    expect(seen.size).toBeGreaterThan(1);
  }, 60_000);

  it('contrats killWithElement acide/bombe/prisme/nova : minWave 3, tirés seulement si l élément est dans la volée', () => {
    const cfg = config();
    cfg.contracts.chance = 1;
    const ids = ['acid3', 'bomb3', 'prism3', 'nova3'];
    for (const id of ids) {
      const d = cfg.contracts.defs.find((x) => x.id === id)!;
      expect(d.kind).toBe('killWithElement');
      expect(d.minWave).toBe(3);
    }
    const offered = (volley: VolleyBall[]): { id: string; wave: number }[] => {
      const out: { id: string; wave: number }[] = [];
      for (let i = 0; i < 12; i++) {
        const sim = createSim(cfg, { seed: `ctr-${i}`, meta: metaOf(cfg, {}) });
        for (let w = 1; w <= 8; w++) {
          const s = mut(sim);
          s.volley = volley.map((v) => ({ ...v }));
          s.wave = w;
          s.phase = 'shop';
          s.shop = { items: [], rerollCost: 0, rerollsUsed: 0 };
          sim.leaveShop(); // nextWave : wave + 1, startWave → offerContract
          for (const e of sim.step(0)) if (e.type === 'contract:offered') out.push({ id: e.def.id, wave: sim.state.wave });
        }
      }
      return out;
    };
    const none = offered(vb('stone', 1, 5));
    for (const o of none) expect(ids).not.toContain(o.id);
    const withAll = offered([...vb('acid', 1), ...vb('bomb', 1), ...vb('prism', 1), ...vb('nova', 1)]);
    const mine = withAll.filter((o) => ids.includes(o.id));
    expect(mine.length).toBeGreaterThan(0);
    for (const o of mine) expect(o.wave).toBeGreaterThanOrEqual(3);
  });
});

describe('garde-fous de fin de partie', () => {
  const HUGE = 1e9;
  for (const tier of TIERS) {
    it(`rang ${tier} : vide, rouille, acide plafonnés par touche sur un bloc énorme`, () => {
      const v = single(`capv-${tier}`, vb('void', tier), (s) => [block(s, 'normal', 3, 3, HUGE)]);
      expect(ofType(v.evs, 'block:hit')[0]!.damage).toBe(Math.round(base('void', tier) + P('void', 'cap', tier)));
      const r = single(`capr-${tier}`, vb('rust', tier), (s) => [block(s, 'normal', 3, 3, HUGE)]);
      expect(ofType(r.evs, 'block:hit')[0]!.damage).toBe(Math.round(base('rust', tier) + P('rust', 'cap', tier)));
      const a = single(`capa-${tier}`, vb('acid', tier), (s) => [block(s, 'normal', 3, 3, HUGE)]);
      a.sim.aim(UP);
      a.sim.fire();
      const tick = ofType(a.sim.step(0), 'block:hit').filter((e) => e.element === 'acid' && e.ballId === -1);
      expect(tick[0]!.damage).toBe(P('acid', 'capPerTurn', tier));
    });
    it(`rang ${tier} : nova et prisme plafonnés`, () => {
      const n = single(
        `capn-${tier}`,
        vb('nova', tier),
        (s) => [block(s, 'normal', 3, 3, HUGE), block(s, 'normal', 4, 3, HUGE)],
        UP,
        3.5,
        (s) => {
          mut(s).relics = ['bouncy'];
        },
      );
      for (const e of ofType(n.evs, 'block:explode').filter((x) => x.element === 'nova')) expect(e.damage).toBeLessThanOrEqual(P('nova', 'cap', tier));
      const cfg = config();
      cfg.balls.defs.find((d) => d.id === 'prism')!.params!.cap = [2, 2, 2];
      const sim = newSim(`capp-${tier}`, cfg);
      setup(sim, [1, 2, 3, 4, 5, 6, 7, 8].map((r) => block(sim, 'normal', 0, r, HUGE)), vb('prism', tier), { launchX: 3.5, rowsLeft: 1 });
      const rays = ofType(shoot(sim, { x: 1, y: -1 }), 'lightning:chain').filter((e) => e.element === 'prism');
      expect(rays.length).toBeGreaterThan(0);
      for (const e of rays) expect(e.damage).toBe(2);
    });
  }
  it('brèche : breachDamageCapPerShot + floor((vague − lateWave) / 5) au-delà de lateWave ; rangée en plus tous les 2 tirs', () => {
    const cfg = config();
    const late = cfg.waves.lateWave!;
    const per = cfg.blocks.breachDamageCapPerShot!;
    const breach = (wave: number): number => {
      const sim = newSim(`breach-${wave}`, cfg);
      const s = mut(sim);
      const rows = cfg.blocks.board.rows;
      setup(sim, [0, 1, 2, 3, 4, 5, 6].map((c) => block(sim, 'normal', c, rows - 2, 100)), vb('stone', 1), { rowsLeft: 3 });
      s.wave = wave;
      s.hp = s.maxHp = 50;
      const evs = shoot(sim, { x: -1, y: -0.15 });
      return ofType(evs, 'player:damaged').reduce((n, e) => n + e.amount, 0);
    };
    expect(breach(late - 1)).toBe(per);
    expect(breach(late + 5)).toBe(per + 1);
    expect(breach(late + 12)).toBe(per + 2);
    // rangée supplémentaire : au 2e tir d'une vague tardive, deux rangées entrent
    const sim = newSim('extra-row', cfg);
    const s = mut(sim);
    setup(sim, [block(sim, 'normal', 0, 0, 1e9)], vb('stone', 1), { rowsLeft: 5 });
    s.wave = late;
    s.shotInWave = 1;
    const before = s.rowsLeftInWave;
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'rows:advanced').length).toBe(1);
    expect(sim.state.rowsLeftInWave).toBe(before - 1); // la rangée en plus ne consomme pas le quota
    const top = sim.state.blocks.filter((b) => b.row <= 1).length;
    expect(top).toBeGreaterThan(1);
  });
});
