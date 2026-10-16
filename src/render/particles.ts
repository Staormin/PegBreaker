// render/particles.ts — pool fixe de particules (1024, budget par priorité). Avance avec le dt réel.

export const MAX_PARTICLES = 1024;

/**
 * Priorité d'émission (J2-03). Quand le pool se remplit, on réduit d'abord le décor :
 * - PRIO_LOW (étincelles de rebond, ambiance) : ×1/2 au-delà de 50 %, ×1/4 au-delà de 70 %, rien au-delà de 85 % ;
 * - PRIO_NORMAL : ×1/2 au-delà de 70 %, ×1/4 au-delà de 85 % ;
 * - PRIO_HIGH (combo 3, boss, explosions) : jamais réduit (seulement borné par la capacité).
 */
/**
 * Densité de base : les nombres de particules passés à burst() sont des « intentions » ; le rendu
 * en émet 45 % (choix produit : feedback sobre, lisible, sans surcharge).
 */
const DENSITY = 0.45;

export const PRIO_LOW = 0;
export const PRIO_NORMAL = 1;
export const PRIO_HIGH = 2;

/** forme : étincelle (trait court dans le sens de la vitesse), éclat (carré), cristal (losange) */
export const P_SPARK = 0;
export const P_SHARD = 1;
export const P_CRYSTAL = 2;

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; gravity: number; drag: number;
  shape: number; color: string;
}

export interface Particles {
  readonly count: number;
  /** n particules en éventail autour de l'angle `dir` (±spread rad), vitesses en u/s, vie en s */
  burst(
    x: number, y: number, n: number, color: string, shape: number,
    speedMin: number, speedMax: number, dir: number, spread: number,
    lifeMin: number, lifeMax: number, sizeMin: number, sizeMax: number, gravity: number,
    prio?: number,
  ): void;
  update(dt: number): void;
  /** contexte en transform identité ; k = px physiques par unité, (ox, oy) = origine du plateau */
  draw(ctx: CanvasRenderingContext2D, k: number, ox: number, oy: number): void;
  clear(): void;
}

export function createParticles(): Particles {
  const pool: Particle[] = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 0.05, gravity: 0, drag: 0, shape: 0, color: '#fff' });
  }
  let live = 0;
  let carry = 0;

  const api: Particles = {
    get count() { return live; },
    burst(x, y, n, color, shape, speedMin, speedMax, dir, spread, lifeMin, lifeMax, sizeMin, sizeMax, gravity, prio = PRIO_NORMAL) {
      // budget dégressif selon le remplissage du pool
      const fill = live / MAX_PARTICLES;
      let budget = 1;
      if (prio === PRIO_LOW) budget = fill > 0.85 ? 0 : fill > 0.7 ? 0.25 : fill > 0.5 ? 0.5 : 1;
      else if (prio === PRIO_NORMAL) budget = fill > 0.85 ? 0.25 : fill > 0.7 ? 0.5 : 1;
      if (budget === 0) return;
      // densité fractionnaire : on accumule le reste pour rester juste en moyenne
      const want = n * DENSITY * budget + carry;
      const count = Math.floor(want);
      carry = want - count;
      for (let i = 0; i < count && live < MAX_PARTICLES; i++) {
        const p = pool[live++]!;
        const a = dir + (Math.random() * 2 - 1) * spread;
        const s = speedMin + Math.random() * (speedMax - speedMin);
        p.x = x; p.y = y;
        p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
        p.life = p.max = lifeMin + Math.random() * (lifeMax - lifeMin);
        p.size = sizeMin + Math.random() * (sizeMax - sizeMin);
        p.gravity = gravity;
        p.drag = shape === P_SPARK ? 6 : 2.5;
        p.shape = shape;
        p.color = color;
      }
    },
    update(dt) {
      let i = 0;
      while (i < live) {
        const p = pool[i]!;
        p.life -= dt;
        if (p.life <= 0) {
          // swap-remove sans splice
          live--;
          pool[i] = pool[live]!;
          pool[live] = p;
          continue;
        }
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vy = p.vy * k + p.gravity * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        i++;
      }
    },
    draw(ctx, k, ox, oy) {
      // contexte en transform identité : rectangles arrondis aux pixels physiques
      // (fillRect entier = chemin rapide, sans anti-aliasing)
      let lastColor = '';
      for (let i = 0; i < live; i++) {
        const p = pool[i]!;
        const t = p.life / p.max;
        if (p.color !== lastColor) { ctx.fillStyle = p.color; lastColor = p.color; }
        ctx.globalAlpha = t < 0.5 ? t * 2 : 1;
        const s = p.size * (0.4 + 0.6 * t) * k;
        const cx = ox + p.x * k, cy = oy + p.y * k;
        if (p.shape === P_SPARK) {
          // trait étiré dans le sens du mouvement
          const ex = p.vx * 0.012 * k, ey = p.vy * 0.012 * k;
          const ax = ex < 0 ? -ex : ex, ay = ey < 0 ? -ey : ey;
          const w = Math.round(s + ax), h = Math.round(s + ay);
          ctx.fillRect(Math.round(cx - s * 0.5 - (ex < 0 ? ax : 0)), Math.round(cy - s * 0.5 - (ey < 0 ? ay : 0)), w < 1 ? 1 : w, h < 1 ? 1 : h);
        } else if (p.shape === P_SHARD) {
          const w = Math.round(s);
          ctx.fillRect(Math.round(cx - s * 0.5), Math.round(cy - s * 0.5), w < 1 ? 1 : w, w < 1 ? 1 : w);
        } else {
          ctx.beginPath();
          ctx.moveTo(cx, cy - s);
          ctx.lineTo(cx + s * 0.5, cy);
          ctx.lineTo(cx, cy + s);
          ctx.lineTo(cx - s * 0.5, cy);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
    clear() { live = 0; },
  };
  return api;
}
