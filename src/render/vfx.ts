// render/vfx.ts — effets localisés sur le plateau, tous en pools fixes. Pas de secousse d'écran,
// pas de flash plein écran : tout le feedback reste à l'endroit de l'événement.
// - anneaux (explosions), éclairs en zigzag, gerbes de rayons, flashs locaux (blocs, rangée, lancement)
// - état visuel par bloc (squash, flash, cache de la chaîne de PV), alimenté par les événements.

const SQUASH_DUR = 0.12; // s
const MAX_RINGS = 24;
const MAX_BOLTS = 16;
const MAX_FLASHES = 48;
const BOLT_POINTS = 9;
const MAX_RAYS = 3;
const RAY_COUNT = 24;

interface Ring { active: boolean; x: number; y: number; r0: number; r1: number; t: number; dur: number; color: string; width: number; }
interface Bolt { active: boolean; pts: Float32Array; t: number; dur: number; color: string; }
interface Rays { active: boolean; x: number; y: number; t: number; dur: number; color: string; n: number; len: number; ang: Float32Array; }
interface LocalFlash { active: boolean; x: number; y: number; w: number; h: number; t: number; dur: number; color: string; circle: boolean; }

/** État visuel d'un bloc, indexé par blockId. */
export interface BlockFx {
  inUse: boolean;
  id: number;
  /** temps écoulé depuis le dernier impact (s) ; ≥ SQUASH_DUR = pas de squash */
  squashT: number;
  /** temps écoulé depuis le dernier changement de PV (s) : « pop » du libellé */
  popT: number;
  /** temps depuis l'apparition « pop » (s) ; ≥ SPAWN_DUR = pas d'animation */
  spawnT: number;
  /** cache de la chaîne de PV */
  hp: number;
  label: string;
  /** libellé de PV pré-rendu (bitmap), re-dessiné seulement quand hp change */
  labelCanvas: HTMLCanvasElement | null;
  labelDirty: boolean;
  labelLow: boolean;
  /** dernière géométrie dessinée (pour les effets de destruction) */
  x: number; y: number; w: number; kind: number;
  seenFrame: number;
}

export interface Vfx {
  ring(x: number, y: number, r0: number, r1: number, ms: number, color: string, width: number): void;
  bolt(x0: number, y0: number, x1: number, y1: number, ms: number, color: string): void;
  flashRect(x: number, y: number, w: number, h: number, ms: number, color: string): void;
  flashCircle(x: number, y: number, r: number, ms: number, color: string): void;
  /** gerbe de rayons qui partent de (x, y) : palier de combo fort */
  rays(x: number, y: number, ms: number, color: string, count: number, length: number): void;

  /** état visuel par bloc */
  blockFx(id: number): BlockFx;
  peekBlockFx(id: number): BlockFx | undefined;
  releaseBlockFx(id: number): void;
  /**
   * Libère les états de blocs non vus depuis 2 frames. `onVanish` (callback créé une fois, pas par
   * frame) est appelé pour chaque bloc déjà dessiné qui disparaît à cette frame sans événement
   * (rangées effacées par la seconde chance, restart…).
   */
  sweepBlockFx(frame: number, onVanish?: (fx: BlockFx) => void): void;
  /** force le re-rendu des libellés (resize) */
  invalidateLabels(): void;
  squashScale(fx: BlockFx): number;

  update(dt: number): void;
  /** k = px physiques par unité, (ox, oy) = origine du plateau ; laisse le contexte en unités plateau */
  drawWorld(ctx: CanvasRenderingContext2D, k: number, ox: number, oy: number): void;
  clear(): void;
}

export function createVfx(): Vfx {
  const rings: Ring[] = [];
  for (let i = 0; i < MAX_RINGS; i++) rings.push({ active: false, x: 0, y: 0, r0: 0, r1: 1, t: 0, dur: 1, color: '#fff', width: 0.05 });
  const bolts: Bolt[] = [];
  for (let i = 0; i < MAX_BOLTS; i++) bolts.push({ active: false, pts: new Float32Array(BOLT_POINTS * 2), t: 0, dur: 1, color: '#fff' });
  const flashes: LocalFlash[] = [];
  for (let i = 0; i < MAX_FLASHES; i++) flashes.push({ active: false, x: 0, y: 0, w: 0, h: 0, t: 0, dur: 1, color: '#fff', circle: false });

  const rays: Rays[] = [];
  for (let i = 0; i < MAX_RAYS; i++) rays.push({ active: false, x: 0, y: 0, t: 0, dur: 1, color: '#fff', n: 0, len: 1, ang: new Float32Array(RAY_COUNT) });

  const fxPool: BlockFx[] = [];
  const fxMap = new Map<number, BlockFx>();
  let lastFrame = 0;
  function newFx(): BlockFx {
    return { inUse: false, id: -1, squashT: SQUASH_DUR, popT: 1, spawnT: 1, hp: Number.NaN, label: '', labelCanvas: null, labelDirty: true, labelLow: false, x: 0, y: 0, w: 1, kind: 0, seenFrame: 0 };
  }
  for (let i = 0; i < 128; i++) fxPool.push(newFx());

  function freeSlot<T extends { active: boolean; t: number; dur: number }>(arr: T[]): T {
    let best = arr[0]!;
    let bestRem = Infinity;
    for (const it of arr) {
      if (!it.active) return it;
      const rem = it.dur - it.t;
      if (rem < bestRem) { bestRem = rem; best = it; }
    }
    return best;
  }

  const api: Vfx = {
    ring(x, y, r0, r1, ms, color, width) {
      const r = freeSlot(rings);
      r.active = true; r.x = x; r.y = y; r.r0 = r0; r.r1 = r1; r.t = 0; r.dur = ms / 1000; r.color = color; r.width = width;
    },
    bolt(x0, y0, x1, y1, ms, color) {
      const b = freeSlot(bolts);
      b.active = true; b.t = 0; b.dur = ms / 1000; b.color = color;
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const jag = Math.min(0.22, len * 0.12);
      for (let i = 0; i < BOLT_POINTS; i++) {
        const t = i / (BOLT_POINTS - 1);
        const j = i === 0 || i === BOLT_POINTS - 1 ? 0 : (Math.random() * 2 - 1) * jag;
        b.pts[i * 2] = x0 + dx * t + nx * j;
        b.pts[i * 2 + 1] = y0 + dy * t + ny * j;
      }
    },
    flashRect(x, y, w, h, ms, color) {
      const f = freeSlot(flashes);
      f.active = true; f.x = x; f.y = y; f.w = w; f.h = h; f.t = 0; f.dur = ms / 1000; f.color = color; f.circle = false;
    },
    flashCircle(x, y, r, ms, color) {
      const f = freeSlot(flashes);
      f.active = true; f.x = x; f.y = y; f.w = r; f.h = r; f.t = 0; f.dur = ms / 1000; f.color = color; f.circle = true;
    },

    rays(x, y, ms, color, count, length) {
      const r = freeSlot(rays);
      r.active = true; r.x = x; r.y = y; r.t = 0; r.dur = ms / 1000; r.color = color;
      r.n = count > RAY_COUNT ? RAY_COUNT : count; r.len = length;
      const off = Math.random() * Math.PI * 2;
      for (let i = 0; i < r.n; i++) r.ang[i] = off + (i / r.n) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
    },

    blockFx(id) {
      let fx = fxMap.get(id);
      if (fx) return fx;
      for (let i = 0; i < fxPool.length; i++) { const f = fxPool[i]!; if (!f.inUse) { fx = f; break; } }
      if (!fx) { fx = newFx(); fxPool.push(fx); } // rare : plus de 128 blocs vivants
      fx.inUse = true; fx.id = id; fx.squashT = SQUASH_DUR; fx.popT = 1; fx.spawnT = 1; fx.hp = Number.NaN; fx.label = ''; fx.labelDirty = true; fx.seenFrame = lastFrame;
      fxMap.set(id, fx);
      return fx;
    },
    peekBlockFx(id) { return fxMap.get(id); },
    releaseBlockFx(id) {
      const fx = fxMap.get(id);
      if (!fx) return;
      fx.inUse = false;
      fxMap.delete(id);
    },
    sweepBlockFx(frame, onVanish) {
      // blocs disparus sans événement (restart, reprise) : libérés après 2 frames non vus
      lastFrame = frame;
      for (let i = 0; i < fxPool.length; i++) {
        const f = fxPool[i]!;
        if (!f.inUse) continue;
        if (onVanish && f.seenFrame === frame - 1 && !Number.isNaN(f.hp)) onVanish(f);
        if (frame - f.seenFrame > 2) { f.inUse = false; fxMap.delete(f.id); }
      }
    },
    invalidateLabels() {
      for (let i = 0; i < fxPool.length; i++) fxPool[i]!.labelDirty = true;
    },
    squashScale(fx) {
      const t = fx.squashT / SQUASH_DUR;
      if (t >= 1) return 1;
      // 1 → 1,15 → 1 : montée rapide (30 %) puis retour easeOutCubic
      if (t < 0.3) return 1 + 0.15 * (t / 0.3);
      const u = (t - 0.3) / 0.7;
      return 1 + 0.15 * (1 - u) * (1 - u) * (1 - u);
    },

    update(dt) {
      for (let i = 0; i < MAX_RINGS; i++) { const r = rings[i]!; if (r.active && (r.t += dt) >= r.dur) r.active = false; }
      for (let i = 0; i < MAX_BOLTS; i++) { const b = bolts[i]!; if (b.active && (b.t += dt) >= b.dur) b.active = false; }
      for (let i = 0; i < MAX_FLASHES; i++) { const f = flashes[i]!; if (f.active && (f.t += dt) >= f.dur) f.active = false; }
      for (let i = 0; i < fxPool.length; i++) { const f = fxPool[i]!; if (f.inUse) { if (f.squashT < SQUASH_DUR) f.squashT += dt; if (f.popT < 1) f.popT += dt; if (f.spawnT < 1) f.spawnT += dt; } }
      for (let i = 0; i < MAX_RAYS; i++) { const r = rays[i]!; if (r.active && (r.t += dt) >= r.dur) r.active = false; }
    },

    drawWorld(ctx, k, ox, oy) {
      // flashs rectangulaires en pixels entiers (chemin rapide), le reste en unités plateau
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (let i = 0; i < MAX_FLASHES; i++) {
        const f = flashes[i]!;
        if (!f.active || f.circle) continue;
        ctx.globalAlpha = 1 - f.t / f.dur;
        ctx.fillStyle = f.color;
        const x0 = Math.round(ox + f.x * k), y0 = Math.round(oy + f.y * k);
        ctx.fillRect(x0, y0, Math.round(ox + (f.x + f.w) * k) - x0, Math.round(oy + (f.y + f.h) * k) - y0);
      }
      ctx.setTransform(k, 0, 0, k, ox, oy);
      for (let i = 0; i < MAX_FLASHES; i++) {
        const f = flashes[i]!;
        if (!f.active || !f.circle) continue;
        ctx.globalAlpha = 1 - f.t / f.dur;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.w * (0.6 + 0.4 * (f.t / f.dur)), 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < MAX_RINGS; i++) {
        const r = rings[i]!;
        if (!r.active) continue;
        const t = r.t / r.dur;
        const e = 1 - (1 - t) * (1 - t) * (1 - t);
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width * (1 - 0.6 * t);
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.lineCap = 'round';
      for (let j = 0; j < MAX_RAYS; j++) {
        const r = rays[j]!;
        if (!r.active) continue;
        const t = r.t / r.dur;
        const e = 1 - (1 - t) * (1 - t) * (1 - t);
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 0.06 * (1 - t) + 0.01;
        ctx.beginPath();
        for (let i = 0; i < r.n; i++) {
          const a = r.ang[i]!;
          const ca = Math.cos(a), sa = Math.sin(a);
          const r0 = 0.3 + r.len * e * 0.55, r1 = 0.3 + r.len * e;
          ctx.moveTo(r.x + ca * r0, r.y + sa * r0);
          ctx.lineTo(r.x + ca * r1, r.y + sa * r1);
        }
        ctx.stroke();
      }
      ctx.lineJoin = 'round';
      for (let j = 0; j < MAX_BOLTS; j++) {
        const b = bolts[j]!;
        if (!b.active) continue;
        const a = 1 - b.t / b.dur;
        for (let pass = 0; pass < 2; pass++) {
          ctx.globalAlpha = pass === 0 ? a * 0.45 : a;
          ctx.strokeStyle = pass === 0 ? b.color : '#ffffff';
          ctx.lineWidth = pass === 0 ? 0.11 : 0.035;
          ctx.beginPath();
          ctx.moveTo(b.pts[0]!, b.pts[1]!);
          for (let i = 1; i < BOLT_POINTS; i++) ctx.lineTo(b.pts[i * 2]!, b.pts[i * 2 + 1]!);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    },

    clear() {
      for (const r of rings) r.active = false;
      for (const b of bolts) b.active = false;
      for (const f of flashes) f.active = false;
      for (const r of rays) r.active = false;
    },
  };
  return api;
}
