// render/fusion.ts — animation de fusion : deux disques convergent vers pos en 250 ms
// (easeOutCubic), puis un callback déclenche flash + anneau + particules.
import type { Sprites } from './sprites';

const MAX = 6;
const DUR = 0.25;
const GAP = 0.75;

interface Fusion { active: boolean; x: number; y: number; t: number; element: number; tier: number; }

export interface Fusions {
  start(x: number, y: number, element: number, tier: number): void;
  /** onMerge est appelé une fois, au moment où les disques se rejoignent */
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D, sp: Sprites, radius: number): void;
  clear(): void;
}

export function createFusions(onMerge: (x: number, y: number, element: number, tier: number) => void): Fusions {
  const pool: Fusion[] = [];
  for (let i = 0; i < MAX; i++) pool.push({ active: false, x: 0, y: 0, t: 0, element: 0, tier: 2 });
  return {
    start(x, y, element, tier) {
      let f = pool[0]!;
      for (let i = 0; i < MAX; i++) if (!pool[i]!.active) { f = pool[i]!; break; }
      f.active = true; f.x = x; f.y = y; f.t = 0; f.element = element; f.tier = tier;
    },
    update(dt) {
      for (let i = 0; i < MAX; i++) {
        const f = pool[i]!;
        if (!f.active) continue;
        f.t += dt;
        if (f.t >= DUR) { f.active = false; onMerge(f.x, f.y, f.element, f.tier); }
      }
    },
    draw(ctx, sp, radius) {
      for (let i = 0; i < MAX; i++) {
        const f = pool[i]!;
        if (!f.active) continue;
        const u = f.t / DUR;
        const e = 1 - (1 - u) * (1 - u) * (1 - u);
        const src = f.tier > 1 ? f.tier - 1 : 1;
        const img = sp.ballAt(f.element * 3 + (src - 1));
        if (!img) continue;
        const ext = (sp.ballExt[f.element * 3 + (src - 1)] ?? radius * 2) * 1.2;
        const off = GAP * (1 - e);
        // filament lumineux entre les deux disques
        ctx.globalAlpha = 0.25 + 0.6 * e;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.03 + 0.05 * e;
        ctx.beginPath(); ctx.moveTo(f.x - off, f.y); ctx.lineTo(f.x + off, f.y); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.drawImage(img, f.x - off - ext, f.y - ext, ext * 2, ext * 2);
        ctx.drawImage(img, f.x + off - ext, f.y - ext, ext * 2, ext * 2);
      }
    },
    clear() { for (let i = 0; i < MAX; i++) pool[i]!.active = false; },
  };
}
