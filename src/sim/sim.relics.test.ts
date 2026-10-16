import { describe, expect, it } from 'vitest';
import type { Block, Sim, VolleyBall } from '../core/types';
import { block, config, mut, newSim, ofType, setup, shoot } from './test-helpers';
import { useNeutralFun } from './test-helpers';

useNeutralFun();


const UP = { x: 0, y: -1 };
const hpOf = (sim: Sim, id: number): number | undefined => sim.state.blocks.find((b) => b.id === id)?.hp;

/** Plateau de test avec reliques. */
function withRelics(seed: string, relics: string[], blocks: (sim: Sim) => Block[], volley: VolleyBall[], rowsLeft = 3): Sim {
  const sim = newSim(seed);
  setup(sim, blocks(sim), volley, { rowsLeft });
  mut(sim).relics = relics;
  return sim;
}
const S1: VolleyBall = { element: 'stone', tier: 1 };

describe('reliques (20)', () => {
  it('relics.json contient 20 reliques aux ids uniques', () => {
    const ids = config().relics.defs.map((d) => d.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('bigboom : rayon des explosions ×2', () => {
    const sim = withRelics('bigboom', ['bigboom'], (s) => {
      const e = block(s, 'explosive', 3, 4, 10);
      e.hp = 1;
      return [e, block(s, 'normal', 0, 0, 999)];
    }, [S1]);
    expect(ofType(shoot(sim, UP), 'block:explode')[0]!.radius).toBeCloseTo(2.4);
  });

  it('ricochet : +1 combo sur les rebonds de mur/plafond', () => {
    const sim = withRelics('ricochet', ['ricochet'], (s) => [block(s, 'normal', 0, 0, 999)], [S1]);
    const wall = ofType(shoot(sim, UP), 'ball:bounce').filter((e) => e.surface === 'wall');
    expect(wall[0]!.combo).toBe(1);
  });

  it('flipper : une cheville donne +2 combo', () => {
    const sim = withRelics('flipper', ['flipper'], (s) => [block(s, 'peg', 3, 4, 0), block(s, 'normal', 0, 0, 999)], [S1]);
    const peg = ofType(shoot(sim, UP), 'ball:bounce').filter((e) => e.surface === 'peg');
    expect(peg[0]!.combo).toBe(2);
  });

  it('gourmand : un cœur rend 2 PV', () => {
    const sim = withRelics('gourmand', ['gourmand'], (s) => [block(s, 'heart', 3, 4, 1), block(s, 'normal', 0, 0, 999)], [S1]);
    mut(sim).hp = 2;
    shoot(sim, UP);
    expect(sim.state.hp).toBe(4);
  });

  it('pactole : +50 % de pièces', () => {
    const sim = withRelics('pactole', ['pactole'], (s) => [block(s, 'normal', 0, 0, 999)], [S1]);
    mut(sim).drops.push({ id: 8000, kind: 'coin', pos: { x: 6.5, y: 8.5 }, value: 4, element: null });
    shoot(sim, UP);
    expect(sim.state.coins).toBe(6);
  });

  it('pyromane : explosion de feu +50 % de rayon, brûlure de 10 % des PV max au tir suivant', () => {
    let bId = 0;
    const sim = withRelics('pyromane', ['pyromane'], (s) => {
      const b = block(s, 'normal', 4, 4, 1000);
      bId = b.id;
      return [block(s, 'normal', 3, 4, 1000), b];
    }, [{ element: 'fire', tier: 1 }]);
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'block:explode')[0]!.radius).toBeCloseTo(1.1 * 1.5);
    expect(hpOf(sim, bId)).toBe(994);
    mut(sim).volley = [S1];
    shoot(sim, UP);
    expect(hpOf(sim, bId)).toBe(894);
  });

  it('paratonnerre : la foudre chaîne 2 blocs', () => {
    const sim = withRelics('paratonnerre', ['paratonnerre'], (s) => [
      block(s, 'normal', 3, 4, 1000),
      block(s, 'normal', 5, 4, 1000),
      block(s, 'normal', 6, 6, 1000),
    ], [{ element: 'lightning', tier: 1 }]);
    const ch = ofType(shoot(sim, UP), 'lightning:chain');
    expect(ch).toHaveLength(2);
    expect(ch[1]!.from).toEqual(ch[0]!.to);
  });

  it('permafrost : un bloc gelé subit ×1,5', () => {
    const sim = withRelics('permafrost', ['permafrost'], (s) => [block(s, 'normal', 3, 4, 1000)], [{ element: 'ice', tier: 1 }, S1]);
    const hits = ofType(shoot(sim, UP), 'block:hit');
    expect(hits.map((h) => h.damage)).toEqual([10, 15]); // la glace gèle, la pierre frappe un bloc gelé
  });

  it('spectre : +2 combo par traversée fantôme', () => {
    const sim = withRelics('spectre', ['spectre'], (s) => [block(s, 'normal', 3, 4, 1000), block(s, 'normal', 3, 2, 1000)], [
      { element: 'ghost', tier: 1 },
    ]);
    expect(ofType(shoot(sim, UP), 'block:hit').map((h) => h.combo)).toEqual([0, 2, 4, 6]);
  });

  it('enclume : le plomb inflige 50 % de ses dégâts en zone', () => {
    let bId = 0;
    const sim = withRelics('enclume', ['enclume'], (s) => {
      const b = block(s, 'normal', 4, 4, 1000);
      bId = b.id;
      return [block(s, 'normal', 3, 4, 1000), b];
    }, [{ element: 'lead', tier: 1 }]);
    const ex = ofType(shoot(sim, UP), 'block:explode');
    expect(ex[0]!.radius).toBe(1);
    expect(hpOf(sim, bId)).toBe(985);
  });

  it('catalyseur : +20 % aux balles de rang ≥ 2', () => {
    const sim = withRelics('catalyseur', ['catalyseur'], (s) => [block(s, 'normal', 3, 4, 1000)], [{ element: 'stone', tier: 2 }]);
    expect(ofType(shoot(sim, UP), 'block:hit')[0]!.damage).toBe(30);
  });

  it('safetynet, firstblood, magnet, piggy, bouncy : couverts dans sim.mechanics.test.ts', () => {
    const ids = config().relics.defs.map((d) => d.id);
    for (const id of ['safetynet', 'firstblood', 'magnet', 'piggy', 'bouncy']) expect(ids).toContain(id);
  });

  it('mitose : la scission se divise en 3', () => {
    const sim = withRelics('mitose', ['mitose'], (s) => [block(s, 'normal', 3, 4, 1000)], [{ element: 'split', tier: 1 }]);
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'ball:split')).toHaveLength(1);
    expect(ofType(evs, 'ball:grounded')).toHaveLength(3);
  });

  it('alchimie : une fusion choisie donne +1 pierre', () => {
    const cfg = config();
    cfg.economy.reward.fuseChance = 1;
    const sim = newSim('alchimie', cfg);
    setup(sim, [block(sim, 'normal', 3, 4, 1)], [S1, S1, { element: 'fire', tier: 1 }]);
    mut(sim).relics = ['alchimie'];
    shoot(sim, UP);
    const idx = sim.state.rewardOffer!.findIndex((o) => o.kind === 'fuse');
    const n = sim.state.volley.length;
    sim.chooseReward(idx);
    expect(sim.state.volley.length).toBe(n); // −2 +1 fusion +1 pierre
    expect(sim.state.volley.some((v) => v.element === 'stone' && v.tier === 2)).toBe(true);
  });

  it('radar : ×2 sur le premier bloc touché par balle s il est dans la rangée la plus basse', () => {
    const a = withRelics('radar-a', ['radar'], (s) => [block(s, 'normal', 3, 4, 1000)], [S1]);
    expect(ofType(shoot(a, UP), 'block:hit')[0]!.damage).toBe(20);
    const b = withRelics('radar-b', ['radar'], (s) => [block(s, 'normal', 3, 4, 1000), block(s, 'normal', 0, 6, 1000)], [S1]);
    expect(ofType(shoot(b, UP), 'block:hit')[0]!.damage).toBe(10);
  });

  it('berserk : +10 % de dégâts par PV manquant', () => {
    const sim = withRelics('berserk', ['berserk'], (s) => [block(s, 'normal', 3, 4, 1000)], [S1]);
    mut(sim).hp = sim.state.maxHp - 2;
    expect(ofType(shoot(sim, UP), 'block:hit')[0]!.damage).toBe(12);
  });

  it('requiresElement : une relique d élément n est proposée que si la volée contient l élément', () => {
    const cfg = config();
    cfg.economy.reward.relicChance = 1;
    cfg.economy.reward.fuseChance = 0;
    for (let k = 0; k < 10; k++) {
      // pierre seule : aucun drop ne peut apporter de feu
      const sim = newSim(`req-${k}`, cfg, { unlockedRelics: ['pyromane', 'bouncy'], unlockedElements: ['stone'] });
      setup(sim, [block(sim, 'normal', 3, 4, 1)], [S1]);
      shoot(sim, UP);
      const relics = sim.state.rewardOffer!.filter((o) => o.kind === 'relic');
      expect(relics.some((o) => o.kind === 'relic' && o.relicId === 'pyromane')).toBe(false);
    }
    const sim = newSim('req-fire', cfg, { unlockedRelics: ['pyromane'] });
    setup(sim, [block(sim, 'normal', 3, 4, 1)], [{ element: 'fire', tier: 1 }]);
    shoot(sim, UP);
    expect(sim.state.rewardOffer!.some((o) => o.kind === 'relic' && o.relicId === 'pyromane')).toBe(true);
  });
});
