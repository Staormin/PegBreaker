// render/vfx.ts — effets d'écran et effets localisés, tous en pools fixes.
// - shake (décroissance exponentielle, plafonné à 10 px, coupé par setShake(false)/reduceMotion)
// - flash plein écran, vignette, bords rouges (coupés/atténués par reduceMotion)
// - anneaux (explosions), éclairs en zigzag, flashs locaux (blocs, lancement)
// - état visuel par bloc (squash, flash, cache de la chaîne de PV), alimenté par les événements.

export const SHAKE_CAP = 10; // px CSS
const SHAKE_TAU = 0.075; // s (constante de décroissance)
const SQUASH_DUR = 0.12; // s
const MAX_RINGS = 24;
const MAX_BOLTS = 16;
const MAX_FLASHES = 48;
const BOLT_POINTS = 9;

interface Ring { active: boolean; x: number; y: number; r0: number; r1: number; t: number; dur: number; color: string; width: number; }
interface Bolt { active: boolean; pts: Float32Array; t: number; dur: number; color: string; }
interface LocalFlash { active: boolean; x: number; y: number; w: number; h: number; t: number; dur: number; color: string; circle: boolean; }

/** État visuel d'un bloc, indexé par blockId. */
export interface BlockFx {
  inUse: boolean;
  id: number;
  /** temps écoulé depuis le dernier impact (s) ; ≥ SQUASH_DUR = pas de squash */
  squashT: number;
  /** cache de la chaîne de PV */
  hp: number;
  label: string;
  /** dernière géométrie dessinée (pour les effets de destruction) */
  x: number; y: number; w: number; kind: number;
  seenFrame: number;
}

export interface Vfx {
  shakeEnabled: boolean;
  reduceMotion: boolean;
  /** offset de shake courant (px CSS) */
  shakeX: number;
  shakeY: number;
  addShake(px: number): void;
  tremble(ms: number, px: number): void;
  screenFlash(alpha: number, color: string): void;
  vignette(ms: number): void;
  redEdges(ms: number): void;
  ring(x: number, y: number, r0: number, r1: number, ms: number, color: string, width: number): void;
  bolt(x0: number, y0: number, x1: number, y1: number, ms: number, color: string): void;
  flashRect(x: number, y: number, w: number, h: number, ms: number, color: string): void;
  flashCircle(x: number, y: number, r: number, ms: number, color: string): void;

  /** état visuel par bloc */
  blockFx(id: number): BlockFx;
  peekBlockFx(id: number): BlockFx | undefined;
  releaseBlockFx(id: number): void;
  sweepBlockFx(frame: number): void;
  squashScale(fx: BlockFx): number;

  update(dt: number): void;
  /** contexte en unités plateau */
  drawWorld(ctx: CanvasRenderingContext2D): void;
  /** contexte en pixels physiques, sans shake */
  drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, vignette: CanvasImageSource, redEdge: CanvasImageSource): void;
  clear(): void;
}

export function createVfx(): Vfx {
  let shakeAmp = 0;
  let trembleT = 0;
  let trembleAmp = 0;
  let flashA = 0;
  let flashColor = '#ffffff';
  let vignetteT = 0, vignetteDur = 1;
  let redT = 0, redDur = 1;

  const rings: Ring[] = [];
  for (let i = 0; i < MAX_RINGS; i++) rings.push({ active: false, x: 0, y: 0, r0: 0, r1: 1, t: 0, dur: 1, color: '#fff', width: 0.05 });
  const bolts: Bolt[] = [];
  for (let i = 0; i < MAX_BOLTS; i++) bolts.push({ active: false, pts: new Float32Array(BOLT_POINTS * 2), t: 0, dur: 1, color: '#fff' });
  const flashes: LocalFlash[] = [];
  for (let i = 0; i < MAX_FLASHES; i++) flashes.push({ active: false, x: 0, y: 0, w: 0, h: 0, t: 0, dur: 1, color: '#fff', circle: false });

  const fxPool: BlockFx[] = [];
  const fxMap = new Map<number, BlockFx>();
  let lastFrame = 0;
  function newFx(): BlockFx {
    return { inUse: false, id: -1, squashT: SQUASH_DUR, hp: Number.NaN, label: '', x: 0, y: 0, w: 1, kind: 0, seenFrame: 0 };
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
    shakeEnabled: true,
    reduceMotion: false,
    shakeX: 0,
    shakeY: 0,
    addShake(px) {
      if (!api.shakeEnabled || api.reduceMotion) return;
      // max + petite part additive : plusieurs coups rapprochés s'additionnent un peu
      const next = Math.max(shakeAmp, px) + 0.25 * Math.min(shakeAmp, px);
      shakeAmp = next > SHAKE_CAP ? SHAKE_CAP : next;
    },
    tremble(ms, px) {
      if (!api.shakeEnabled || api.reduceMotion) return;
      trembleT = Math.max(trembleT, ms / 1000);
      trembleAmp = Math.max(trembleAmp, px);
    },
    screenFlash(alpha, color) {
      if (api.reduceMotion) return;
      if (alpha > flashA) { flashA = alpha; flashColor = color; }
    },
    vignette(ms) {
      if (api.reduceMotion) return;
      vignetteDur = ms / 1000; vignetteT = vignetteDur;
    },
    redEdges(ms) {
      redDur = ms / 1000; redT = redDur;
    },
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

    blockFx(id) {
      let fx = fxMap.get(id);
      if (fx) return fx;
      for (let i = 0; i < fxPool.length; i++) { const f = fxPool[i]!; if (!f.inUse) { fx = f; break; } }
      if (!fx) { fx = newFx(); fxPool.push(fx); } // rare : plus de 128 blocs vivants
      fx.inUse = true; fx.id = id; fx.squashT = SQUASH_DUR; fx.hp = Number.NaN; fx.label = ''; fx.seenFrame = lastFrame;
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
    sweepBlockFx(frame) {
      // blocs disparus sans événement (restart, reprise) : libérés après 2 frames non vus
      lastFrame = frame;
      for (let i = 0; i < fxPool.length; i++) {
        const f = fxPool[i]!;
        if (f.inUse && frame - f.seenFrame > 2) { f.inUse = false; fxMap.delete(f.id); }
      }
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
      // shake : décroissance exponentielle
      shakeAmp *= Math.exp(-dt / SHAKE_TAU);
      if (shakeAmp < 0.05) shakeAmp = 0;
      if (trembleT > 0) { trembleT -= dt; if (trembleT <= 0) { trembleT = 0; trembleAmp = 0; } }
      let amp = shakeAmp > trembleAmp ? shakeAmp : trembleAmp;
      if (!api.shakeEnabled || api.reduceMotion) { amp = 0; shakeAmp = 0; trembleT = 0; }
      if (amp > SHAKE_CAP) amp = SHAKE_CAP;
      api.shakeX = amp > 0 ? (Math.random() * 2 - 1) * amp : 0;
      api.shakeY = amp > 0 ? (Math.random() * 2 - 1) * amp : 0;

      flashA -= dt * 4; if (flashA < 0) flashA = 0;
      if (vignetteT > 0) vignetteT -= dt;
      if (redT > 0) redT -= dt;
      for (let i = 0; i < MAX_RINGS; i++) { const r = rings[i]!; if (r.active && (r.t += dt) >= r.dur) r.active = false; }
      for (let i = 0; i < MAX_BOLTS; i++) { const b = bolts[i]!; if (b.active && (b.t += dt) >= b.dur) b.active = false; }
      for (let i = 0; i < MAX_FLASHES; i++) { const f = flashes[i]!; if (f.active && (f.t += dt) >= f.dur) f.active = false; }
      for (let i = 0; i < fxPool.length; i++) { const f = fxPool[i]!; if (f.inUse && f.squashT < SQUASH_DUR) f.squashT += dt; }
    },

    drawWorld(ctx) {
      for (let i = 0; i < MAX_FLASHES; i++) {
        const f = flashes[i]!;
        if (!f.active) continue;
        ctx.globalAlpha = 1 - f.t / f.dur;
        ctx.fillStyle = f.color;
        if (f.circle) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.w * (0.6 + 0.4 * (f.t / f.dur)), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(f.x, f.y, f.w, f.h);
        }
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

    drawOverlay(ctx, w, h, vignetteImg, redImg) {
      if (vignetteT > 0) {
        const t = vignetteT / vignetteDur;
        ctx.globalAlpha = t > 0.7 ? 1 : t / 0.7;
        ctx.drawImage(vignetteImg, 0, 0, w, h);
      }
      if (redT > 0) {
        const t = redT / redDur;
        ctx.globalAlpha = (api.reduceMotion ? 0.5 : 1) * t;
        ctx.drawImage(redImg, 0, 0, w, h);
      }
      if (flashA > 0) {
        ctx.globalAlpha = flashA;
        ctx.fillStyle = flashColor;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalAlpha = 1;
    },

    clear() {
      shakeAmp = 0; trembleT = 0; flashA = 0; vignetteT = 0; redT = 0;
      for (const r of rings) r.active = false;
      for (const b of bolts) b.active = false;
      for (const f of flashes) f.active = false;
    },
  };
  return api;
}
