// sim/volley.ts — volée (inventaire), fusion, lancement de la rafale.
import type { BallElement, BallTier, VolleyBall } from '../core/types';
import type { Ctx } from './ctx';
import { emit } from './ctx';
import { acquireBall } from './pools';

const MAX_TIER = 3;

/** Trie par élément puis rang, puis fusionne les paires adjacentes jusqu'à stabilité. */
export function fuseVolley(ctx: Ctx): void {
  const v = ctx.s.volley;
  for (;;) {
    v.sort(ctx.cmpVolley);
    let fused = -1;
    for (let i = 0; i + 1 < v.length; i++) {
      const a = v[i] as VolleyBall;
      const b = v[i + 1] as VolleyBall;
      if (a.element === b.element && a.tier === b.tier && a.tier < MAX_TIER) {
        a.tier = (a.tier + 1) as BallTier;
        // retrait de i+1 sans splice
        for (let j = i + 1; j + 1 < v.length; j++) v[j] = v[j + 1] as VolleyBall;
        v.pop();
        fused = i;
        ctx.s.stats.fusions++;
        emit(ctx, { type: 'volley:fusion', element: a.element, tier: a.tier, index: i, pos: { x: ctx.s.launchPos.x, y: ctx.s.launchPos.y } });
        break;
      }
    }
    if (fused < 0) return;
  }
}

/** Ajoute une balle à la volée (plafond maxVolley) puis fusionne. */
export function addVolleyBall(ctx: Ctx, element: BallElement, tier: BallTier): boolean {
  if (ctx.s.volley.length >= ctx.cfg.balls.maxVolley) return false;
  ctx.s.volley.push({ element, tier });
  fuseVolley(ctx);
  return true;
}

/** Lance la prochaine balle de la rafale. */
export function launchNext(ctx: Ctx): void {
  const s = ctx.s;
  const it = s.internal;
  const q = it.launchQueue[it.launchQueue.length - s.pendingLaunches];
  s.pendingLaunches--;
  if (!q) return;
  const board = ctx.cfg.blocks.board;
  const b = acquireBall(ctx);
  b.element = q.element;
  b.tier = q.tier;
  b.pos.x = it.originX;
  b.pos.y = board.rows - b.radius;
  b.vel.x = it.dirX * board.ballSpeed;
  b.vel.y = it.dirY * board.ballSpeed;
  if (b.element !== 'lead') {
    b.combo = ctx.relic.bouncy;
    if (it.inheritCombo > 0) {
      b.combo += it.inheritCombo;
      it.inheritCombo = 0;
    }
  }
  if (b.combo > s.currentShotCombo) s.currentShotCombo = b.combo;
  emit(ctx, { type: 'ball:launched', ballId: b.id, element: b.element, tier: b.tier, pos: { x: b.pos.x, y: b.pos.y } });
}
