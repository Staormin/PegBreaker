// sim/volley.ts — volée (inventaire), fusion, lancement de la rafale.
import type { BallElement, BallTier, VolleyBall } from '../core/types';
import type { Ctx } from './ctx';
import { emit } from './ctx';
import { acquireBall } from './pools';
import { contractMax } from './contracts';
import { modElement } from './mods';
import type { BallFx } from './state';
import { elementHooks } from './elements/index';

const MAX_TIER = 3;

/**
 * Trie la volée par élément puis rang. La fusion n'est plus automatique (c'est une carte de récompense),
 * SAUF au plafond : tant que volley.length >= maxVolley, fusionne une paire à la fois (rang le plus bas d'abord).
 */
export function fuseVolley(ctx: Ctx): void {
  const v = ctx.s.volley;
  v.sort(ctx.cmpVolley);
  while (v.length >= ctx.cfg.balls.maxVolley) {
    let best = -1;
    for (let i = 0; i + 1 < v.length; i++) {
      const a = v[i] as VolleyBall;
      const b = v[i + 1] as VolleyBall;
      if (a.element === b.element && a.tier === b.tier && a.tier < MAX_TIER && (best < 0 || a.tier < (v[best] as VolleyBall).tier)) best = i;
    }
    if (best < 0) return;
    const a = v[best] as VolleyBall;
    fusePair(ctx, a.element, (a.tier + 1) as BallTier);
  }
}

/** Index de la première paire fusionnable (même élément, même rang < 3) du rang le plus élevé, -1 sinon. Volée triée. */
export function bestFusablePair(ctx: Ctx): number {
  const v = ctx.s.volley;
  v.sort(ctx.cmpVolley);
  let best = -1;
  for (let i = 0; i + 1 < v.length; i++) {
    const a = v[i] as VolleyBall;
    const b = v[i + 1] as VolleyBall;
    if (a.element === b.element && a.tier === b.tier && a.tier < MAX_TIER && (best < 0 || a.tier > (v[best] as VolleyBall).tier)) best = i;
  }
  return best;
}

/**
 * Retire deux balles (element, tier-1) et ajoute une (element, tier). Émet volley:fusion.
 * Renvoie faux (sans rien changer) si la paire n'existe pas.
 */
export function fusePair(ctx: Ctx, element: BallElement, tier: BallTier): boolean {
  const v = ctx.s.volley;
  if (tier <= 1 || tier > MAX_TIER) return false;
  const from = tier - 1;
  let first = -1;
  let second = -1;
  for (let i = 0; i < v.length; i++) {
    const b = v[i] as VolleyBall;
    if (b.element !== element || b.tier !== from) continue;
    if (first < 0) first = i;
    else {
      second = i;
      break;
    }
  }
  if (second < 0) return false;
  const fused: VolleyBall = { element, tier }; // nouvel objet : jamais de mutation d'une entrée partagée
  v[first] = fused;
  for (let j = second; j + 1 < v.length; j++) v[j] = v[j + 1] as VolleyBall;
  v.pop();
  v.sort(ctx.cmpVolley);
  const index = v.indexOf(fused);
  ctx.s.stats.fusions++;
  emit(ctx, { type: 'volley:fusion', element, tier, index, pos: { x: ctx.s.launchPos.x, y: ctx.s.launchPos.y } });
  return true;
}

/** Ajoute une balle à la volée (au plafond : fusion d'une paire pour faire de la place, sinon refus). */
export function addVolleyBall(ctx: Ctx, element: BallElement, tier: BallTier): boolean {
  if (ctx.s.volley.length >= ctx.cfg.balls.maxVolley) fuseVolley(ctx);
  if (ctx.s.volley.length >= ctx.cfg.balls.maxVolley) return false;
  ctx.s.volley.push({ element: modElement(ctx.mods, element), tier });
  fuseVolley(ctx);
  return true;
}

/**
 * Lance la prochaine balle de la rafale (launchQueue est déjà dans l'ordre de départ, launchDirs aligné).
 * La dernière balle lancée est dorée.
 */
export function launchNext(ctx: Ctx): void {
  const s = ctx.s;
  const it = s.internal;
  const k = it.launchQueue.length - s.pendingLaunches;
  const q = it.launchQueue[k];
  s.pendingLaunches--;
  if (!q) return;
  const dirs = it.launchDirs;
  const dx = dirs && dirs.length >= 2 * k + 2 ? (dirs[2 * k] as number) : it.dirX;
  const dy = dirs && dirs.length >= 2 * k + 2 ? (dirs[2 * k + 1] as number) : it.dirY;
  const board = ctx.cfg.blocks.board;
  const b = acquireBall(ctx);
  const fx = it.bfx[s.balls.length - 1] as BallFx;
  b.element = q.element;
  b.tier = q.tier;
  fx.dirX = dx;
  fx.dirY = dy;
  const H = elementHooks(b.element);
  if (H.modifyBall) H.modifyBall(ctx, b, fx); // géante, comète : rayon / vitesse
  b.pos.x = it.originX;
  b.pos.y = board.rows - b.radius;
  if (fx.speedMult === 1) {
    b.vel.x = dx * ctx.ballSpeed;
    b.vel.y = dy * ctx.ballSpeed;
  } else {
    b.vel.x = dx * ctx.ballSpeed * fx.speedMult;
    b.vel.y = dy * ctx.ballSpeed * fx.speedMult;
  }
  b.golden = s.pendingLaunches === 0;
  if (!H.noCombo) {
    b.combo = ctx.relic.bouncy;
    if (it.inheritCombo > 0) {
      b.combo += it.inheritCombo;
      it.inheritCombo = 0;
    }
  }
  if (b.combo > s.currentShotCombo) s.currentShotCombo = b.combo;
  contractMax(ctx, 'reachCombo', b.combo);
  emit(ctx, { type: 'ball:launched', ballId: b.id, element: b.element, tier: b.tier, pos: { x: b.pos.x, y: b.pos.y }, golden: b.golden });
  if (H.onLaunch) H.onLaunch(ctx, b, fx); // jumelle : balles supplémentaires ; perforante, boomerang : compteurs
}
