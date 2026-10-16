// render/damageNumbers.ts — nombres de dégâts flottants, pool de 64.
// Cumul : un coup qui tombe au même endroit < 100 ms après le précédent grossit le même nombre.
import type { Layout } from './layout';
import { PALETTE } from './palette';

export const MAX_NUMBERS = 64;
const RISE = 0.6; // unités plateau
const LIFE = 0.6; // s
const RISE_T = 0.6; // s (durée de la montée, easeOutCubic)
const FADE = 0.45; // s (fin de vie, linéaire)
const MERGE_WINDOW = 0.1; // s
const MERGE_DIST2 = 0.35 * 0.35;
const POP = 0.12; // s
export const FONT_BUCKETS = 12;

interface DamageNumber {
  active: boolean;
  x: number; y: number;
  value: number;
  label: string;
  age: number; life: number; sinceHit: number;
  bucket: number;
  color: string;
  blockId: number;
}

export interface DamageNumbers {
  /** id de bloc −1 = pas de fusion par bloc (étiquettes de combo) */
  add(x: number, y: number, value: number, crit: boolean, blockId: number): void;
  addLabel(x: number, y: number, label: string, color: string, bucket: number): void;
  update(dt: number): void;
  /** contexte en pixels physiques (transform = dpr + shake) ; l = layout courant */
  draw(ctx: CanvasRenderingContext2D, l: Layout, shakeX: number, shakeY: number): void;
  rebuildFonts(l: Layout): void;
  clear(): void;
  readonly count: number;
}

export function formatNumber(v: number): string {
  const n = Math.round(v);
  if (n < 10000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e5 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

function bucketFor(value: number, crit: boolean): number {
  const b = Math.round(Math.log10(Math.max(1, value)) * 2.2) + (crit ? 3 : 0);
  return b < 0 ? 0 : b > FONT_BUCKETS - 1 ? FONT_BUCKETS - 1 : b;
}

export function createDamageNumbers(): DamageNumbers {
  const pool: DamageNumber[] = [];
  for (let i = 0; i < MAX_NUMBERS; i++) {
    pool.push({ active: false, x: 0, y: 0, value: 0, label: '', age: 0, life: 0, sinceHit: 0, bucket: 0, color: '#fff', blockId: -1 });
  }
  const fonts: string[] = [];
  let live = 0;

  function acquire(): DamageNumber {
    let oldest: DamageNumber = pool[0]!;
    for (const n of pool) {
      if (!n.active) return n;
      if (n.age > oldest.age) oldest = n;
    }
    return oldest; // pool plein : on recycle le plus ancien
  }

  return {
    get count() { return live; },
    rebuildFonts(l) {
      fonts.length = 0;
      const base = l.scale * l.dpr;
      for (let i = 0; i < FONT_BUCKETS; i++) {
        fonts.push(`800 ${Math.max(8, Math.round(base * (0.28 + 0.055 * i)))}px system-ui, -apple-system, "Segoe UI", sans-serif`);
      }
    },
    add(x, y, value, crit, blockId) {
      // cumul
      for (const n of pool) {
        if (!n.active || n.sinceHit > MERGE_WINDOW) continue;
        const dx = n.x - x, dy = n.y - y;
        if ((blockId >= 0 && n.blockId === blockId) || dx * dx + dy * dy < MERGE_DIST2) {
          n.value += value;
          n.label = formatNumber(n.value);
          n.sinceHit = 0;
          n.life = Math.max(n.life, n.age + LIFE);
          const b = bucketFor(n.value, crit);
          if (b > n.bucket) n.bucket = b;
          if (crit) n.color = PALETTE.accent;
          return;
        }
      }
      const n = acquire();
      n.active = true;
      n.x = x + (Math.random() - 0.5) * 0.15; n.y = y;
      n.value = value; n.label = formatNumber(value);
      n.age = 0; n.life = LIFE; n.sinceHit = 0;
      n.bucket = bucketFor(value, crit);
      n.color = crit ? PALETTE.accent : PALETTE.text;
      n.blockId = blockId;
    },
    addLabel(x, y, label, color, bucket) {
      const n = acquire();
      n.active = true;
      n.x = x; n.y = y; n.value = 0; n.label = label;
      n.age = 0; n.life = LIFE; n.sinceHit = 1;
      n.bucket = bucket < 0 ? 0 : bucket > FONT_BUCKETS - 1 ? FONT_BUCKETS - 1 : bucket;
      n.color = color; n.blockId = -1;
    },
    update(dt) {
      live = 0;
      for (let i = 0; i < MAX_NUMBERS; i++) {
        const n = pool[i]!;
        if (!n.active) continue;
        n.age += dt; n.sinceHit += dt;
        if (n.age >= n.life) { n.active = false; continue; }
        live++;
      }
    },
    draw(ctx, l, shakeX, shakeY) {
      if (live === 0) return;
      const k = l.scale * l.dpr;
      const ox = (l.offX + shakeX) * l.dpr, oy = (l.offY + shakeY) * l.dpr;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = PALETTE.outline;
      ctx.lineWidth = 3 * l.dpr;
      let lastBucket = -1;
      for (let i = 0; i < MAX_NUMBERS; i++) {
        const n = pool[i]!;
        if (!n.active) continue;
        const t = n.age / RISE_T;
        const e = t >= 1 ? 1 : 1 - (1 - t) * (1 - t) * (1 - t);
        const y = n.y - RISE * e;
        const rem = n.life - n.age;
        const alpha = rem < FADE ? rem / FADE : 1;
        const pop = n.sinceHit < POP ? 1 + 0.4 * (1 - n.sinceHit / POP) : 1;
        if (n.bucket !== lastBucket) { ctx.font = fonts[n.bucket] ?? '16px sans-serif'; lastBucket = n.bucket; }
        ctx.globalAlpha = alpha;
        ctx.setTransform(pop, 0, 0, pop, ox + n.x * k, oy + y * k);
        ctx.strokeText(n.label, 0, 0);
        ctx.fillStyle = n.color;
        ctx.fillText(n.label, 0, 0);
      }
      ctx.globalAlpha = 1;
    },
    clear() {
      for (const n of pool) n.active = false;
      live = 0;
    },
  };
}
