// render/particles.ts — pool fixe de particules (512). Avance avec le dt réel :
// les particules continuent de bouger pendant un hit-stop.

export const MAX_PARTICLES = 512;

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
  /** densité (1 = normal, 0,5 = reduceMotion) */
  density: number;
  /** n particules en éventail autour de l'angle `dir` (±spread rad), vitesses en u/s, vie en s */
  burst(
    x: number, y: number, n: number, color: string, shape: number,
    speedMin: number, speedMax: number, dir: number, spread: number,
    lifeMin: number, lifeMax: number, sizeMin: number, sizeMax: number, gravity: number,
  ): void;
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
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
    density: 1,
    burst(x, y, n, color, shape, speedMin, speedMax, dir, spread, lifeMin, lifeMax, sizeMin, sizeMax, gravity) {
      // densité fractionnaire : on accumule le reste pour rester juste en moyenne
      const want = n * api.density + carry;
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
    draw(ctx) {
      // contexte en unités plateau
      let lastColor = '';
      for (let i = 0; i < live; i++) {
        const p = pool[i]!;
        const t = p.life / p.max;
        if (p.color !== lastColor) { ctx.fillStyle = p.color; lastColor = p.color; }
        ctx.globalAlpha = t < 0.5 ? t * 2 : 1;
        const s = p.size * (0.4 + 0.6 * t);
        if (p.shape === P_SPARK) {
          // trait étiré dans le sens du mouvement (approx. par un carré allongé axe-aligné)
          const ex = p.vx * 0.012, ey = p.vy * 0.012;
          ctx.fillRect(p.x - s * 0.5 - (ex < 0 ? -ex : 0), p.y - s * 0.5 - (ey < 0 ? -ey : 0), s + (ex < 0 ? -ex : ex), s + (ey < 0 ? -ey : ey));
        } else if (p.shape === P_SHARD) {
          ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
        } else {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - s);
          ctx.lineTo(p.x + s * 0.5, p.y);
          ctx.lineTo(p.x, p.y + s);
          ctx.lineTo(p.x - s * 0.5, p.y);
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
