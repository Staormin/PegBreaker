import { describe, expect, it } from 'vitest';
import type { Block } from '../core/types';
import { block, config, createRng, mut, newSim, ofType, randomDir, settle, setup, shoot } from './test-helpers';

const UP = { x: 0, y: -1 };
const hpOf = (blocks: readonly Block[], id: number): number | undefined => blocks.find((b) => b.id === id)?.hp;

describe('démarrage', () => {
  it('run initiale : aiming, 3 rangées (0..2), launchPos centré, run:started', () => {
    const sim = newSim('start');
    const s = sim.state;
    const cfg = sim.config;
    expect(s.phase).toBe('aiming');
    expect(s.launchPos).toEqual({ x: cfg.blocks.board.cols / 2, y: cfg.blocks.board.rows });
    expect(new Set(s.blocks.map((b) => b.row))).toEqual(new Set([0, 1, 2]));
    expect(s.rowsLeftInWave).toBe(5 - 3);
    expect(s.hp).toBe(cfg.waves.start.hp);
    expect(sim.step(0).some((e) => e.type === 'run:started')).toBe(true);
  });

  it('meta : bonus de PV et de balles', () => {
    const sim = newSim('meta', config(), { bonusHp: 2, bonusStartBalls: 1 });
    expect(sim.state.maxHp).toBe(7);
    // plus de fusion automatique : 4 pierres de rang 1
    expect(sim.state.volley).toEqual(Array.from({ length: 4 }, () => ({ element: 'stone', tier: 1 })));
  });
});

describe('combo et dégâts', () => {
  it('premier impact : base × tierMult^(tier-1) ; plomb ×3 sans combo ; bouncy +2 de combo', () => {
    const cases: [Parameters<typeof setup>[2], string[], number][] = [
      [[{ element: 'stone', tier: 1 }], [], 1],
      [[{ element: 'stone', tier: 2 }], [], 2.5],
      [[{ element: 'stone', tier: 3 }], [], 6.25],
      [[{ element: 'lead', tier: 1 }], [], 3],
      [[{ element: 'stone', tier: 1 }], ['bouncy'], 1.2],
    ];
    for (const [volley, relics, expected] of cases) {
      const sim = newSim('dmg');
      const t = block(sim, 'normal', 3, 4, 1000);
      setup(sim, [t], volley);
      mut(sim).relics = relics;
      const evs = shoot(sim, UP);
      const hits = ofType(evs, 'block:hit');
      expect(hits).toHaveLength(1);
      expect(hits[0]!.damage).toBeCloseTo(expected, 9);
      expect(sim.state.currentShotDamage).toBeCloseTo(expected, 9);
      expect(sim.state.stats.totalDamage).toBeCloseTo(expected, 9);
      expect(ofType(evs, 'volley:end')[0]!.shotDamage).toBeCloseTo(expected, 9);
    }
  });

  it('dégâts = 1 + 0,1 × combo sur chaque impact direct, combo croissant, paliers émis', () => {
    const cfg = config();
    cfg.balls.comboMilestones = [2, 4, 6];
    const sim = newSim('combo', cfg);
    const rng = createRng(3);
    let maxCombo = 0;
    const milestones = new Set<number>();
    for (let i = 0; i < 40 && sim.state.phase !== 'gameover'; i++) {
      settle(sim);
      mut(sim).volley = [{ element: 'stone', tier: 1 }];
      const evs = shoot(sim, randomDir(rng));
      for (const h of ofType(evs, 'block:hit')) {
        expect(h.damage).toBeCloseTo(1 + 0.1 * h.combo, 9);
        expect(h.crit).toBe(h.combo >= 2);
        maxCombo = Math.max(maxCombo, h.combo);
      }
      for (const m of ofType(evs, 'combo:milestone')) {
        expect(m.combo).toBe(cfg.balls.comboMilestones[m.level - 1]);
        milestones.add(m.level);
      }
      const end = ofType(evs, 'volley:end')[0];
      if (end) expect(end.bestCombo).toBeGreaterThanOrEqual(0);
    }
    expect(maxCombo).toBeGreaterThanOrEqual(2);
    expect(milestones.has(1)).toBe(true);
    expect(sim.state.stats.bestCombo).toBeGreaterThanOrEqual(maxCombo);
  });
});

describe('fusion (carte de récompense)', () => {
  const S1 = { element: 'stone', tier: 1 } as const;

  /** Amène la sim en phase récompense (vague 1 nettoyée d'un tir). */
  function toReward(seed: string, volley: Parameters<typeof setup>[2], cfgMod?: (c: ReturnType<typeof config>) => void) {
    const cfg = config();
    cfgMod?.(cfg);
    const sim = newSim(seed, cfg);
    setup(sim, [block(sim, 'normal', 3, 4, 1)], volley);
    const evs = shoot(sim, UP);
    return { sim, evs };
  }

  it('départ : 3 pierres = 3 balles, aucune fusion automatique', () => {
    const sim = newSim('fusion');
    expect(sim.state.volley).toEqual([S1, S1, S1]);
    expect(sim.state.stats.fusions).toBe(0);
    expect(ofType(sim.step(0), 'volley:fusion')).toHaveLength(0);
  });

  it('une balle ramassée rejoint la volée sans fusionner', () => {
    const sim = newSim('fusion2');
    const t = block(sim, 'normal', 3, 4, 1000);
    setup(sim, [t], [S1, { element: 'stone', tier: 2 }, { element: 'fire', tier: 1 }]);
    mut(sim).drops.push({ id: 9999, kind: 'ball', pos: { x: 3.5, y: 7 }, value: 1, element: 'stone' });
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'drop:collected')).toHaveLength(1);
    expect(sim.state.volley).toEqual([S1, S1, { element: 'stone', tier: 2 }, { element: 'fire', tier: 1 }]);
    expect(ofType(evs, 'volley:fusion')).toHaveLength(0);
  });

  it('offre fuse : fuseChance = 1 → une seule option fuse, paire du rang le plus élevé, jamais à la place d une relique', () => {
    for (let k = 0; k < 20; k++) {
      const { sim } = toReward(`offer-${k}`, [S1, S1, { element: 'stone', tier: 2 }, { element: 'stone', tier: 2 }, { element: 'fire', tier: 1 }], (c) => {
        c.economy.reward.fuseChance = 1;
      });
      const offer = sim.state.rewardOffer!;
      expect(offer).toHaveLength(3);
      const fuses = offer.filter((o) => o.kind === 'fuse');
      expect(fuses).toEqual([{ kind: 'fuse', element: 'stone', tier: 3 }]);
      expect(new Set(offer.map((o) => JSON.stringify(o))).size).toBe(3);
    }
    // sans relique dans le pool, la fusion remplace une option balle
    const { sim } = toReward('offer-relicless', [S1, S1], (c) => {
      c.economy.reward.fuseChance = 1;
      c.economy.reward.relicChance = 1;
    });
    const offer = sim.state.rewardOffer!;
    expect(offer.filter((o) => o.kind === 'relic')).toHaveLength(2);
    expect(offer.filter((o) => o.kind === 'fuse')).toEqual([{ kind: 'fuse', element: 'stone', tier: 2 }]);
  });

  it('offre fuse : fuseChance = 0 ou aucune paire → jamais de fuse', () => {
    const a = toReward('nofuse-a', [S1, S1], (c) => {
      c.economy.reward.fuseChance = 0;
    }).sim;
    expect(a.state.rewardOffer!.some((o) => o.kind === 'fuse')).toBe(false);
    const b = toReward('nofuse-b', [S1, { element: 'fire', tier: 1 }, { element: 'stone', tier: 3 }, { element: 'stone', tier: 3 }], (c) => {
      c.economy.reward.fuseChance = 1;
    }).sim;
    expect(b.state.rewardOffer!.some((o) => o.kind === 'fuse')).toBe(false); // rang 3 = max
  });

  it('chooseReward fuse : 2 balles (élément, rang-1) → 1 balle (élément, rang), volley:fusion', () => {
    const { sim } = toReward('choose-fuse', [S1, S1, S1, { element: 'fire', tier: 1 }], (c) => {
      c.economy.reward.fuseChance = 1;
    });
    const idx = sim.state.rewardOffer!.findIndex((o) => o.kind === 'fuse');
    expect(idx).toBeGreaterThanOrEqual(0);
    // un drop de balle a pu être ramassé à la fin de vague : on raisonne en différences
    const count = (el: string, t: number) => sim.state.volley.filter((v) => v.element === el && v.tier === t).length;
    const s1 = count('stone', 1);
    const s2 = count('stone', 2);
    const n = sim.state.volley.length;
    sim.chooseReward(idx);
    expect(count('stone', 1)).toBe(s1 - 2);
    expect(count('stone', 2)).toBe(s2 + 1);
    expect(sim.state.volley.length).toBe(n - 1);
    expect(sim.state.stats.fusions).toBe(1);
    const f = ofType(sim.step(0), 'volley:fusion');
    const index = sim.state.volley.findIndex((v) => v.element === 'stone' && v.tier === 2);
    expect(f).toEqual([{ type: 'volley:fusion', element: 'stone', tier: 2, index, pos: { x: sim.state.launchPos.x, y: sim.state.launchPos.y } }]);
  });

  it('boutique : une fusion au prix d une balle quand une paire existe', () => {
    const cfg = config();
    const sim = newSim('shop-fuse', cfg);
    mut(sim).wave = 3;
    setup(sim, [block(sim, 'normal', 3, 4, 1)], [S1, S1, { element: 'fire', tier: 1 }]);
    shoot(sim, UP);
    sim.skipReward();
    const items = sim.state.shop!.items;
    expect(items).toHaveLength(cfg.economy.shop.itemCount);
    const fuse = items.filter((i) => i.option.kind === 'fuse');
    expect(fuse).toHaveLength(1);
    expect(fuse[0]!.price).toBe(cfg.economy.shop.prices.ball);
    mut(sim).coins = 100;
    sim.buy(items.indexOf(fuse[0]!));
    expect(sim.state.volley).toEqual([{ element: 'stone', tier: 2 }, { element: 'fire', tier: 1 }]);
  });

  it('au plafond maxVolley : fusion automatique, rang le plus bas d abord, jusqu à repasser sous le plafond', () => {
    const cfg = config();
    cfg.balls.maxVolley = 4;
    const sim = newSim('cap', cfg);
    const t = block(sim, 'normal', 3, 4, 1000);
    setup(sim, [t], [{ element: 'stone', tier: 2 }, { element: 'stone', tier: 2 }, S1, S1]);
    mut(sim).drops.push({ id: 9998, kind: 'ball', pos: { x: 3.5, y: 7 }, value: 1, element: 'fire' });
    const evs = shoot(sim, UP);
    // 4 balles = plafond → stone1+stone1 fusionnent d'abord (rang le plus bas) ; le feu entre (4) → stone2+stone2 → stone3
    const fus = ofType(evs, 'volley:fusion');
    expect(fus.map((f) => f.tier)).toEqual([2, 3]);
    expect(sim.state.volley).toEqual([{ element: 'stone', tier: 2 }, { element: 'stone', tier: 3 }, { element: 'fire', tier: 1 }]);
    expect(sim.state.volley.some((v) => v.element === 'fire')).toBe(true);
    expect(sim.state.stats.fusions).toBe(fus.length);
  });
});

describe('éléments', () => {
  it('feu : explose au premier impact, une seule fois, et continue', () => {
    const sim = newSim('fire');
    const a = block(sim, 'normal', 3, 4, 100);
    const b = block(sim, 'normal', 4, 4, 100);
    const far = block(sim, 'normal', 0, 0, 100);
    setup(sim, [a, b, far], [{ element: 'fire', tier: 1 }]);
    const evs = shoot(sim, UP);
    const ex = ofType(evs, 'block:explode');
    expect(ex).toHaveLength(1);
    expect(ex[0]!.radius).toBeCloseTo(1.1);
    expect(ex[0]!.damage).toBeCloseTo(0.6);
    expect(hpOf(sim.state.blocks, a.id)).toBeCloseTo(99);
    expect(hpOf(sim.state.blocks, b.id)).toBeCloseTo(99.4);
    expect(hpOf(sim.state.blocks, far.id)).toBe(100);
    expect(ofType(evs, 'ball:grounded')).toHaveLength(1);
  });

  it('foudre : chaque impact frappe le bloc le plus proche dans chainRange', () => {
    const sim = newSim('lightning');
    const a = block(sim, 'normal', 3, 4, 100);
    const near = block(sim, 'normal', 5, 4, 100);
    const far = block(sim, 'normal', 0, 0, 100);
    setup(sim, [a, near, far], [{ element: 'lightning', tier: 1 }]);
    const evs = shoot(sim, UP);
    const ch = ofType(evs, 'lightning:chain');
    expect(ch).toHaveLength(1);
    expect(ch[0]!.to).toEqual({ x: 5.5, y: 4.5 });
    expect(ch[0]!.damage).toBeCloseTo(0.5);
    expect(hpOf(sim.state.blocks, near.id)).toBeCloseTo(99.5);
    expect(hpOf(sim.state.blocks, far.id)).toBe(100);
  });

  it('glace : le bloc touché ne descend pas au prochain avancement puis dégèle', () => {
    const sim = newSim('ice');
    const a = block(sim, 'normal', 3, 4, 100);
    const other = block(sim, 'normal', 0, 4, 100);
    setup(sim, [a, other], [{ element: 'ice', tier: 1 }]);
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'block:frozen')).toHaveLength(1);
    const A = sim.state.blocks.find((b) => b.id === a.id)!;
    const O = sim.state.blocks.find((b) => b.id === other.id)!;
    expect(A.row).toBe(4);
    expect(A.frozen).toBe(false);
    expect(O.row).toBe(5);
  });

  it('fantôme : traverse (dégâts à l entrée, une fois par traversée), rebondit sur murs/plafond', () => {
    const sim = newSim('ghost');
    const a = block(sim, 'normal', 3, 4, 100);
    const b = block(sim, 'normal', 3, 2, 100);
    setup(sim, [a, b], [{ element: 'ghost', tier: 1 }]);
    const evs = shoot(sim, UP);
    const hits = ofType(evs, 'block:hit');
    expect(hits.filter((h) => h.blockId === a.id)).toHaveLength(2);
    expect(hits.filter((h) => h.blockId === b.id)).toHaveLength(2);
    expect(hits.map((h) => h.combo)).toEqual([0, 1, 2, 3]);
    const bounces = ofType(evs, 'ball:bounce');
    expect(bounces.length).toBeGreaterThan(0);
    expect(bounces.every((e) => e.surface === 'wall')).toBe(true);
  });

  it('scission : se divise en deux au premier impact', () => {
    const sim = newSim('split');
    const a = block(sim, 'normal', 3, 4, 100);
    setup(sim, [a], [{ element: 'split', tier: 1 }]);
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'ball:split')).toHaveLength(1);
    expect(ofType(evs, 'ball:launched')).toHaveLength(1);
    expect(ofType(evs, 'ball:grounded')).toHaveLength(2);
  });

  it('scission : plafond maxSplitsPerShot', () => {
    const cfg = config();
    cfg.balls.split.maxSplitsPerShot = 1;
    const sim = newSim('split-cap', cfg);
    const a = block(sim, 'normal', 3, 4, 100);
    setup(sim, [a], [{ element: 'split', tier: 1 }, { element: 'split', tier: 2 }]);
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'ball:split')).toHaveLength(1);
  });
});

describe('blocs spéciaux', () => {
  it('blindé : dégâts seulement par le dessous', () => {
    const sim = newSim('armor');
    const a = block(sim, 'armored', 3, 4, 50);
    setup(sim, [a], [{ element: 'stone', tier: 1 }]);
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'block:hit')).toHaveLength(1);
    expect(hpOf(sim.state.blocks, a.id)).toBe(49);

    const sim2 = newSim('armor2');
    const side = block(sim2, 'armored', 3, 5, 50);
    setup(sim2, [side], [{ element: 'stone', tier: 1 }], { launchX: 0.5 });
    const r = sim2.config.blocks.board.ballRadius;
    const evs2 = shoot(sim2, { x: 3 - r - 0.5, y: 5.5 - (10 - r) });
    expect(ofType(evs2, 'ball:bounce').some((e) => e.surface === 'block' && e.normal.x === -1)).toBe(true);
    expect(ofType(evs2, 'block:hit')).toHaveLength(0);
    expect(hpOf(sim2.state.blocks, side.id)).toBe(50);
  });

  it('explosif : explose à la destruction (dégâts = ratio × PV max)', () => {
    const sim = newSim('explosive');
    const e = block(sim, 'explosive', 3, 4, 10);
    e.hp = 1;
    const n = block(sim, 'normal', 4, 4, 100);
    setup(sim, [e, n], [{ element: 'stone', tier: 1 }]);
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'block:destroyed').map((d) => d.kind)).toEqual(['explosive']);
    const ex = ofType(evs, 'block:explode');
    expect(ex).toHaveLength(1);
    expect(ex[0]!.damage).toBeCloseTo(5);
    expect(ex[0]!.radius).toBeCloseTo(1.2);
    expect(hpOf(sim.state.blocks, n.id)).toBeCloseTo(95);
  });

  it('cœur : rend 1 PV', () => {
    const sim = newSim('heart');
    const h = block(sim, 'heart', 3, 4, 1);
    const keep = block(sim, 'normal', 0, 0, 100);
    setup(sim, [h, keep], [{ element: 'stone', tier: 1 }]);
    mut(sim).hp = 3;
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'player:healed')).toEqual([{ type: 'player:healed', amount: 1, hpLeft: 4 }]);
    expect(sim.state.hp).toBe(4);
  });

  it('cheville : rebond surface peg, combo +1, jamais détruite', () => {
    const sim = newSim('peg');
    const p = block(sim, 'peg', 3, 4, 0);
    const keep = block(sim, 'normal', 0, 0, 100);
    setup(sim, [p, keep], [{ element: 'stone', tier: 1 }]);
    const evs = shoot(sim, UP);
    const b = ofType(evs, 'ball:bounce').filter((e) => e.surface === 'peg');
    expect(b).toHaveLength(1);
    expect(b[0]!.combo).toBe(1);
    expect(ofType(evs, 'block:hit')).toHaveLength(0);
    expect(sim.state.blocks.some((x) => x.id === p.id)).toBe(true);
  });
});

describe('avancée, franchissement, game over', () => {
  it('franchissement : dégâts plafonnés, chevilles sans dégâts, puis game over', () => {
    const sim = newSim('breach');
    const big = block(sim, 'normal', 0, 8, 1000);
    const peg = block(sim, 'peg', 6, 8, 0);
    const bigId = big.id; // les objets Block sont poolés : capturer l'id avant le tir
    const pegId = peg.id;
    setup(sim, [big, peg], [{ element: 'stone', tier: 1 }], { rowsLeft: 3 });
    const evs = shoot(sim, UP);
    const br = ofType(evs, 'block:breached');
    expect(br).toEqual([{ type: 'block:breached', blockId: bigId, kind: 'normal', damage: 2 }]);
    expect(ofType(evs, 'player:damaged')).toEqual([{ type: 'player:damaged', amount: 2, hpLeft: 3 }]);
    expect(sim.state.blocks.some((b) => b.id === pegId)).toBe(false);
    expect(ofType(evs, 'rows:advanced')[0]).toEqual({ type: 'rows:advanced', wave: 1, newRow: true });
    expect(sim.state.rowsLeftInWave).toBe(2);
    expect(sim.state.phase).toBe('aiming');

    const s = mut(sim);
    s.hp = 1;
    s.blocks.push(block(sim, 'normal', 0, 8, 1000));
    const evs2 = shoot(sim, UP);
    expect(sim.state.phase).toBe('gameover');
    const over = ofType(evs2, 'run:over');
    expect(over).toHaveLength(1);
    const sum = over[0]!.summary;
    expect(sum.wave).toBe(1);
    expect(sum.depth).toBe(2);
    expect(sum.seed).toBe('breach');
    expect(sum.score).toBeGreaterThan(0);
    expect(sum.stats.fragmentsEarned).toBeGreaterThanOrEqual(1); // perDepth 0,5 × 2
    // restart : même meta, nouvelle run
    sim.restart('again');
    expect(sim.state.phase).toBe('aiming');
    expect(sim.state.seed).toBe('again');
    expect(sim.state.hp).toBe(5);
  });

  it('les drops descendent avec les blocs et sont ramassés en bas', () => {
    const sim = newSim('drops');
    const keep = block(sim, 'normal', 0, 0, 100);
    setup(sim, [keep], [{ element: 'stone', tier: 1 }], { rowsLeft: 3 });
    mut(sim).drops.push({ id: 5000, kind: 'coin', pos: { x: 6.5, y: 8.5 }, value: 4, element: null });
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'drop:collected')).toEqual([{ type: 'drop:collected', dropId: 5000, kind: 'coin', pos: { x: 6.5, y: 9.5 }, value: 4 }]);
    expect(sim.state.coins).toBe(4);
  });

  it('recall accélère la volée', () => {
    const run = (recall: boolean): number => {
      const sim = newSim('recall');
      const keep = block(sim, 'normal', 0, 0, 100);
      setup(sim, [keep], [{ element: 'stone', tier: 1 }], { rowsLeft: 3 });
      sim.aim({ x: 0.2, y: -1 });
      sim.fire();
      sim.step(100);
      if (recall) sim.recall();
      expect(sim.state.recallSpeed).toBe(recall ? 3 : 1);
      let frames = 0;
      while (sim.state.phase === 'firing') {
        sim.step(1000 / 60);
        frames++;
      }
      return frames;
    };
    expect(run(true)).toBeLessThan(run(false) / 2);
  });
});

describe('vagues, récompense, boutique, boss', () => {
  it('vague 3 nettoyée → récompense → boutique → vague 4', () => {
    const sim = newSim('wave3');
    mut(sim).wave = 3;
    const last = block(sim, 'normal', 3, 4, 1);
    const peg = block(sim, 'peg', 6, 6, 0);
    setup(sim, [last, peg], [{ element: 'stone', tier: 1 }], { rowsLeft: 0 });
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'wave:cleared')).toEqual([{ type: 'wave:cleared', wave: 3 }]);
    expect(sim.state.blocks).toHaveLength(0); // chevilles effacées
    expect(sim.state.phase).toBe('reward');
    const offer = sim.state.rewardOffer!;
    expect(offer).toHaveLength(3);
    expect(new Set(offer.map((o) => JSON.stringify(o))).size).toBe(3);
    expect(ofType(evs, 'reward:offered')[0]!.options).toEqual(offer);

    sim.chooseReward(0);
    const e2 = [...sim.step(0)];
    expect(ofType(e2, 'reward:chosen')).toHaveLength(1);
    expect(sim.state.phase).toBe('shop');
    expect(ofType(e2, 'shop:opened')).toHaveLength(1);
    const shop = sim.state.shop!;
    expect(shop.items).toHaveLength(4);
    expect(shop.rerollCost).toBe(8);

    mut(sim).coins = 100;
    const price = shop.items[0]!.price;
    sim.buy(0);
    expect(sim.state.coins).toBe(100 - price);
    expect(sim.state.shop!.items[0]!.sold).toBe(true);
    sim.buy(0); // déjà vendu : rien
    expect(sim.state.coins).toBe(100 - price);
    sim.reroll();
    expect(sim.state.coins).toBe(100 - price - 8);
    expect(sim.state.shop!.rerollCost).toBe(12);
    expect(sim.state.shop!.rerollsUsed).toBe(1);

    sim.leaveShop();
    const s = sim.state;
    expect(s.phase).toBe('aiming');
    expect(s.wave).toBe(4);
    expect(s.shotInWave).toBe(0);
    expect(s.shop).toBeNull();
    expect(new Set(s.blocks.map((b) => b.row))).toEqual(new Set([0, 1, 2]));
    expect(s.rowsLeftInWave).toBe(7 - 3);
  });

  it('skipReward donne skipCoins ; freeRerolls de la meta', () => {
    const sim = newSim('skip', config(), { freeRerolls: 1 });
    mut(sim).wave = 3;
    setup(sim, [block(sim, 'normal', 3, 4, 1)], [{ element: 'stone', tier: 1 }]);
    shoot(sim, UP);
    sim.skipReward();
    expect(sim.state.coins).toBe(15);
    expect(sim.state.shop!.rerollCost).toBe(0);
    sim.reroll();
    expect(sim.state.coins).toBe(15);
    expect(sim.state.shop!.rerollCost).toBe(8 + 4 * 1);
  });

  it('boss vague 5 : apparition, régénération, mort', () => {
    const sim = newSim('boss');
    mut(sim).wave = 4;
    setup(sim, [block(sim, 'normal', 3, 4, 1)], [{ element: 'stone', tier: 1 }]);
    shoot(sim, UP);
    sim.chooseReward(0);
    const evs = [...sim.step(0)];
    const s = mut(sim);
    expect(s.wave).toBe(5);
    expect(s.blocks).toHaveLength(1);
    const boss = s.blocks[0]!;
    expect(boss.kind).toBe('boss');
    expect(boss.width).toBe(3);
    expect(boss.col).toBe(2);
    const w = sim.config.waves;
    expect(boss.maxHp).toBe(Math.round(w.baseHp * Math.pow(w.growthPerWave, 4) * w.bosses[0]!.hpMultiplier));
    expect(ofType(evs, 'boss:spawned')).toEqual([{ type: 'boss:spawned', bossId: 'regen', blockId: boss.id }]);
    expect(s.rowsLeftInWave).toBe(0);

    // régénération : +param × maxHp par tir
    s.volley = [{ element: 'stone', tier: 1 }];
    boss.hp = boss.maxHp - 100;
    shoot(sim, UP);
    const after = s.blocks[0]!;
    expect(after.hp).toBeCloseTo(Math.min(after.maxHp, after.maxHp - 100 - 1 + w.bosses[0]!.param * after.maxHp), 6);

    after.hp = 1;
    const evs2 = shoot(sim, UP);
    expect(ofType(evs2, 'boss:killed')).toHaveLength(1);
    expect(s.stats.bossesKilled).toBe(1);
    expect(ofType(evs2, 'wave:cleared')).toHaveLength(1);
  });

  it('boss absorb : l élément du premier impact est réduit', () => {
    const cfg = config();
    const sim = newSim('absorb', cfg);
    const b = block(sim, 'boss', 2, 3, 1000, 3);
    b.bossId = 'absorb';
    setup(sim, [b], [{ element: 'stone', tier: 1 }, { element: 'lead', tier: 1 }]);
    const evs = shoot(sim, UP);
    const hits = ofType(evs, 'block:hit');
    // volée triée par élément : stone part en premier → stone est absorbé (× param), lead passe plein pot
    expect(hits[0]!.element).toBe('stone');
    expect(hits[0]!.damage).toBeCloseTo(1 * 0.5);
    expect(hits[1]!.element).toBe('lead');
    expect(hits[1]!.damage).toBeCloseTo(3);
  });
});

describe('reliques', () => {
  it('firstblood : le premier bloc touché du tir est détruit', () => {
    const sim = newSim('firstblood');
    const a = block(sim, 'normal', 3, 4, 1000);
    const keep = block(sim, 'normal', 0, 0, 100);
    setup(sim, [a, keep], [{ element: 'stone', tier: 1 }, { element: 'stone', tier: 2 }]);
    mut(sim).relics = ['firstblood'];
    const evs = shoot(sim, UP);
    expect(ofType(evs, 'block:destroyed').map((d) => d.blockId)).toEqual([a.id]);
    expect(ofType(evs, 'block:hit')[0]!.damage).toBe(1000);
  });

  it('firstblood ne s applique pas aux boss', () => {
    const sim = newSim('firstblood-boss');
    const b = block(sim, 'boss', 2, 3, 1000, 3);
    b.bossId = 'regen';
    setup(sim, [b], [{ element: 'stone', tier: 1 }]);
    mut(sim).relics = ['firstblood'];
    shoot(sim, UP);
    expect(sim.state.blocks[0]!.hp).toBeGreaterThan(900);
  });

  it('magnet : drops ramassés en fin de volée ; piggy : pièces → PV', () => {
    const sim = newSim('magnet');
    const keep = block(sim, 'normal', 0, 0, 100);
    setup(sim, [keep], [{ element: 'stone', tier: 1 }], { rowsLeft: 3 });
    const s = mut(sim);
    s.relics = ['magnet', 'piggy'];
    s.hp = 2;
    s.drops.push({ id: 7000, kind: 'coin', pos: { x: 6.5, y: 1.5 }, value: 12, element: null });
    const evs = shoot(sim, UP);
    const end = evs.findIndex((e) => e.type === 'volley:end');
    const col = evs.findIndex((e) => e.type === 'drop:collected');
    expect(col).toBeGreaterThan(end);
    expect(sim.state.coins).toBe(12);
    expect(sim.state.hp).toBe(3);
  });

  it('safetynet : la prochaine balle hérite du combo', () => {
    const sim = newSim('safetynet');
    const p = block(sim, 'peg', 3, 4, 0);
    const keep = block(sim, 'normal', 0, 0, 100);
    setup(sim, [p, keep], [{ element: 'stone', tier: 1 }, { element: 'fire', tier: 1 }], { rowsLeft: 3 });
    mut(sim).relics = ['safetynet'];
    sim.aim(UP);
    sim.fire();
    // laisse la première balle toucher le sol avant de lancer la seconde
    mut(sim).internal.launchTimer = 0;
    const evs = [];
    for (let i = 0; i < 2000 && sim.state.phase === 'firing'; i++) {
      if (sim.state.balls.length === 0 && sim.state.pendingLaunches > 0) mut(sim).internal.launchTimer = 0;
      else if (sim.state.pendingLaunches > 0) mut(sim).internal.launchTimer = 1e9;
      evs.push(...sim.step(1000 / 60));
    }
    const pegBounces = ofType(evs, 'ball:bounce').filter((e) => e.surface === 'peg').map((e) => e.combo);
    expect(pegBounces).toEqual([1, 2]);
  });
});

describe('visée', () => {
  it('preview : départ, premier impact, segment réfléchi de 1,5', () => {
    const sim = newSim('preview');
    const a = block(sim, 'normal', 3, 4, 10);
    setup(sim, [a], [{ element: 'stone', tier: 1 }]);
    const r = sim.config.blocks.board.ballRadius;
    const [p0, p1, p2] = sim.preview(UP);
    expect(p0).toEqual({ x: 3.5, y: 10 });
    expect(p1!.x).toBeCloseTo(3.5);
    expect(p1!.y).toBeCloseTo(5 + r);
    expect(p2!.y).toBeCloseTo(5 + r + 1.5);
  });
});
