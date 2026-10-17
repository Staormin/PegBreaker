// sim/elements/tricky.ts — famille « tricky » : fantôme (d'origine), perforante, écho, boomerang, traqueuse.
import { emit } from '../ctx';
import { fixVelocity, groundBall } from '../physics';
import type { ElementHooks } from './types';
import { DEG, centerX, centerY, lastFx, nearestBreakable, prm, spawnMini } from './common';

/** Fantôme : traverse les blocs (impact à l'entrée), rebondit sur les murs ; spectre : combo par traversée. */
export const ghost: ElementHooks = {
  passThrough: true,
};

/** Perforante : traverse les `pierces` premiers blocs touchés du tir (dégâts × damageMult), puis rebondit. */
export const pierce: ElementHooks = {
  params: ['pierces', 'damageMult'],
  onLaunch(ctx, b, fx) {
    fx.pierceLeft = Math.max(0, Math.round(prm(ctx, 'pierce', 'pierces', b.tier)));
  },
  modifyDamage(ctx, b, _fx, dmg, target) {
    return target && !ctx.hit.bounced ? dmg * prm(ctx, 'pierce', 'damageMult', b.tier) : dmg;
  },
};

/**
 * Écho : au sol, une copie (mini-balle « écho », traversante comme un fantôme, dégâts × ratio) repart du point
 * de contact avec la vitesse miroir verticale. Une seule fois : la copie n'a pas de hooks.
 */
export const echo: ElementHooks = {
  params: ['ratio'],
  onGrounded(ctx, b) {
    const nb = spawnMini(ctx, b, 'echo', b.pos.x, b.pos.y, b.vel.x, -Math.abs(b.vel.y), prm(ctx, 'echo', 'ratio', b.tier), 1);
    if (!nb) return;
    lastFx(ctx).pass = true;
    emit(ctx, { type: 'ball:launched', ballId: nb.id, element: nb.element, tier: nb.tier, pos: { x: nb.pos.x, y: nb.pos.y }, golden: false });
  },
};

/**
 * Boomerang : après afterMs de vol, revient vers le point de lancement (traversant, en frappant au passage) ;
 * à l'arrivée (distance < rayon) : repart pour l'aller suivant tant qu'il reste des allers-retours, sinon se pose.
 */
export const boomerang: ElementHooks = {
  params: ['returns', 'afterMs'],
  onLaunch(ctx, b, fx) {
    fx.returnsLeft = Math.max(1, Math.round(prm(ctx, 'boomerang', 'returns', b.tier)));
    fx.flightMs = 0;
  },
  onTick(ctx, b, fx, dtMs) {
    if (!fx.returning) {
      fx.flightMs += dtMs;
      if (fx.flightMs < prm(ctx, 'boomerang', 'afterMs', b.tier)) return;
      fx.returning = true;
      fx.pass = true;
    }
    const rows = ctx.cfg.blocks.board.rows;
    const tx = ctx.s.internal.originX;
    const ty = rows - b.radius;
    const dx = tx - b.pos.x;
    const dy = ty - b.pos.y;
    const d = Math.hypot(dx, dy);
    const sp = ctx.ballSpeed * fx.speedMult;
    if (d >= b.radius) {
      b.vel.x = (dx / d) * sp;
      b.vel.y = (dy / d) * sp;
      return;
    }
    // arrivée
    b.pos.x = tx;
    b.pos.y = ty;
    fx.returnsLeft--;
    fx.returning = false;
    fx.pass = false;
    if (fx.returnsLeft > 0) {
      fx.flightMs = 0;
      b.vel.x = fx.dirX * sp;
      b.vel.y = fx.dirY * sp;
      fixVelocity(ctx, b, fx);
      emit(ctx, { type: 'ball:bounce', ballId: b.id, pos: { x: tx, y: rows }, normal: { x: 0, y: -1 }, surface: 'wall', combo: b.combo });
    } else groundBall(ctx, b, fx);
  },
};

/** Traqueuse : après chaque rebond, la vitesse tourne d'au plus maxDeg (angle minimal compris) vers le bloc cassable le plus proche. */
export const homing: ElementHooks = {
  params: ['maxDeg'],
  onBounce(ctx, b, fx, _surface, nx, ny, bi) {
    const j = nearestBreakable(ctx, b.pos.x, b.pos.y, bi);
    const t = j >= 0 ? ctx.s.blocks[j] : undefined;
    if (!t) return;
    const max = prm(ctx, 'homing', 'maxDeg', b.tier) * DEG;
    if (max <= 0) return;
    const want = Math.atan2(centerY(t) - b.pos.y, centerX(t) - b.pos.x);
    let da = want - Math.atan2(b.vel.y, b.vel.x);
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    if (da > max) da = max;
    else if (da < -max) da = -max;
    const c = Math.cos(da);
    const sn = Math.sin(da);
    const vx = b.vel.x * c - b.vel.y * sn;
    const vy = b.vel.x * sn + b.vel.y * c;
    if (vx * nx + vy * ny <= 0) return; // ne repart jamais dans la surface rebondie
    const ox = b.vel.x;
    const oy = b.vel.y;
    b.vel.x = vx;
    b.vel.y = vy;
    fixVelocity(ctx, b, fx);
    // l'angle minimal peut ajouter jusqu'à minAimAngleDeg : borne totale respectée, sinon pas de déviation (QA 38° pour 30°)
    const dot = (b.vel.x * ox + b.vel.y * oy) / (Math.hypot(b.vel.x, b.vel.y) * Math.hypot(ox, oy));
    if (Math.acos(Math.min(1, Math.max(-1, dot))) > max + 1e-9) {
      b.vel.x = ox;
      b.vel.y = oy;
    }
  },
};
