// core/math.ts — propriétaire : architecte.
import type { Vec2 } from './types';

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const len = (v: Vec2): number => Math.hypot(v.x, v.y);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const normalize = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: -1 };
};
/** Réflexion de v sur une normale unitaire n. */
export const reflect = (v: Vec2, n: Vec2): Vec2 => {
  const d = 2 * (v.x * n.x + v.y * n.y);
  return { x: v.x - d * n.x, y: v.y - d * n.y };
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
