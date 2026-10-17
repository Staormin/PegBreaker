// render/fusion.ts — animation de fusion : deux disques convergent vers pos en 250 ms
// (easeOutCubic), puis un callback déclenche flash + anneau + particules.
// Forge (shop:forged) : même animation, 300 ms, avec les sprites des deux PARENTS (rang III)
// à la place de deux copies de la balle.
import type { Sprites } from './sprites';

const MAX = 6;
const DUR = 0.25;
const FORGE_DUR = 0.3;
const GAP = 0.75;
const FORGE_GAP = 0.95;

interface Fusion { active: boolean; x: number; y: number; t: number; dur: number; element: number; tier: number; pa: number; pb: number; }

export interface Fusions {
  start(x: number, y: number, element: number, tier: number): void;
  /** forge : parents pa / pb (ELEMENT_INDEX, dessinés au rang III) → résultat `element` */
  startForge(x: number, y: number, element: number, pa: number, pb: number): void;
  /** onMerge est appelé une fois, au moment où les disques se rejoignent */
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D, sp: Sprites, radius: number): void;
  clear(): void;
}

export function createFusions(onMerge: (x: number, y: number, element: number, tier: number, forge: boolean) => void): Fusions {
  const pool: Fusion[] = [];
  for (let i = 0; i < MAX; i++) pool.push({ active: false, x: 0, y: 0, t: 0, dur: DUR, element: 0, tier: 2, pa: -1, pb: -1 });
  function slot(): Fusion {
    let f = pool[0]!;
    for (let i = 0; i < MAX; i++) if (!pool[i]!.active) { f = pool[i]!; break; }
    return f;
  }
  function drawOne(ctx: CanvasRenderingContext2D, sp: Sprites, radius: number, idx: number, x: number, y: number): void {
    const img = sp.ballAt(idx);
    if (!img) return;
    const ext = (sp.ballExt[idx] ?? radius * 2) * 1.2;
    ctx.drawImage(img, x - ext, y - ext, ext * 2, ext * 2);
  }
  return {
    start(x, y, element, tier) {
      const f = slot();
      f.active = true; f.x = x; f.y = y; f.t = 0; f.dur = DUR; f.element = element; f.tier = tier; f.pa = -1; f.pb = -1;
    },
    startForge(x, y, element, pa, pb) {
      const f = slot();
      f.active = true; f.x = x; f.y = y; f.t = 0; f.dur = FORGE_DUR; f.element = element; f.tier = 1; f.pa = pa; f.pb = pb;
    },
    update(dt) {
      for (let i = 0; i < MAX; i++) {
        const f = pool[i]!;
        if (!f.active) continue;
        f.t += dt;
        if (f.t >= f.dur) { f.active = false; onMerge(f.x, f.y, f.element, f.tier, f.pa >= 0); }
      }
    },
    draw(ctx, sp, radius) {
      for (let i = 0; i < MAX; i++) {
        const f = pool[i]!;
        if (!f.active) continue;
        const u = f.t / f.dur;
        const e = 1 - (1 - u) * (1 - u) * (1 - u);
        const forge = f.pa >= 0;
        const off = (forge ? FORGE_GAP : GAP) * (1 - e);
        // filament lumineux entre les deux disques
        ctx.globalAlpha = 0.25 + 0.6 * e;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.03 + 0.05 * e;
        ctx.beginPath(); ctx.moveTo(f.x - off, f.y); ctx.lineTo(f.x + off, f.y); ctx.stroke();
        ctx.globalAlpha = 1;
        if (forge) {
          drawOne(ctx, sp, radius, f.pa * 3 + 2, f.x - off, f.y);
          drawOne(ctx, sp, radius, (f.pb >= 0 ? f.pb : f.pa) * 3 + 2, f.x + off, f.y);
        } else {
          const src = f.tier > 1 ? f.tier - 1 : 1;
          const idx = f.element * 3 + (src - 1);
          drawOne(ctx, sp, radius, idx, f.x - off, f.y);
          drawOne(ctx, sp, radius, idx, f.x + off, f.y);
        }
      }
    },
    clear() { for (let i = 0; i < MAX; i++) pool[i]!.active = false; },
  };
}
