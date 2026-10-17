// sim/elements/hybrid.ts — les 13 hybrides (forge : deux balles de rang III, docs/HYBRIDS.md).
// Composition générique : hooks de l'hybride = hooks du parent A, puis du parent B (chacun lit ses propres
// params au rang de l'hybride, via prm(ctx, '<parent>', ...) et b.tier), puis l'effet propre (params de l'hybride).
// Conflits : passThrough / noCombo / noWallCombo = union ; modifyBall = produit (appels successifs) ;
// modifyDamage = chaîne ; collectRadius = max ; onDropCollected = produit ; onBlockDestroyed = « déjà géré » si
// l'un des trois l'a géré ; effets « au premier impact » (feu, glace, scission) : un bit par parent dans fx.trig,
// chacun se déclenche une fois. Les hooks globaux (onShotStart, onAnyBlockDestroyed) des parents ne sont PAS
// recomposés (ils tournent déjà une fois par tir pour tout le monde) : seuls ceux de l'effet propre sont gardés.
//
// Compteurs libres de BallFx utilisés par les effets propres :
//   vapeur n0 = nuages ce tir ; spectre n0 = blocs traversés ; séisme n0 = rangées repoussées ;
//   missile n0 = rebonds, n1 = multiplicateur de vitesse au lancement, spawned = explosions du vol.
import type { Ball, BallElement, Block } from '../../core/types';
import type { Ctx } from '../ctx';
import { ballDef, emit, isBreakable } from '../ctx';
import { ballDamage, damageBlock, explode } from '../combat';
import { spawnDrop } from '../drops';
import { fixVelocity } from '../physics';
import { heal } from '../rewards';
import type { BallFx } from '../state';
import type { ElementHooks } from './types';
import { DEG, centerX, centerY, blockIndex, lastFx, prm, setAttrib, spawnMini } from './common';
import { acid, acidChargesOf, addAcidCharge, comet, fire, ice, lightning, setAcidCap, tryFreeze } from './elemental';
import { bomb, giant, lead, pushBlockUp, shock } from './heavy';
import { boomerang, echo, ghost, homing, pierce } from './tricky';
import { splitHooks, twin } from './swarm';
import { gold, lucky, magnet, vampire } from './greed';
import { crystal, nova, prism, rust, voidHooks } from './arcane';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Fn<K extends keyof ElementHooks> = NonNullable<ElementHooks[K]>;

/** Copie des hooks sans les clés `omit` (conflit résolu par l'effet propre). */
function without(h: ElementHooks, omit: readonly (keyof ElementHooks)[]): ElementHooks {
  const out: Mutable<ElementHooks> = { ...h };
  for (const k of omit) delete out[k];
  return out;
}

function fns<K extends keyof ElementHooks>(list: readonly ElementHooks[], k: K): Fn<K>[] {
  const out: Fn<K>[] = [];
  for (const h of list) {
    const f = h[k];
    if (typeof f === 'function') out.push(f as Fn<K>);
  }
  return out;
}

/** Tous les bits de fx.trig (A = 1, B = 2, propre = 4) : fille de scission, premiers impacts déjà consommés. */
const TRIG_ALL = 7;

/**
 * Équilibrage par rang (optionnel) : balls.json → <hybride>.params.rankMult multiplie tous les dégâts de la balle
 * (impact et effets dérivés), appliqué en fin de chaîne modifyDamage. Absent = ×1.
 */
function rankMult(id: BallElement): ElementHooks {
  return {
    modifyDamage(ctx, b, _fx, dmg) {
      return dmg * rankOf(ctx, id, b.tier);
    },
  };
}

/** Valeur de rankMult (×1 si absent) ; aussi appliquée aux mini-balles de l'hybride (miroirs, mini-bombes). */
function rankOf(ctx: Ctx, id: BallElement, tier: number): number {
  const t = ballDef(ctx, id).params?.rankMult?.[tier - 1];
  return typeof t === 'number' && Number.isFinite(t) ? t : 1;
}

/** Hooks d'une hybride `id` : parent A, parent B, puis l'effet propre (et rankMult). */
export function composeHybrid(id: BallElement, a: ElementHooks, b: ElementHooks, ownBase: ElementHooks): ElementHooks {
  const rm = rankMult(id);
  const own: ElementHooks = ownBase.modifyDamage
    ? {
        ...ownBase,
        modifyDamage: (ctx, ball, fx, dmg, target) =>
          (rm.modifyDamage as Fn<'modifyDamage'>)(ctx, ball, fx, (ownBase.modifyDamage as Fn<'modifyDamage'>)(ctx, ball, fx, dmg, target), target),
      }
    : { ...ownBase, modifyDamage: rm.modifyDamage };
  const all = [a, b, own];
  const out: Mutable<ElementHooks> = {};
  if (a.passThrough || b.passThrough || own.passThrough) out.passThrough = true;
  if (a.noCombo || b.noCombo || own.noCombo) out.noCombo = true;
  if (a.noWallCombo || b.noWallCombo || own.noWallCombo) out.noWallCombo = true;
  if (own.alwaysGolden) out.alwaysGolden = true;
  if (own.traverseCombo !== undefined) out.traverseCombo = own.traverseCombo;
  if (own.params) out.params = own.params;
  if (own.onShotStart) out.onShotStart = own.onShotStart;
  if (own.onAnyBlockDestroyed) out.onAnyBlockDestroyed = own.onAnyBlockDestroyed;

  const modBall = fns(all, 'modifyBall');
  if (modBall.length) {
    out.modifyBall = (ctx, ball, fx) => {
      for (let k = 0; k < modBall.length; k++) (modBall[k] as Fn<'modifyBall'>)(ctx, ball, fx);
    };
  }
  const launch = fns(all, 'onLaunch');
  if (launch.length) {
    out.onLaunch = (ctx, ball, fx) => {
      for (let k = 0; k < launch.length; k++) (launch[k] as Fn<'onLaunch'>)(ctx, ball, fx);
    };
  }
  const modDmg = fns(all, 'modifyDamage');
  if (modDmg.length) {
    out.modifyDamage = (ctx, ball, fx, dmg, target) => {
      let d = dmg;
      for (let k = 0; k < modDmg.length; k++) d = (modDmg[k] as Fn<'modifyDamage'>)(ctx, ball, fx, d, target);
      return d;
    };
  }
  // onBlockHit : un bit de « premier impact » par source (b.triggered est partagé par feu, glace et scission)
  const hits: Fn<'onBlockHit'>[] = [];
  const bits: number[] = [];
  for (let k = 0; k < 3; k++) {
    const f = (all[k] as ElementHooks).onBlockHit;
    if (f) {
      hits.push(f);
      bits.push(1 << k);
    }
  }
  if (hits.length) {
    out.onBlockHit = (ctx, ball, fx, bi, blk, px, py, dmg, isPeg) => {
      const track = fx !== ctx.nullFx;
      let trig = fx.trig;
      if (ball.triggered && trig === 0) trig = TRIG_ALL;
      if (track) fx.hitRow = blk.row;
      for (let k = 0; k < hits.length; k++) {
        const bit = bits[k] as number;
        ball.triggered = (trig & bit) !== 0;
        (hits[k] as Fn<'onBlockHit'>)(ctx, ball, fx, bi, blk, px, py, dmg, isPeg);
        if (ball.triggered) trig |= bit;
      }
      if (track) fx.trig = trig;
      ball.triggered = trig !== 0;
    };
  }
  const destroyed = fns(all, 'onBlockDestroyed');
  if (destroyed.length) {
    out.onBlockDestroyed = (ctx, ball, fx, blk, x, y) => {
      let handled = false;
      for (let k = 0; k < destroyed.length; k++) if ((destroyed[k] as Fn<'onBlockDestroyed'>)(ctx, ball, fx, blk, x, y)) handled = true;
      return handled;
    };
  }
  const bounce = fns(all, 'onBounce');
  if (bounce.length) {
    out.onBounce = (ctx, ball, fx, surface, nx, ny, bi) => {
      for (let k = 0; k < bounce.length && ball.alive; k++) (bounce[k] as Fn<'onBounce'>)(ctx, ball, fx, surface, nx, ny, bi);
    };
  }
  const wall = fns(all, 'onWallBounce');
  if (wall.length) {
    out.onWallBounce = (ctx, ball, fx, wallX) => {
      for (let k = 0; k < wall.length && ball.alive; k++) (wall[k] as Fn<'onWallBounce'>)(ctx, ball, fx, wallX);
    };
  }
  const ceil = fns(all, 'onCeilingBounce');
  if (ceil.length) {
    out.onCeilingBounce = (ctx, ball, fx) => {
      for (let k = 0; k < ceil.length && ball.alive; k++) (ceil[k] as Fn<'onCeilingBounce'>)(ctx, ball, fx);
    };
  }
  const grounded = fns(all, 'onGrounded');
  if (grounded.length) {
    out.onGrounded = (ctx, ball, fx) => {
      for (let k = 0; k < grounded.length; k++) (grounded[k] as Fn<'onGrounded'>)(ctx, ball, fx);
    };
  }
  const tick = fns(all, 'onTick');
  if (tick.length) {
    out.onTick = (ctx, ball, fx, dtMs) => {
      for (let k = 0; k < tick.length && ball.alive; k++) (tick[k] as Fn<'onTick'>)(ctx, ball, fx, dtMs);
    };
  }
  const milestone = fns(all, 'onComboMilestone');
  if (milestone.length) {
    out.onComboMilestone = (ctx, ball, fx, level, combo) => {
      for (let k = 0; k < milestone.length; k++) (milestone[k] as Fn<'onComboMilestone'>)(ctx, ball, fx, level, combo);
    };
  }
  const reach = fns(all, 'collectRadius');
  if (reach.length) {
    out.collectRadius = (ctx, ball, fx) => {
      let r = 0;
      for (let k = 0; k < reach.length; k++) r = Math.max(r, (reach[k] as Fn<'collectRadius'>)(ctx, ball, fx));
      return r;
    };
  }
  const collected = fns(all, 'onDropCollected');
  if (collected.length) {
    out.onDropCollected = (ctx, ball, fx, d) => {
      let m = 1;
      for (let k = 0; k < collected.length; k++) m *= (collected[k] as Fn<'onDropCollected'>)(ctx, ball, fx, d);
      return m;
    };
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------------
// Utilitaires des effets propres

/** Le disque (x,y,r) touche-t-il l'AABB du bloc ? */
function inDisk(b: Block, x: number, y: number, r: number): boolean {
  const qx = x < b.col ? b.col : x > b.col + b.width ? b.col + b.width : x;
  const qy = y < b.row ? b.row : y > b.row + 1 ? b.row + 1 : y;
  const dx = x - qx;
  const dy = y - qy;
  return dx * dx + dy * dy < r * r;
}

/** Deux blocs se touchent (cases voisines, diagonales comprises). Géométrie pure. */
function adjacent(a: Block, b: Block): boolean {
  return Math.abs(a.row - b.row) <= 1 && b.col <= a.col + a.width && b.col + b.width >= a.col;
}

/** Ajoute (ou relève le rang de) la marque `id` dans une liste de paires [blockId, rang]. */
function mark(list: number[], id: number, tier: number): void {
  for (let k = 0; k + 1 < list.length; k += 2) {
    if (list[k] === id) {
      if ((list[k + 1] as number) < tier) list[k + 1] = tier;
      return;
    }
  }
  list.push(id, tier);
}

/** Retire les paires dont le bloc a disparu, n'est plus cassable ou (si `needAcid`) n'a plus d'acide. */
function pruneMarks(ctx: Ctx, list: number[], needAcid: boolean): void {
  let w = 0;
  for (let k = 0; k + 1 < list.length; k += 2) {
    const id = list[k] as number;
    const i = blockIndex(ctx, id);
    const blk = i >= 0 ? (ctx.s.blocks[i] as Block) : null;
    if (!blk || !isBreakable(blk) || (needAcid && acidChargesOf(ctx, id) === 0)) continue;
    list[w] = id;
    list[w + 1] = list[k + 1] as number;
    w += 2;
  }
  list.length = w;
}

/**
 * Propagation d'acide (abysse, peste) : jusqu'à `n` voisins cassables de `src` SANS charge reçoivent une charge
 * (tables de l'acide au rang `tier`, plafond par tour `cap`), du plus proche au plus lointain (index à égalité),
 * et sont marqués dans `marks` (paires [blockId, rang]).
 */
function spreadAcid(ctx: Ctx, src: Block, n: number, tier: number, cap: number, marks: number[]): void {
  const blocks = ctx.s.blocks;
  const pct = prm(ctx, 'acid', 'pctPerTurn', tier);
  const turns = Math.round(prm(ctx, 'acid', 'turns', tier));
  const max = Math.round(prm(ctx, 'acid', 'maxCharges', tier));
  const sx = centerX(src);
  const sy = centerY(src);
  for (let m = 0; m < n; m++) {
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < blocks.length; i++) {
      const t = blocks[i] as Block;
      if (t === src || t.kind === 'boss' || !isBreakable(t) || !adjacent(src, t) || acidChargesOf(ctx, t.id) > 0) continue;
      const dx = centerX(t) - sx;
      const dy = centerY(t) - sy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best < 0) return;
    const t = blocks[best] as Block;
    if (!addAcidCharge(ctx, t, pct, turns, max, cap)) return;
    mark(marks, t.id, tier);
  }
}

/** Explosion différée attribuée à la balle b (casses, drops, contrats), attribution courante restaurée. Sans fermeture. */
function explodeAs(ctx: Ctx, b: Ball, fx: BallFx, radius: number, dmg: number, el: BallElement): void {
  const pb = ctx.curBall;
  const pf = ctx.curFx;
  const pid = ctx.curBallId;
  const pg = ctx.curGolden;
  setAttrib(ctx, b, fx, b.id, b.golden);
  explode(ctx, b.pos.x, b.pos.y, radius, dmg, el, -1, false, el);
  setAttrib(ctx, pb, pf, pid, pg);
}

// ----------------------------------------------------------------------------------------------------------
// Mini-balles à effet (fx.miniFx) : elles n'héritent d'aucun hook d'élément, sauf celui-ci.

export const MINI_NONE = 0;
export const MINI_BOMB = 1;
export const MINI_MIRROR = 2;

/** Mini-bombe de la grappe : explose à son premier impact (rayon cluster.miniRadius) puis disparaît. */
const miniBomb: ElementHooks = {
  onBlockHit(ctx, b, _fx, bi, _blk, px, py, dmg) {
    if (b.triggered) return;
    b.triggered = true;
    const radius = prm(ctx, 'cluster', 'miniRadius', b.tier) * ctx.relic.bigboom;
    if (radius > 0 && dmg > 0) explode(ctx, px, py, radius, dmg, 'cluster', bi, false, 'cluster');
    b.alive = false; // libérée en fin de sous-pas (comme l'éclat du cristal)
  },
};

/** Balle miroir du chœur : repart du sol une fois (copie d'écho traversante, × choir.echoRatio). */
const miniMirror: ElementHooks = {
  onGrounded(ctx, b, fx) {
    const nb = spawnMini(ctx, b, 'echo', b.pos.x, b.pos.y, b.vel.x, -Math.abs(b.vel.y), fx.dmgMult * prm(ctx, 'choir', 'echoRatio', b.tier) * echoBaseRatio(ctx), 1);
    if (!nb) return;
    lastFx(ctx).pass = true;
    emit(ctx, { type: 'ball:launched', ballId: nb.id, element: nb.element, tier: nb.tier, pos: { x: nb.pos.x, y: nb.pos.y }, golden: false });
  },
};

/**
 * Une copie d'écho est une mini-balle d'élément 'echo' : ses dégâts partent de la base de l'écho. Pour le chœur,
 * on la ramène à la base du chœur (× base chœur / base écho) ; rankMult est déjà dans le dmgMult du miroir.
 */
function echoBaseRatio(ctx: Ctx): number {
  const e = ballDef(ctx, 'echo').baseDamage;
  return e > 0 ? ballDef(ctx, 'choir').baseDamage / e : 1;
}

/** Index = fx.miniFx. */
export const MINI_HOOKS: readonly ElementHooks[] = [{}, miniBomb, miniMirror];

// ----------------------------------------------------------------------------------------------------------
// Effets propres

/** Vapeur : à l'impact, nuage (cloudRadius) : cloudRatio × dégâts aux voisins et gel (règles de la glace), cloudsPerShot par balle. */
const steamOwn: ElementHooks = {
  params: ['cloudRadius', 'cloudRatio', 'cloudsPerShot'],
  onBlockHit(ctx, b, fx, bi, _blk, px, py, dmg, isPeg) {
    if (isPeg || fx.n0 >= Math.round(prm(ctx, 'steam', 'cloudsPerShot', b.tier))) return;
    fx.n0++;
    const radius = prm(ctx, 'steam', 'cloudRadius', b.tier) * ctx.relic.bigboom;
    const d = dmg * prm(ctx, 'steam', 'cloudRatio', b.tier);
    if (radius <= 0) return;
    emit(ctx, { type: 'block:explode', pos: { x: px, y: py }, radius, damage: d, element: 'steam' });
    const blocks = ctx.s.blocks;
    const n = blocks.length;
    for (let i = 0; i < n; i++) {
      if (i === bi) continue;
      const t = blocks[i] as Block;
      if (!isBreakable(t) || !inDisk(t, px, py, radius)) continue;
      if (d > 0) damageBlock(ctx, i, d, 'steam', 0, false);
      if (isBreakable(t)) tryFreeze(ctx, t);
    }
  },
};

/** Laser : chaque impact sur un bloc envoie un rayon dans toute sa colonne (colRatio × dégâts, plafond du prisme). */
const laserOwn: ElementHooks = {
  params: ['colRatio'],
  onBlockHit(ctx, b, _fx, bi, blk, px, py, dmg, isPeg) {
    if (isPeg) return;
    const d = Math.min(dmg * prm(ctx, 'laser', 'colRatio', b.tier), prm(ctx, 'prism', 'cap', b.tier));
    if (d <= 0) return;
    const blocks = ctx.s.blocks;
    const n = blocks.length;
    const c0 = blk.col;
    const c1 = blk.col + blk.width;
    for (let i = 0; i < n; i++) {
      if (i === bi) continue;
      const t = blocks[i] as Block;
      if (!isBreakable(t) || t.col >= c1 || t.col + t.width <= c0) continue;
      emit(ctx, { type: 'lightning:chain', from: { x: px, y: py }, to: { x: centerX(t), y: centerY(t) }, damage: d, element: 'laser' });
      damageBlock(ctx, i, d, 'laser', b.combo, false);
    }
  },
};

/**
 * Grappe : au sol, l'explosion de la bombe (parent, mais avec les tables bombRadius / bombMult de la grappe : la
 * bombe de base écrasait l'équilibrage sur gros blocs), puis `count` mini-bombes repartent vers le haut (±spreadDeg).
 */
const clusterOwn: ElementHooks = {
  params: ['count', 'miniRadius', 'miniMult', 'spreadDeg', 'bombRadius', 'bombMult'],
  onGrounded(ctx, b, fx) {
    const br = prm(ctx, 'cluster', 'bombRadius', b.tier) * ctx.relic.bigboom;
    const bd = ballDamage(ctx, b, null, fx) * prm(ctx, 'cluster', 'bombMult', b.tier);
    if (br > 0 && bd > 0) {
      const pb = ctx.curBall;
      const pf = ctx.curFx;
      const pid = ctx.curBallId;
      const pg = ctx.curGolden;
      setAttrib(ctx, b, fx, b.id, b.golden);
      explode(ctx, b.pos.x, ctx.cfg.blocks.board.rows, br, bd, 'bomb', -1, false, 'bomb');
      setAttrib(ctx, pb, pf, pid, pg);
    }
    const n = Math.round(prm(ctx, 'cluster', 'count', b.tier));
    if (n <= 0) return;
    const half = prm(ctx, 'cluster', 'spreadDeg', b.tier) * DEG;
    const mult = prm(ctx, 'cluster', 'miniMult', b.tier) * rankOf(ctx, 'cluster', b.tier);
    const sp = ctx.ballSpeed;
    let spawned = 0;
    for (let k = 0; k < n; k++) {
      const a = n > 1 ? half * ((2 * k) / (n - 1) - 1) : 0;
      const nb = spawnMini(ctx, b, 'cluster', b.pos.x, b.pos.y, Math.sin(a) * sp, -Math.cos(a) * sp, mult, 1);
      if (!nb) break;
      lastFx(ctx).miniFx = MINI_BOMB;
      spawned++;
      emit(ctx, { type: 'ball:launched', ballId: nb.id, element: nb.element, tier: nb.tier, pos: { x: nb.pos.x, y: nb.pos.y }, golden: false });
    }
    if (spawned > 0) emit(ctx, { type: 'ball:split', pos: { x: b.pos.x, y: ctx.cfg.blocks.board.rows }, element: 'cluster' });
  },
};

/** Spectre : +perBlockPct % de dégâts par bloc déjà traversé dans le vol (au plus capBlocks blocs) ; traverser ne donne pas de combo. */
const wraithOwn: ElementHooks = {
  params: ['perBlockPct', 'capBlocks'],
  // la traversée ne donne pas de combo (sinon, sur des blocs qui ne meurent pas, chaque passage multiplie les dégâts)
  traverseCombo: 0,
  modifyDamage(ctx, b, fx, dmg, target) {
    if (!target || fx.n0 <= 0) return dmg;
    const n = Math.min(fx.n0, prm(ctx, 'wraith', 'capBlocks', b.tier));
    return dmg * (1 + (prm(ctx, 'wraith', 'perBlockPct', b.tier) / 100) * n);
  },
  onBlockHit(_ctx, _b, fx, _bi, _blk, _px, _py, _dmg, isPeg) {
    if (!isPeg) fx.n0++;
  },
};

/** Abysse : les charges d'acide du bloc touché plafonnent à capPerTurn (fixé, pas seulement relevé) et se propagent à `spread` voisins sans acide à chaque tour. */
const abyssOwn: ElementHooks = {
  params: ['spread', 'capPerTurn'],
  onBlockHit(ctx, b, _fx, _bi, blk, _px, _py, _dmg, isPeg) {
    if (isPeg || !isBreakable(blk) || acidChargesOf(ctx, blk.id) === 0) return;
    setAcidCap(ctx, blk.id, prm(ctx, 'abyss', 'capPerTurn', b.tier));
    mark(ctx.s.internal.abyss, blk.id, b.tier);
  },
  onShotStart(ctx) {
    const it = ctx.s.internal;
    if (!Array.isArray(it.abyss)) it.abyss = [];
    const m = it.abyss;
    pruneMarks(ctx, m, true); // après la morsure de l'acide (ordre du registre) : charges épuisées retirées
    const n0 = m.length; // les blocs contaminés ce tour-ci ne propagent qu'au suivant
    for (let k = 0; k + 1 < n0; k += 2) {
      const i = blockIndex(ctx, m[k] as number);
      const src = i >= 0 ? (ctx.s.blocks[i] as Block) : null;
      if (!src) continue;
      const tier = m[k + 1] as number;
      spreadAcid(ctx, src, Math.round(prm(ctx, 'abyss', 'spread', tier)), tier, prm(ctx, 'abyss', 'capPerTurn', tier), m);
    }
  },
};

/** Jackpot : critiques × critMult (au lieu de celui de la chance) ; chaque critique lâche une pièce ; fragChance de fragment par bloc détruit. */
const jackpotOwn: ElementHooks = {
  params: ['critMult', 'fragChance'],
  modifyDamage(ctx, b, _fx, dmg, target) {
    if (!target || !ctx.hit.crit) return dmg;
    const base = prm(ctx, 'lucky', 'critMult', b.tier);
    return base > 0 ? (dmg * prm(ctx, 'jackpot', 'critMult', b.tier)) / base : dmg;
  },
  onBlockHit(ctx, _b, _fx, _bi, blk, _px, _py, _dmg, isPeg) {
    if (isPeg || !ctx.hit.crit) return;
    spawnDrop(ctx, 'coin', centerX(blk), centerY(blk), 0);
  },
  onBlockDestroyed(ctx, b, _fx, _blk, x, y) {
    if (ctx.rng.chance(prm(ctx, 'jackpot', 'fragChance', b.tier))) spawnDrop(ctx, 'fragment', x, y, 0);
    return false;
  },
};

/** Séisme : à chaque rebond sur un bloc, toute sa rangée remonte d'une case là où c'est libre (rowsPerShot fois par balle). */
const quakeOwn: ElementHooks = {
  params: ['rowsPerShot'],
  onBlockHit(ctx, b, fx, _bi, _blk, _px, _py, _dmg, isPeg) {
    const row = fx.hitRow; // rangée avant le recul du choc (parent)
    if (isPeg || row <= 0 || fx.n0 >= Math.round(prm(ctx, 'quake', 'rowsPerShot', b.tier))) return;
    const blocks = ctx.s.blocks;
    let moved = false;
    for (let i = 0; i < blocks.length; i++) {
      const t = blocks[i] as Block;
      if (t.row !== row || t.kind === 'boss' || !isBreakable(t)) continue;
      let free = true;
      for (let c = t.col; c < t.col + t.width && free; c++) {
        for (let j = 0; j < blocks.length; j++) {
          const o = blocks[j] as Block;
          if (o.row === row - 1 && c >= o.col && c < o.col + o.width && (o.kind === 'peg' || o.hp > 0)) {
            free = false;
            break;
          }
        }
      }
      if (!free) continue;
      t.row--;
      moved = true;
    }
    if (!moved) return;
    fx.n0++;
    ctx.gridDirty = true;
  },
};

/** Missile : +accelPct % de vitesse par rebond (plafond maxSpeedMult × vitesse de lancement) ; explose tous les explodeAtBounce rebonds ; la maxExplosions-ième explosion le consume. */
const missileOwn: ElementHooks = {
  params: ['accelPct', 'maxSpeedMult', 'explodeAtBounce', 'explodeRadius', 'explodeMult', 'maxExplosions'],
  onLaunch(_ctx, _b, fx) {
    fx.n1 = fx.speedMult;
  },
  onBounce(ctx, b, fx) {
    fx.n0++;
    const cap = (fx.n1 > 0 ? fx.n1 : 1) * prm(ctx, 'missile', 'maxSpeedMult', b.tier);
    const next = Math.min(cap, fx.speedMult * (1 + prm(ctx, 'missile', 'accelPct', b.tier) / 100));
    if (next > fx.speedMult) {
      fx.speedMult = next;
      fixVelocity(ctx, b, fx);
    }
    const every = Math.round(prm(ctx, 'missile', 'explodeAtBounce', b.tier));
    if (every <= 0 || fx.n0 % every !== 0 || fx.spawned >= prm(ctx, 'missile', 'maxExplosions', b.tier)) return;
    fx.spawned++; // explosions de ce vol (une balle piégée dans une poche n'explose pas sans fin)
    const radius = prm(ctx, 'missile', 'explodeRadius', b.tier) * ctx.relic.bigboom;
    const dmg = ballDamage(ctx, b, null, fx) * prm(ctx, 'missile', 'explodeMult', b.tier);
    if (radius > 0 && dmg > 0) explodeAs(ctx, b, fx, radius, dmg, 'missile');
    // dernière charge : le missile est consommé (une traqueuse piégée dans une poche ne rebondit pas sans fin)
    if (fx.spawned >= prm(ctx, 'missile', 'maxExplosions', b.tier)) b.alive = false;
  },
};

/** Supernova : explosion à chaque palier (rayon `radius`, combo × comboMult, au plus `cap`) ; le cristal n'éclate plus (bonus plafonné à `bounces`). */
const supernovaOwn: ElementHooks = {
  params: ['radius', 'comboMult', 'cap'],
  onBounce(ctx, b, fx) {
    if (fx.bounces < prm(ctx, 'crystal', 'bounces', b.tier)) fx.bounces++;
  },
  onComboMilestone(ctx, b, fx, _level, combo) {
    const radius = prm(ctx, 'supernova', 'radius', b.tier) * ctx.relic.bigboom;
    const dmg = Math.min(combo * prm(ctx, 'supernova', 'comboMult', b.tier) * (ctx.s.internal.shotDamageMult ?? 1), prm(ctx, 'supernova', 'cap', b.tier));
    if (radius <= 0 || dmg <= 0) return;
    explodeAs(ctx, b, fx, radius, dmg, 'supernova');
  },
};

/** Peste : les blocs qu'elle ronge sont contaminés ; à leur mort, healAmount PV (healPerShot par tir) et l'acide gagne `spread` voisins. */
const plagueOwn: ElementHooks = {
  params: ['healPerShot', 'spread', 'healAmount'],
  onBlockHit(ctx, b, _fx, _bi, blk, _px, _py, _dmg, isPeg) {
    if (isPeg || !isBreakable(blk) || acidChargesOf(ctx, blk.id) === 0) return;
    mark(ctx.s.internal.plague, blk.id, b.tier);
  },
  onAnyBlockDestroyed(ctx, blk, x, y) {
    const it = ctx.s.internal;
    const m = it.plague;
    if (!Array.isArray(m)) return;
    let tier = 0;
    for (let k = 0; k + 1 < m.length; k += 2) {
      if (m[k] !== blk.id) continue;
      tier = m[k + 1] as number;
      m[k] = m[m.length - 2] as number;
      m[k + 1] = m[m.length - 1] as number;
      m.length -= 2;
      break;
    }
    if (tier <= 0) return;
    const s = ctx.s;
    if (it.plagueDepth !== s.depth) {
      it.plagueDepth = s.depth;
      it.plagueHeals = 0;
    }
    if (it.plagueHeals < prm(ctx, 'plague', 'healPerShot', tier) && s.hp < s.maxHp) {
      it.plagueHeals++;
      heal(ctx, prm(ctx, 'plague', 'healAmount', tier), 'vampire', x, y);
    }
    spreadAcid(ctx, blk, Math.round(prm(ctx, 'plague', 'spread', tier)), tier, prm(ctx, 'acid', 'capPerTurn', tier), m);
  },
  onShotStart(ctx) {
    const it = ctx.s.internal;
    if (!Array.isArray(it.plague)) it.plague = [];
    pruneMarks(ctx, it.plague, false);
  },
};

/** Chœur : `count` balles en éventail (angle et × dégâts de la jumelle) ; les miroirs repartent du sol une fois (echoRatio). */
const choirOwn: ElementHooks = {
  params: ['count', 'echoRatio'],
  onGrounded(ctx, b) {
    choirEchoFix(ctx, b);
  },
  onLaunch(ctx, b, fx) {
    const n = Math.max(1, Math.round(prm(ctx, 'choir', 'count', b.tier)));
    const mult = prm(ctx, 'twin', 'damageMult', b.tier);
    fx.dmgMult *= mult;
    if (n < 2) return;
    const half = prm(ctx, 'twin', 'angleDeg', b.tier) * DEG;
    const vx = b.vel.x;
    const vy = b.vel.y;
    for (let k = n - 1; k >= 0; k--) {
      const a = half * ((2 * k) / (n - 1) - 1);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const rx = vx * c - vy * sn;
      const ry = vx * sn + vy * c;
      if (k === 0) {
        b.vel.x = rx;
        b.vel.y = ry;
        fixVelocity(ctx, b, fx);
        continue;
      }
      const nb = spawnMini(ctx, b, 'choir', b.pos.x, b.pos.y, rx, ry, mult * rankOf(ctx, 'choir', b.tier), 1);
      if (!nb) continue;
      lastFx(ctx).miniFx = MINI_MIRROR;
      emit(ctx, { type: 'ball:launched', ballId: nb.id, element: nb.element, tier: nb.tier, pos: { x: nb.pos.x, y: nb.pos.y }, golden: false });
    }
    emit(ctx, { type: 'ball:split', pos: { x: b.pos.x, y: b.pos.y }, element: 'choir' });
  },
};

/** Chœur, au sol : la copie d'écho du parent (dernière balle créée) prend la base et le rankMult du chœur. */
function choirEchoFix(ctx: Ctx, b: Ball): void {
  const balls = ctx.s.balls;
  const last = balls[balls.length - 1];
  if (!last || last === b || last.kind !== 'echo' || last.id !== ctx.s.internal.nextId - 1) return;
  lastFx(ctx).dmgMult *= echoBaseRatio(ctx) * rankOf(ctx, 'choir', b.tier);
}

/** Orbite : `returns` allers-retours, ramasse les drops à magnetRadius, +returnBonusPct % de dégâts au retour. */
const orbitOwn: ElementHooks = {
  params: ['returns', 'magnetRadius', 'returnBonusPct'],
  onLaunch(ctx, b, fx) {
    fx.returnsLeft = Math.max(1, Math.round(prm(ctx, 'orbit', 'returns', b.tier)));
  },
  collectRadius(ctx, b) {
    return prm(ctx, 'orbit', 'magnetRadius', b.tier);
  },
  modifyDamage(ctx, b, fx, dmg, target) {
    return target && fx.returning ? dmg * (1 + prm(ctx, 'orbit', 'returnBonusPct', b.tier) / 100) : dmg;
  },
};

/**
 * Marteau : dégâts × damageMult (remplace le × du plomb) ; au premier contact, le bloc perd son armure et
 * pctMaxHp % de ses PV max (au plus `cap`, remplace la rouille) ; puis il remonte d'une rangée (une fois par tir).
 * FG-01 : la perte de PV max n'est PAS réduite par rankMult (appliqué ensuite par la composition à tout le
 * retour de modifyDamage : la perte est donc divisée d'avance par rankMult), et PV ≤ PV max.
 */
const hammerOwn: ElementHooks = {
  params: ['damageMult', 'pctMaxHp', 'cap'],
  modifyDamage(ctx, b, _fx, dmg, target) {
    const d = dmg * prm(ctx, 'hammer', 'damageMult', b.tier);
    if (!target || !isBreakable(target)) return d;
    const rusted = ctx.s.internal.rusted;
    if (rusted.includes(target.id)) return d;
    rusted.push(target.id);
    if (target.kind === 'armored') {
      target.kind = 'normal';
      target.armorSide = 'none';
    }
    const loss = Math.min((prm(ctx, 'hammer', 'pctMaxHp', b.tier) / 100) * target.maxHp, prm(ctx, 'hammer', 'cap', b.tier));
    target.maxHp = Math.max(1, Math.round(target.maxHp - loss));
    if (target.hp > target.maxHp) target.hp = target.maxHp;
    const rm = rankOf(ctx, 'hammer', b.tier);
    return rm > 0 ? d + loss / rm : d;
  },
  onBlockHit(ctx, _b, _fx, _bi, blk, _px, _py, _dmg, isPeg) {
    if (!isPeg) pushBlockUp(ctx, blk, 1);
  },
};

/** Recette et hooks de chaque hybride (l'ordre A/B suit balls.json → recipe). */
export const HYBRIDS: Readonly<Partial<Record<BallElement, ElementHooks>>> = {
  steam: composeHybrid('steam', fire, ice, steamOwn),
  laser: composeHybrid('laser', lightning, prism, laserOwn),
  cluster: composeHybrid('cluster', without(bomb, ['onGrounded']), splitHooks, clusterOwn),
  wraith: composeHybrid('wraith', ghost, pierce, wraithOwn),
  abyss: composeHybrid('abyss', acid, voidHooks, abyssOwn),
  jackpot: composeHybrid('jackpot', gold, lucky, jackpotOwn),
  quake: composeHybrid('quake', giant, shock, quakeOwn),
  missile: composeHybrid('missile', comet, homing, missileOwn),
  supernova: composeHybrid('supernova', without(crystal, ['onBounce']), nova, supernovaOwn),
  plague: composeHybrid('plague', vampire, acid, plagueOwn),
  choir: composeHybrid('choir', without(twin, ['onLaunch']), echo, choirOwn),
  orbit: composeHybrid('orbit', boomerang, magnet, orbitOwn),
  hammer: composeHybrid('hammer', without(lead, ['modifyDamage']), without(rust, ['modifyDamage']), hammerOwn),
};

/** Parents déclarés dans le registre (validés contre balls.json → recipe à createSim). */
export const HYBRID_PARENTS: Readonly<Partial<Record<BallElement, readonly [BallElement, BallElement]>>> = {
  steam: ['fire', 'ice'],
  laser: ['lightning', 'prism'],
  cluster: ['bomb', 'split'],
  wraith: ['ghost', 'pierce'],
  abyss: ['acid', 'void'],
  jackpot: ['gold', 'lucky'],
  quake: ['giant', 'shock'],
  missile: ['comet', 'homing'],
  supernova: ['crystal', 'nova'],
  plague: ['vampire', 'acid'],
  choir: ['twin', 'echo'],
  orbit: ['boomerang', 'magnet'],
  hammer: ['lead', 'rust'],
};
