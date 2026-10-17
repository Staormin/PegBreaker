// Vente, forge, catalyseur, hybrides et Divine (docs/HYBRIDS.md) : API boutique, un test par hybride (effet propre
// observable + au moins un effet parent), Divine, déterminisme, robustesse, accessibilité de la forge.
import { describe, expect, it } from 'vitest';
import type { BallElement, BallTier, Block, GameConfig, GameEvent, Sim, Vec2, VolleyBall } from '../core/types';
import { createSim } from './index';
import { FRAME, block, meta as metaOf, config, createRng, lowestBlockDir, mut, newSim, ofType, randomDir, setup, shoot, useNeutralFun } from './test-helpers';

useNeutralFun(); // dorée ×1, pas d'éventail pénalisant, pas de contrat : dégâts attendus exacts

const CFG = config();
const UP: Vec2 = { x: 0, y: -1 };
const STURDY = 1_000_000;
const ALL: BallElement[] = CFG.balls.defs.map((d) => d.id);
const BASE27: BallElement[] = CFG.balls.defs.filter((d) => d.family !== 'hybrid' && d.family !== 'divine').map((d) => d.id);
const HYBRIDS: BallElement[] = CFG.balls.defs.filter((d) => d.family === 'hybrid').map((d) => d.id);

function P(el: BallElement, key: string, tier: BallTier, cfg: GameConfig = CFG): number {
  return cfg.balls.defs.find((d) => d.id === el)!.params![key]![tier - 1]!;
}
function baseDmg(el: BallElement, tier: BallTier): number {
  return CFG.balls.defs.find((d) => d.id === el)!.baseDamage * Math.pow(CFG.balls.tierDamageMultiplier, tier - 1);
}
function vb(element: BallElement, tier: BallTier, n = 1): VolleyBall[] {
  return Array.from({ length: n }, () => ({ element, tier }));
}

/** Sim en boutique avec la volée donnée et `coins` pièces. */
function shopSim(volley: VolleyBall[], coins: number, seed = 'forge'): Sim {
  const sim = newSim(seed, config(), { unlockedElements: ALL });
  const s = mut(sim);
  s.volley = volley.map((v) => ({ ...v }));
  s.coins = coins;
  s.phase = 'shop';
  s.shop = { items: [], rerollCost: 0, rerollsUsed: 0 };
  sim.step(0);
  return sim;
}

/** Vise, tire et avance jusqu'au volley:end (les blocs n'ont pas encore descendu). */
function fly(sim: Sim, dir: Vec2, maxFrames = 5000): GameEvent[] {
  const out: GameEvent[] = [];
  sim.aim(dir);
  sim.fire();
  for (let f = 0; f < maxFrames; f++) {
    const evs = sim.step(FRAME);
    for (const e of evs) out.push(e);
    if (evs.some((e) => e.type === 'volley:end')) break;
  }
  return out;
}

/** Plateau de test (rowsLeft 1 : la vague ne finit pas) et un vol. */
function single(
  volley: VolleyBall[],
  blocks: (sim: Sim) => Block[],
  dir: Vec2 = UP,
  opts: { launchX?: number; seed?: string; cfg?: GameConfig } = {},
): { sim: Sim; evs: GameEvent[] } {
  const sim = newSim(opts.seed ?? 'hyb', opts.cfg ?? config());
  setup(sim, blocks(sim), volley, { launchX: opts.launchX ?? 3.5, rowsLeft: 1 });
  const evs = fly(sim, dir);
  return { sim, evs };
}

/** Couloir vertical de blocs indestructibles (colonnes 2 et 4, rangées 0..8) : beaucoup de rebonds de bloc. */
function corridor(sim: Sim): Block[] {
  const out: Block[] = [];
  for (let r = 0; r <= 8; r++) {
    out.push(block(sim, 'normal', 2, r, STURDY));
    out.push(block(sim, 'normal', 4, r, STURDY));
  }
  return out;
}
const ZIGZAG: Vec2 = { x: 0.35, y: -1 };

// ------------------------------------------------------------------------------------------------------
describe('vente', () => {
  it('prix par rang (base, hybride, Divine), crédit, shop:sold, volée retriée', () => {
    const eco = CFG.economy.sell;
    const sim = shopSim([...vb('fire', 2), ...vb('stone', 1), ...vb('steam', 3), ...vb('divine', 1), ...vb('ice', 3)], 0);
    const idx = (el: BallElement): number => sim.state.volley.findIndex((v) => v.element === el);
    expect(sim.sell(idx('fire'))).toBe(eco.byTier[1]);
    expect(sim.sell(idx('steam'))).toBe(eco.hybridByTier[2]);
    expect(sim.sell(idx('divine'))).toBe(eco.divine);
    expect(sim.sell(idx('ice'))).toBe(eco.byTier[2]);
    expect(sim.state.coins).toBe(eco.byTier[1] + eco.hybridByTier[2] + eco.divine + eco.byTier[2]);
    const sold = ofType(sim.step(0), 'shop:sold');
    expect(sold.map((e) => e.element)).toEqual(['fire', 'steam', 'divine', 'ice']);
    expect(sold[1]).toMatchObject({ tier: 3, coins: eco.hybridByTier[2] });
    expect(sim.state.volley).toEqual([{ element: 'stone', tier: 1 }]);
  });

  it('refus : dernière balle, index invalide, hors boutique', () => {
    const sim = shopSim(vb('fire', 3), 0);
    expect(sim.sell(0)).toBe(0);
    expect(sim.state.volley.length).toBe(1);
    const two = shopSim(vb('stone', 1, 2), 0);
    expect(two.sell(5)).toBe(0);
    mut(two).phase = 'aiming';
    expect(two.sell(0)).toBe(0);
    expect(two.state.volley.length).toBe(2);
    expect(ofType(two.step(0), 'shop:sold')).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------------
describe('forgeOptions', () => {
  const H = CFG.economy.forge.hybridCost;
  const D = CFG.economy.forge.divineCost;

  it('recette dans les deux sens (rang ≥ II), coût hybridCost', () => {
    const a = shopSim([...vb('fire', 3), ...vb('ice', 2)], 0).forgeOptions();
    expect(a).toEqual([{ i: 0, j: 1, result: 'steam', cost: H }]);
    // ordre de la volée inversé (volée non triée) : même résultat
    const sim = shopSim([], 0);
    mut(sim).volley = [{ element: 'ice', tier: 3 }, { element: 'fire', tier: 2 }];
    expect(sim.forgeOptions()).toEqual([{ i: 0, j: 1, result: 'steam', cost: H }]);
    expect(sim.state.volley[0]!.element).toBe('ice'); // sans effet de bord
  });

  it('un parent ≥ II + l autre ≥ I accepté ; deux rangs I refusés ; sans recette refusés ; doublons dédoublonnés', () => {
    expect(shopSim([...vb('fire', 1), ...vb('ice', 2)], 0).forgeOptions().map((o) => o.result)).toEqual(['steam']);
    expect(shopSim([...vb('fire', 1), ...vb('ice', 1)], 0).forgeOptions()).toEqual([]);
    expect(shopSim([...vb('fire', 3), ...vb('lightning', 3)], 0).forgeOptions()).toEqual([]);
    const opts = shopSim([...vb('fire', 2, 2), ...vb('ice', 2)], 0).forgeOptions();
    expect(opts).toHaveLength(1);
  });

  it('Divine depuis deux hybrides de rang III (identiques ou non), jamais rang < III, jamais deux Divines', () => {
    expect(shopSim([...vb('steam', 3), ...vb('laser', 3)], 0).forgeOptions()).toEqual([{ i: 0, j: 1, result: 'divine', cost: D }]);
    expect(shopSim(vb('steam', 3, 2), 0).forgeOptions()).toEqual([{ i: 0, j: 1, result: 'divine', cost: D }]);
    expect(shopSim([...vb('steam', 2), ...vb('laser', 3)], 0).forgeOptions()).toEqual([]);
    expect(shopSim(vb('divine', 1, 2), 0).forgeOptions()).toEqual([]);
    expect(shopSim([...vb('divine', 1), ...vb('steam', 3)], 0).forgeOptions()).toEqual([]);
    // hybride + balle de base : rien
    expect(shopSim([...vb('steam', 3), ...vb('fire', 3)], 0).forgeOptions()).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------------
describe('forge et upgrade', () => {
  it('forge : débit, parents retirés, hybride rang I, shop:forged (pos = launchPos), summary.forged', () => {
    const sim = shopSim([...vb('stone', 1), ...vb('fire', 3), ...vb('ice', 2)], 100);
    const o = sim.forgeOptions()[0]!;
    expect(sim.forge(o.i, o.j)).toBe(true);
    expect(sim.state.coins).toBe(100 - CFG.economy.forge.hybridCost);
    expect(sim.state.volley).toEqual([{ element: 'stone', tier: 1 }, { element: 'steam', tier: 1 }]);
    const ev = ofType(sim.step(0), 'shop:forged')[0]!;
    expect(ev).toMatchObject({ result: 'steam', parents: ['fire', 'ice'], cost: CFG.economy.forge.hybridCost });
    expect(ev.pos).toEqual(sim.state.launchPos);
    expect(mut(sim).internal.forged).toEqual(['steam']);
    expect(sim.state.stats.forged).toBe(1);
    // summary : run:over après abandon
    mut(sim).phase = 'gameover';
    sim.giveUp();
    const over = ofType(sim.step(0), 'run:over')[0]!;
    expect(over.summary.forged).toEqual(['steam']);
  });

  it('forge refusée : pièces insuffisantes, paire invalide, hors boutique', () => {
    const poor = shopSim([...vb('fire', 3), ...vb('ice', 3)], CFG.economy.forge.hybridCost - 1);
    expect(poor.forge(0, 1)).toBe(false);
    expect(poor.state.volley).toHaveLength(2);
    const bad = shopSim([...vb('fire', 1), ...vb('ice', 1)], 999);
    expect(bad.forge(0, 1)).toBe(false);
    expect(bad.forge(0, 0)).toBe(false);
    const out = shopSim([...vb('fire', 3), ...vb('ice', 3)], 999);
    mut(out).phase = 'aiming';
    expect(out.forge(0, 1)).toBe(false);
    expect(ofType(out.step(0), 'shop:forged')).toHaveLength(0);
  });

  it('Divine : deux hybrides III → divine rang I (divineCost)', () => {
    const sim = shopSim([...vb('steam', 3), ...vb('hammer', 3)], 500);
    expect(sim.forge(0, 1)).toBe(true);
    expect(sim.state.volley).toEqual([{ element: 'divine', tier: 1 }]);
    expect(sim.state.coins).toBe(500 - CFG.economy.forge.divineCost);
    expect(mut(sim).internal.forged).toEqual(['divine']);
  });

  it('upgrade : hybride I → II → III (upgradeCost), shop:upgraded ; refus base, Divine, rang III, pièces', () => {
    const [c1, c2] = CFG.economy.forge.upgradeCost;
    const sim = shopSim([...vb('stone', 1), ...vb('steam', 1), ...vb('divine', 1)], c1 + c2);
    const i = (): number => sim.state.volley.findIndex((v) => v.element === 'steam');
    expect(sim.upgrade(i())).toBe(true);
    expect(sim.upgrade(i())).toBe(true);
    expect(sim.state.volley[i()]).toEqual({ element: 'steam', tier: 3 });
    expect(sim.state.coins).toBe(0);
    const ups = ofType(sim.step(0), 'shop:upgraded');
    expect(ups).toEqual([
      { type: 'shop:upgraded', element: 'steam', tier: 2, cost: c1 },
      { type: 'shop:upgraded', element: 'steam', tier: 3, cost: c2 },
    ]);
    mut(sim).coins = 9999;
    expect(sim.upgrade(i())).toBe(false); // rang III
    expect(sim.upgrade(sim.state.volley.findIndex((v) => v.element === 'stone'))).toBe(false);
    expect(sim.upgrade(sim.state.volley.findIndex((v) => v.element === 'divine'))).toBe(false);
    const poor = shopSim(vb('laser', 1), c1 - 1);
    expect(poor.upgrade(0)).toBe(false);
  });

  it('fusion : deux hybrides identiques fusionnent (carte Fusion) ; deux Divines jamais', () => {
    const sim = newSim('fuse-h', config(), { unlockedElements: ALL });
    const s = mut(sim);
    s.volley = [...vb('steam', 1, 2), ...vb('divine', 1, 2)];
    s.phase = 'reward';
    s.rewardOffer = [{ kind: 'fuse', element: 'steam', tier: 2 }, { kind: 'fuse', element: 'divine', tier: 2 }];
    sim.chooseReward(0);
    expect(sim.state.volley.filter((v) => v.element === 'steam')).toEqual([{ element: 'steam', tier: 2 }]);
    s.phase = 'reward';
    s.rewardOffer = [{ kind: 'fuse', element: 'divine', tier: 2 }];
    sim.chooseReward(0);
    expect(sim.state.volley.filter((v) => v.element === 'divine')).toHaveLength(2);
    // plafond de volée : les Divines ne sont jamais auto-fusionnées
    s.volley = vb('divine', 1, CFG.balls.maxVolley);
    s.phase = 'reward';
    s.rewardOffer = [{ kind: 'ball', element: 'stone', tier: 1 }];
    sim.chooseReward(0);
    expect(sim.state.volley.filter((v) => v.element === 'divine')).toHaveLength(CFG.balls.maxVolley);
  });
});

// ------------------------------------------------------------------------------------------------------
describe('catalyseur', () => {
  it('un parent (tout rang) sans partenaire forgeable → un article « partenaire rang II » à catalystCost (un seul)', () => {
    const sim = newSim('cata', config(), { unlockedElements: BASE27 });
    const s = mut(sim);
    s.volley = [...vb('fire', 2), ...vb('stone', 1, 3)];
    s.phase = 'reward';
    s.wave = CFG.waves.shopEvery;
    s.rewardOffer = [{ kind: 'coins', amount: 1 }];
    sim.chooseReward(0);
    expect(sim.state.phase).toBe('shop');
    const cat = sim.state.shop!.items.filter((it) => it.catalyst === true);
    expect(cat[0]?.price).toBe(CFG.economy.forge.catalystCost);
    expect(cat).toHaveLength(1);
    expect(cat[0]!.option).toEqual({ kind: 'ball', element: 'ice', tier: 2 });
    expect(sim.state.shop!.items).toHaveLength(CFG.economy.shop.itemCount);
    // acheté : la forge devient possible
    mut(sim).coins = 999;
    sim.buy(sim.state.shop!.items.indexOf(cat[0]!));
    expect(sim.forgeOptions().map((o) => o.result)).toEqual(['steam']);
  });

  it('pas de catalyseur si la forge est déjà possible ou si le partenaire est verrouillé ; un parent rang I suffit', () => {
    const shopWith = (volley: VolleyBall[], unlocked: BallElement[]): number => {
      const sim = newSim('cata2', config(), { unlockedElements: unlocked });
      const s = mut(sim);
      s.volley = volley;
      s.phase = 'reward';
      s.wave = CFG.waves.shopEvery;
      s.rewardOffer = [{ kind: 'coins', amount: 1 }];
      sim.chooseReward(0);
      return sim.state.shop!.items.filter((it) => it.catalyst === true).length;
    };
    expect(shopWith([...vb('fire', 2), ...vb('ice', 2)], BASE27)).toBe(0);
    expect(shopWith([...vb('fire', 2), ...vb('ice', 1)], BASE27)).toBe(0);
    expect(shopWith([...vb('fire', 1), ...vb('stone', 1)], BASE27)).toBe(1);
    expect(shopWith([...vb('fire', 2), ...vb('stone', 1)], ['stone', 'fire'])).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------
describe('hybrides : effet propre + effet parent', () => {
  it('vapeur : explosion du feu, gel de la glace, nuage (steam) qui blesse et gèle les voisins', () => {
    const { evs, sim } = single(vb('steam', 1), (s) => [block(s, 'normal', 3, 4, STURDY), block(s, 'normal', 2, 4, STURDY), block(s, 'normal', 4, 4, STURDY)]);
    const ex = ofType(evs, 'block:explode');
    expect(ex.some((e) => e.element === 'fire')).toBe(true);
    const cloud = ex.find((e) => e.element === 'steam')!;
    expect(cloud.radius).toBeCloseTo(P('steam', 'cloudRadius', 1));
    const frozen = ofType(evs, 'block:frozen').map((e) => e.blockId);
    expect(frozen).toHaveLength(3); // cible (glace) + deux voisins (nuage)
    const target = sim.state.blocks.find((b) => b.col === 3)!;
    expect(ofType(evs, 'block:hit').filter((e) => e.element === 'steam' && e.blockId !== target.id).length).toBeGreaterThanOrEqual(2);
    expect(sim.state.blocks.every((b) => b.frozen)).toBe(true);
  });

  it('laser : rayon dans la colonne (laser, plafond du prisme) + foudre du parent', () => {
    const { evs } = single(vb('laser', 1), (s) => [block(s, 'normal', 3, 4, STURDY), block(s, 'normal', 3, 1, STURDY), block(s, 'normal', 5, 4, STURDY)]);
    const chains = ofType(evs, 'lightning:chain');
    const col = chains.filter((e) => e.element === 'laser');
    expect(col.length).toBeGreaterThan(0);
    expect(col.every((e) => Math.abs(e.to.x - 3.5) < 1e-9)).toBe(true);
    expect(col[0]!.damage).toBeCloseTo(baseDmg('laser', 1) * P('laser', 'colRatio', 1));
    expect(chains.some((e) => e.element === 'lightning')).toBe(true);
  });

  it('grappe : scission au premier impact, bombe au sol, puis mini-bombes (cluster) qui explosent à leur premier impact', () => {
    const { evs } = single(vb('cluster', 1), (s) => [block(s, 'normal', 3, 4, STURDY), block(s, 'normal', 2, 5, STURDY), block(s, 'normal', 4, 5, STURDY)]);
    expect(ofType(evs, 'ball:split').some((e) => e.element === 'split')).toBe(true);
    const ex = ofType(evs, 'block:explode');
    expect(ex.some((e) => e.element === 'bomb')).toBe(true);
    const minis = ofType(evs, 'ball:launched').filter((e) => e.element === 'cluster');
    expect(minis.length).toBeGreaterThanOrEqual(P('cluster', 'count', 1));
    const mb = ex.filter((e) => e.element === 'cluster');
    expect(mb.length).toBeGreaterThan(0);
    expect(mb[0]!.radius).toBeCloseTo(P('cluster', 'miniRadius', 1));
  });

  it('spectre : traverse tout (fantôme), ×1,5 (perforante) et +perBlockPct % par bloc déjà traversé', () => {
    const { evs } = single(vb('wraith', 1), (s) => [1, 2, 3, 4].map((r) => block(s, 'normal', 3, r, STURDY)));
    expect(ofType(evs, 'ball:bounce').filter((e) => e.surface === 'block')).toHaveLength(0);
    const hits = ofType(evs, 'block:hit').filter((e) => e.element === 'wraith');
    expect(hits.length).toBeGreaterThanOrEqual(4);
    const pm = P('pierce', 'damageMult', 1);
    const pct = P('wraith', 'perBlockPct', 1) / 100;
    for (let k = 0; k < 4; k++) {
      const h = hits[k]!;
      const want = baseDmg('wraith', 1) * pm * (1 + CFG.balls.comboDamagePerBounce * h.combo) * (1 + pct * k) * P('wraith', 'rankMult', 1);
      expect(Math.abs(h.damage - want)).toBeLessThanOrEqual(1);
    }
  });

  it('abysse : vide (+% PV max), acide posé au plafond de l abysse, propagé aux voisins au tir suivant', () => {
    const { evs, sim } = single(vb('abyss', 1), (s) => [block(s, 'normal', 3, 4, STURDY), block(s, 'normal', 4, 4, STURDY)]);
    const target = sim.state.blocks.find((b) => b.col === 3)!;
    const neighbor = sim.state.blocks.find((b) => b.col === 4)!;
    const first = ofType(evs, 'block:hit').find((e) => e.blockId === target.id)!;
    expect(first.damage).toBe(Math.round((baseDmg('abyss', 1) + P('void', 'cap', 1)) * P('abyss', 'rankMult', 1)));
    const q = mut(sim).internal.acidQ;
    const k = q.indexOf(target.id);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(q[k + 3]).toBe(P('abyss', 'capPerTurn', 1));
    expect(q.includes(neighbor.id)).toBe(false);
    // tir suivant : propagation au début du tir
    for (let f = 0; f < 200 && sim.state.phase !== 'aiming'; f++) sim.step(FRAME);
    sim.aim({ x: -0.3, y: -1 });
    sim.fire();
    expect(mut(sim).internal.acidQ.includes(neighbor.id)).toBe(true);
    expect(mut(sim).internal.abyss).toContain(neighbor.id);
  });

  it('jackpot : critiques × critMult du jackpot, une pièce par critique, fragment possible, pièces de l or', () => {
    const cfg = config();
    const def = cfg.balls.defs.find((d) => d.id === 'jackpot')!;
    def.params!.fragChance = [1, 1, 1];
    const lucky = cfg.balls.defs.find((d) => d.id === 'lucky')!;
    lucky.params!.critChance = [1, 1, 1];
    const { evs } = single(vb('jackpot', 1), (s) => [block(s, 'normal', 3, 4, STURDY), block(s, 'normal', 1, 2, 1)], { x: -0.6, y: -1 }, { cfg });
    const crit = ofType(evs, 'block:hit').filter((e) => e.crit && e.element === 'jackpot');
    expect(crit.length).toBeGreaterThan(0);
    const h = crit[0]!;
    const want = baseDmg('jackpot', 1) * P('gold', 'damageMult', 1, cfg) * (1 + CFG.balls.comboDamagePerBounce * h.combo) * P('jackpot', 'critMult', 1, cfg);
    expect(Math.abs(h.damage - want)).toBeLessThanOrEqual(1);
    const drops = ofType(evs, 'drop:spawned');
    expect(drops.filter((e) => e.kind === 'coin').length).toBeGreaterThanOrEqual(crit.length);
    if (ofType(evs, 'block:destroyed').length > 0) expect(drops.some((e) => e.kind === 'fragment')).toBe(true);
  });

  it('séisme : géante (rayon ×), choc (le bloc touché remonte) et toute sa rangée remonte', () => {
    const sim = newSim('quake');
    setup(sim, [block(sim, 'normal', 1, 4, STURDY), block(sim, 'normal', 3, 4, STURDY), block(sim, 'normal', 5, 4, STURDY)], vb('quake', 1), { launchX: 3.5, rowsLeft: 1 });
    sim.aim(UP);
    sim.fire();
    let radius = 0;
    for (let f = 0; f < 3000; f++) {
      const evs = sim.step(FRAME);
      for (const b of sim.state.balls) radius = Math.max(radius, b.radius);
      if (evs.some((e) => e.type === 'volley:end')) break;
    }
    expect(radius).toBeCloseTo(CFG.blocks.board.ballRadius * P('giant', 'radiusMult', 1));
    const rows = sim.state.blocks.map((b) => `${b.col}:${b.row}`).sort();
    expect(rows).toEqual(['1:3', '3:3', '5:3']);
  });

  it('missile : comète (vitesse ×) + accélération par rebond (plafonnée) + explosion tous les explodeAtBounce rebonds', () => {
    const sim = newSim('missile');
    setup(sim, corridor(sim), vb('missile', 3), { launchX: 3.5, rowsLeft: 1 });
    sim.aim(ZIGZAG);
    sim.fire();
    let maxSp = 0;
    let first = 0;
    const evs: GameEvent[] = [];
    for (let f = 0; f < 3000; f++) {
      const e = sim.step(FRAME);
      evs.push(...e);
      for (const b of sim.state.balls) {
        const sp = Math.hypot(b.vel.x, b.vel.y);
        if (!first) first = sp;
        maxSp = Math.max(maxSp, sp);
      }
      if (e.some((x) => x.type === 'volley:end')) break;
    }
    const v0 = CFG.blocks.board.ballSpeed * P('comet', 'speedMult', 3);
    expect(first).toBeCloseTo(v0);
    expect(maxSp).toBeGreaterThan(v0 * 1.05);
    expect(maxSp).toBeLessThanOrEqual(v0 * P('missile', 'maxSpeedMult', 3) + 1e-6);
    const bounces = ofType(evs, 'ball:bounce').length;
    const every = P('missile', 'explodeAtBounce', 3);
    expect(bounces).toBeGreaterThanOrEqual(every);
    expect(ofType(evs, 'block:explode').filter((e) => e.element === 'missile').length).toBe(Math.floor(bounces / every));
  });

  it('supernova : paliers → explosions nova ET supernova, bonus du cristal, n éclate jamais', () => {
    const { evs } = single(vb('supernova', 1), corridor, ZIGZAG);
    const bounces = ofType(evs, 'ball:bounce').length;
    expect(bounces).toBeGreaterThan(P('crystal', 'bounces', 1));
    expect(ofType(evs, 'ball:split')).toHaveLength(0);
    const ex = ofType(evs, 'block:explode');
    const sn = ex.filter((e) => e.element === 'supernova');
    expect(sn.length).toBeGreaterThanOrEqual(2);
    expect(sn[0]!.radius).toBeCloseTo(P('supernova', 'radius', 1));
    expect(ex.some((e) => e.element === 'nova')).toBe(true);
    // bonus du cristal : les derniers impacts frappent plus fort que le premier (combo compris)
    const hits = ofType(evs, 'block:hit').filter((e) => e.element === 'supernova');
    const last = hits[hits.length - 1]!;
    const comboOnly = baseDmg('supernova', 1) * (1 + CFG.balls.comboDamagePerBounce * last.combo);
    expect(last.damage).toBeGreaterThan(comboOnly * 1.5);
  });

  it('peste : bloc rongé qui meurt → soin et contamination des voisins ; vampire : soin à la casse directe', () => {
    const sim = newSim('plague');
    setup(sim, [block(sim, 'normal', 3, 4, STURDY), block(sim, 'normal', 4, 4, STURDY)], vb('plague', 1), { launchX: 3.5, rowsLeft: 1 });
    mut(sim).hp = 1;
    fly(sim, UP);
    const target = sim.state.blocks.find((b) => b.col === 3)!;
    const neighbor = sim.state.blocks.find((b) => b.col === 4)!;
    expect(mut(sim).internal.plague).toContain(target.id);
    for (let f = 0; f < 200 && sim.state.phase !== 'aiming'; f++) sim.step(FRAME);
    target.hp = 1; // l'acide l'achève au début du tir suivant
    sim.aim({ x: -0.5, y: -1 });
    sim.fire();
    const evs = sim.step(0);
    expect(ofType(evs, 'block:destroyed').some((e) => e.blockId === target.id)).toBe(true);
    expect(ofType(evs, 'player:healed').some((e) => e.source === 'vampire')).toBe(true);
    expect(mut(sim).internal.acidQ.includes(neighbor.id)).toBe(true);
    expect(mut(sim).internal.plague).toContain(neighbor.id);

    // parent vampire : casse directe
    const v = newSim('plague-v');
    setup(v, [block(v, 'normal', 3, 4, 1)], vb('plague', 1), { launchX: 3.5, rowsLeft: 1 });
    mut(v).hp = 1;
    const e2 = fly(v, UP);
    expect(ofType(e2, 'player:healed').some((e) => e.source === 'vampire')).toBe(true);
  });

  it('chœur : count balles miroirs (choir) au départ, puis chaque balle repart du sol une fois (écho)', () => {
    const tier: BallTier = 3;
    const { evs } = single(vb('choir', tier), (s) => [block(s, 'normal', 0, 0, STURDY)]);
    const launched = ofType(evs, 'ball:launched');
    const n = P('choir', 'count', tier);
    expect(launched.filter((e) => e.element === 'choir')).toHaveLength(n); // la balle de la volée + n − 1 miroirs
    expect(launched.filter((e) => e.element === 'echo')).toHaveLength(n); // écho du parent + écho de chaque miroir
  });

  it('orbite : 3 allers-retours, aspire les drops à magnetRadius', () => {
    const tier: BallTier = 1;
    const sim = newSim('orbit');
    setup(sim, [block(sim, 'normal', 0, 0, STURDY)], vb('orbit', tier), { launchX: 3.5, rowsLeft: 1 });
    const r = P('orbit', 'magnetRadius', tier);
    mut(sim).drops.push({ id: mut(sim).internal.nextId++, kind: 'coin', pos: { x: 3.5 + r * 0.9, y: 5 }, value: 3, element: null });
    const evs = fly(sim, UP);
    // chaque arrivée intermédiaire relance : ball:bounce au sol (y = rows)
    const relaunch = ofType(evs, 'ball:bounce').filter((e) => e.pos.y === CFG.blocks.board.rows);
    expect(relaunch).toHaveLength(P('orbit', 'returns', tier) - 1);
    expect(ofType(evs, 'drop:collected')).toHaveLength(1);
  });

  it('marteau : plomb (pas de combo), ×damageMult, retire armure et PV max (plafond), repousse le bloc', () => {
    const { evs, sim } = single(vb('hammer', 1), (s) => [block(s, 'armored', 3, 4, STURDY)]);
    const hit = ofType(evs, 'block:hit')[0]!;
    const loss = Math.min((P('hammer', 'pctMaxHp', 1) / 100) * STURDY, P('hammer', 'cap', 1));
    expect(hit.damage).toBe(Math.round(baseDmg('hammer', 1) * P('hammer', 'damageMult', 1) + loss));
    expect(hit.combo).toBe(0);
    const b = sim.state.blocks[0]!;
    expect(b.kind).toBe('normal');
    expect(b.maxHp).toBe(STURDY - loss);
    expect(b.row).toBe(3);
    expect(ofType(evs, 'ball:bounce').every((e) => e.combo === 0)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------
describe('Divine', () => {
  it('dorée même si elle n est pas la dernière, rayon ×, traverse tout, ignore l armure', () => {
    const sim = newSim('div');
    setup(sim, [block(sim, 'armored', 3, 4, STURDY), block(sim, 'normal', 3, 2, STURDY)], [...vb('divine', 1), ...vb('stone', 1)], { launchX: 3.5, rowsLeft: 1 });
    sim.aim(UP);
    sim.fire();
    const evs: GameEvent[] = [];
    let radius = 0;
    for (let f = 0; f < 3000; f++) {
      const e = sim.step(FRAME);
      evs.push(...e);
      for (const b of sim.state.balls) if (b.element === 'divine') radius = b.radius;
      if (e.some((x) => x.type === 'volley:end')) break;
    }
    const div = ofType(evs, 'ball:launched').find((e) => e.element === 'divine')!;
    expect(div.golden).toBe(true);
    expect(radius).toBeCloseTo(CFG.blocks.board.ballRadius * P('divine', 'radiusMult', 1));
    const dh = ofType(evs, 'block:hit').filter((e) => e.ballId === div.ballId && e.element === 'divine');
    const armored = sim.state.blocks.find((b) => b.col === 3 && b.kind === 'armored')!;
    expect(dh.some((e) => e.blockId === armored.id && e.damage > 0)).toBe(true);
    expect(ofType(evs, 'ball:bounce').filter((e) => e.ballId === div.ballId && e.surface === 'block')).toHaveLength(0);
  });

  it('nova à chaque rebond (+comboPerBounce), Jugement sur la rangée la plus basse, drop garanti', () => {
    const sim = newSim('div2');
    const low = [0, 2, 6].map((c) => block(sim, 'normal', c, 6, STURDY));
    const weak = [1, 5].map((c) => block(sim, 'normal', c, 1, 1));
    setup(sim, [...low, ...weak], vb('divine', 1), { launchX: 3.5, rowsLeft: 1 });
    const evs = fly(sim, { x: 0.6, y: -1 });
    const id = ofType(evs, 'ball:launched')[0]!.ballId;
    const bounces = ofType(evs, 'ball:bounce').filter((e) => e.ballId === id);
    const novas = ofType(evs, 'block:explode').filter((e) => e.element === 'divine');
    expect(bounces.length).toBeGreaterThan(0);
    expect(novas).toHaveLength(bounces.length);
    expect(novas[0]!.radius).toBeCloseTo(P('divine', 'novaRadius', 1));
    // Jugement : un block:hit (judgement) + un lightning:chain divine par bloc de la rangée 6
    const j = P('divine', 'judgement', 1);
    const jh = ofType(evs, 'block:hit').filter((e) => e.ballId === id && e.damage === j);
    expect(jh.map((e) => e.blockId).sort()).toEqual(low.map((b) => b.id).sort());
    const chains = ofType(evs, 'lightning:chain').filter((e) => e.element === 'divine');
    expect(chains).toHaveLength(low.length);
    expect(chains.every((e) => e.from.y === CFG.blocks.board.rows)).toBe(true);
    // drop garanti : chaque bloc détruit lâche un drop
    const destroyed = ofType(evs, 'block:destroyed').length;
    expect(destroyed).toBeGreaterThan(0);
    expect(ofType(evs, 'drop:spawned').length).toBeGreaterThanOrEqual(destroyed);
    // combo : au moins comboPerBounce par rebond de mur (ball:bounce porte le combo d'avant le bonus du rebond)
    const maxCombo = Math.max(...bounces.map((e) => e.combo));
    expect(maxCombo).toBeGreaterThanOrEqual(P('divine', 'comboPerBounce', 1) * (bounces.length - 1));
  });
});

// ------------------------------------------------------------------------------------------------------
const FORGED: BallElement[] = [...HYBRIDS, 'divine'];

function forgedVolley(rng: ReturnType<typeof createRng>): VolleyBall[] {
  return FORGED.map((el) => ({ element: el, tier: (el === 'divine' ? 1 : rng.int(1, 3)) as BallTier }));
}

function playForged(sim: Sim, seed: string, shots: number, check: boolean): void {
  const rng = createRng(seed);
  const { cols, rows } = sim.config.blocks.board;
  mut(sim).volley = forgedVolley(rng);
  for (let k = 0; k < shots; k++) {
    if (sim.state.phase === 'gameover') {
      sim.restart();
      mut(sim).volley = forgedVolley(rng);
    }
    for (let g = 0; g < 10; g++) {
      if (sim.state.phase === 'reward') sim.chooseReward(0);
      else if (sim.state.phase === 'shop') sim.leaveShop();
      else break;
    }
    if (sim.state.phase !== 'aiming') continue;
    sim.aim(randomDir(rng), rng.next());
    sim.fire();
    for (let f = 0; f < 5000; f++) {
      sim.step(FRAME);
      const st = sim.state;
      if (check) {
        for (const b of st.balls) {
          if (!Number.isFinite(b.pos.x) || !Number.isFinite(b.pos.y) || !Number.isFinite(b.vel.x) || !Number.isFinite(b.vel.y)) throw new Error(`NaN balle ${b.element}`);
          if (b.pos.x < 0 || b.pos.x > cols || b.pos.y < 0 || b.pos.y > rows) throw new Error(`balle hors plateau ${b.element}`);
        }
        for (const b of st.blocks) if (!Number.isFinite(b.hp) || !Number.isFinite(b.maxHp) || !Number.isFinite(b.row)) throw new Error('NaN bloc');
        for (const d of st.drops) if (!Number.isFinite(d.pos.y) || !Number.isFinite(d.value)) throw new Error('NaN drop');
        if (!Number.isFinite(st.hp) || !Number.isFinite(st.coins) || !Number.isFinite(st.stats.totalDamage)) throw new Error('NaN joueur');
      }
      if (st.phase !== 'firing' && st.phase !== 'advancing') break;
    }
  }
}

describe('hybrides et Divine : déterminisme, robustesse, tirages', () => {
  it('même seed → même snapshot après 100 tirs (volée des 13 hybrides + Divine)', () => {
    const a = newSim('detH', config(), { unlockedElements: ALL });
    const b = newSim('detH', config(), { unlockedElements: ALL });
    playForged(a, 'detH-aim', 100, false);
    playForged(b, 'detH-aim', 100, false);
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  }, 120_000);

  it('reprise depuis un snapshot en plein tir (hybrides + Divine) : même suite', () => {
    const cfg = config();
    const a = newSim('resumeH', cfg, { unlockedElements: ALL });
    playForged(a, 'resumeH-aim', 10, false);
    for (let g = 0; g < 10 && a.state.phase !== 'aiming'; g++) {
      if (a.state.phase === 'reward') a.chooseReward(0);
      else if (a.state.phase === 'shop') a.leaveShop();
      else a.step(FRAME);
    }
    a.aim({ x: 0.3, y: -1 });
    a.fire();
    for (let f = 0; f < 40; f++) a.step(FRAME);
    const snap = a.snapshot();
    const r2 = createSim(cfg, { seed: snap.seed, meta: metaOf(cfg, { unlockedElements: ALL }), snapshot: snap });
    for (let f = 0; f < 600; f++) {
      a.step(FRAME);
      r2.step(FRAME);
    }
    expect(JSON.stringify(r2.snapshot())).toBe(JSON.stringify(a.snapshot()));
  });

  it('300 tirs aléatoires, volée de 13 hybrides + Divine : aucun NaN, aucune balle hors plateau', () => {
    const sim = newSim('robustH', config(), { unlockedElements: ALL });
    playForged(sim, 'robustH-aim', 300, true);
    expect(sim.state.stats.shots).toBeGreaterThan(0);
  }, 300_000);

  it('hybrides et Divine (weight 0) jamais en drop, offre ni boutique, même débloquées', () => {
    expect(CFG.balls.defs.filter((d) => FORGED.includes(d.id)).every((d) => d.weight === 0)).toBe(true);
    const sim = newSim('never', config(), { unlockedElements: ALL, bonusHp: 50 });
    const seen: BallElement[] = [];
    for (let k = 0; k < 150 && sim.state.phase !== 'gameover'; k++) {
      for (let g = 0; g < 10; g++) {
        const s = sim.state;
        if (s.phase === 'reward') {
          for (const o of s.rewardOffer ?? []) if (o.kind === 'ball' || o.kind === 'fuse') seen.push(o.element);
          sim.chooseReward(0);
        } else if (s.phase === 'shop') {
          for (const it of s.shop!.items) if (it.option.kind === 'ball') seen.push(it.option.element);
          sim.reroll();
          for (const it of s.shop!.items) if (it.option.kind === 'ball') seen.push(it.option.element);
          sim.leaveShop();
        } else break;
      }
      if (sim.state.phase !== 'aiming') break;
      shoot(sim, lowestBlockDir(sim));
      for (const d of sim.state.drops) if (d.element) seen.push(d.element);
    }
    for (const v of sim.state.volley) seen.push(v.element);
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.filter((e) => FORGED.includes(e))).toEqual([]);
  }, 120_000);
});
