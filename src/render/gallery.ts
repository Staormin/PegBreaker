// render/gallery.ts — planche de contrôle visuel : les 27 balles × 3 rangs, avec nom et famille,
// dessinées avec les VRAIS sprites du renderer (buildSprites). Page : demo.html?gallery=1.
// Hors boucle de jeu : allocations libres ici (dessin unique, refait au resize).
import { loadConfig } from '../core/config';
import { BALL_FAMILIES, type GameConfig } from '../core/types';
import { createLayout } from './layout';
import { buildColors, ELEMENTS, PALETTE } from './palette';
import { buildSprites, ELEMENT_ORIENT, ORIENT_VELOCITY, quantizeRadius, ROT_STEPS, ROT_UP, RQ_ONE } from './sprites';

const COLS = 3;
const FAMILY_LABEL: Record<string, string> = {
  elemental: 'élémentaire', heavy: 'lourde', tricky: 'retorse', swarm: 'essaim', greed: 'avidité', arcane: 'arcane',
};

/** Dessine la galerie dans `canvas` (largeur = parent) ; renvoie une fonction d'arrêt. */
export function mountBallGallery(canvas: HTMLCanvasElement, config: GameConfig = loadConfig()): () => void {
  const colors = buildColors(config);
  const R = config.blocks.board.ballRadius;
  const giant = config.balls.defs.find((d) => d.id === 'giant')?.params?.radiusMult ?? [1.8, 2.1, 2.4];

  function render(): void {
    const cssW = Math.max(360, canvas.parentElement?.clientWidth ?? window.innerWidth);
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const cellW = cssW / COLS;
    const rPx = cellW / 24; // rayon d'une balle de rang I (px CSS)
    const rowH = rPx * 2 * 5.9 + 58;
    const header = 64;
    const rows = Math.ceil(ELEMENTS.length / COLS);
    const cssH = header + rows * rowH + 16;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const g = canvas.getContext('2d');
    if (!g) return;
    // layout fictif : seule la taille de cellule (px physiques) compte pour les sprites
    const layout = createLayout(config.blocks.board.cols, config.blocks.board.rows);
    layout.dpr = dpr;
    layout.scale = rPx / R;
    layout.cellPx = Math.max(4, Math.round((rPx / R) * dpr));
    const sp = buildSprites(layout, colors, config);
    const k = layout.cellPx; // px physiques par unité

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = PALETTE.bg0;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fam = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    g.fillStyle = PALETTE.text;
    g.font = `800 ${Math.round(cellW * 0.075)}px ${fam}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`Pegbreaker — ${ELEMENTS.length} balles (rangs I · II · III)`, 16, header / 2);

    for (let e = 0; e < ELEMENTS.length; e++) {
      const col = e % COLS, row = Math.floor(e / COLS);
      const x0 = col * cellW, y0 = header + row * rowH;
      g.fillStyle = PALETTE.bg1;
      g.beginPath(); g.roundRect(x0 + 6, y0 + 4, cellW - 12, rowH - 8, 12); g.fill();
      g.strokeStyle = PALETTE.grid; g.lineWidth = 1; g.stroke();
      const id = ELEMENTS[e]!;
      // largeurs réelles des 3 sprites, centrés côte à côte
      const exts: number[] = [];
      const imgs: (HTMLCanvasElement | undefined)[] = [];
      const oriented = (ELEMENT_ORIENT[e] ?? 0) === ORIENT_VELOCITY;
      for (let t = 1; t <= 3; t++) {
        const idx = e * 3 + (t - 1);
        const rq = id === 'giant' ? quantizeRadius(R * (giant[t - 1] ?? 1.8), R) : RQ_ONE;
        // orientées : en diagonale montante (sens de vol lisible)
        const rot = oriented ? Math.round(ROT_STEPS * 0.875) : ROT_UP;
        imgs.push(sp.ball(idx, rq, rot));
        exts.push((((sp.ballExt[idx] ?? R * 2) * rq) / RQ_ONE) * k / dpr);
      }
      const gap = rPx * 0.6;
      let total = exts.reduce((a, b) => a + b * 2, 0) + gap * 2;
      // la géante (rang III à taille réelle) peut déborder : réduction uniforme de la cellule
      const fit = Math.min(1, (cellW - 24) / total);
      if (fit < 1) { for (let t = 0; t < 3; t++) exts[t] = (exts[t] ?? 0) * fit; total = (cellW - 24); }
      let x = x0 + (cellW - total) / 2;
      const cy = y0 + 8 + rPx * 5.9;
      for (let t = 0; t < 3; t++) {
        const img = imgs[t], ex = exts[t] ?? 0;
        if (img) g.drawImage(img, x, cy - ex, ex * 2, ex * 2);
        x += ex * 2 + gap;
      }
      const def = config.balls.defs.find((d) => d.id === id);
      g.textAlign = 'center';
      g.fillStyle = colors.element[e] ?? PALETTE.text;
      g.font = `800 ${Math.round(cellW * 0.062)}px ${fam}`;
      g.fillText(colors.name[e] ?? id, x0 + cellW / 2, y0 + rowH - 38);
      g.fillStyle = PALETTE.textDim;
      g.font = `600 ${Math.round(cellW * 0.042)}px ${fam}`;
      const famId = BALL_FAMILIES[colors.family[e] ?? 0] ?? 'arcane';
      g.fillText(`${id} · ${FAMILY_LABEL[famId] ?? famId}${def ? '' : ' (sans config)'}`, x0 + cellW / 2, y0 + rowH - 16);
    }
  }

  render();
  const onResize = (): void => render();
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
