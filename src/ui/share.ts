// ui/share.ts — carte de score PNG 1080×1350 (canvas DOM) + lien de défi (F6).
// Lien : `${origin}${pathname}?seed=<seed>&goal=<depth>`. Partage : Web Share API avec fichier si
// supportée, sinon lien copié dans le presse-papiers + image téléchargée (<a download>).
import type { BallTier, GameConfig, RunSummary } from '../core/types';
import { drawBallShape, elementTable } from './elements';

export const CARD_W = 1080;
export const CARD_H = 1350;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const C = {
  bg0: '#0b0f1a',
  bg1: '#121a2b',
  wall: '#2a3a5c',
  text: '#e8ecf5',
  dim: '#8a94a8',
  accent: '#ffe95c',
  frag: '#c08cff',
};

export type ShareResult = 'shared' | 'cancelled' | 'fallback' | 'failed';

/** paramètres du mode défi lus dans l'URL : `?seed=X&goal=N` */
export function readChallenge(search: string): { seed: string | null; goal: number | null } {
  const p = new URLSearchParams(search);
  const seed = p.get('seed');
  const g = p.get('goal');
  const n = g === null ? NaN : Number.parseInt(g, 10);
  return { seed: seed && seed.length > 0 ? seed : null, goal: Number.isFinite(n) && n >= 0 ? n : null };
}

export function challengeLink(seed: string, depth: number): string {
  return `${location.origin}${location.pathname}?seed=${encodeURIComponent(seed)}&goal=${encodeURIComponent(String(depth))}`;
}

export function shareText(s: RunSummary): string {
  return `PEGBREAKER : profondeur ${s.depth}, vague ${s.wave}, combo ${s.stats.bestCombo}. Bats-moi :`;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n));
}

/** coupe `text` en lignes ≤ maxW (mots, puis caractères pour les URL) */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = '';
  const pushWord = (w: string): void => {
    const cand = line ? `${line} ${w}` : w;
    if (ctx.measureText(cand).width <= maxW) {
      line = cand;
      return;
    }
    if (line) out.push(line);
    line = '';
    // mot trop long (URL) : coupe au caractère
    let chunk = '';
    for (const ch of w) {
      if (ctx.measureText(chunk + ch).width > maxW) {
        out.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    line = chunk;
  };
  for (const w of text.split(/\s+/)) if (w) pushWord(w);
  if (line) out.push(line);
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept[maxLines - 1] = `${(kept[maxLines - 1] ?? '').replace(/.$/, '')}…`;
    return kept;
  }
  return out;
}

/** Dessine la carte de score (titre, profondeur, vague, combo, dégâts, volée, reliques, seed, lien). */
export function renderShareCard(config: GameConfig, s: RunSummary, link: string, goal: number | null = null): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = CARD_W;
  cv.height = CARD_H;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
  g.addColorStop(0, C.bg1);
  g.addColorStop(1, C.bg0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // grille discrète (rappel du plateau)
  ctx.strokeStyle = 'rgba(232,236,245,0.05)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo((CARD_W / 7) * i, 0);
    ctx.lineTo((CARD_W / 7) * i, CARD_H);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const cx = CARD_W / 2;

  // titre
  ctx.font = `900 112px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.shadowColor = 'rgba(255,233,92,0.35)';
  ctx.shadowBlur = 30;
  ctx.fillText('PEGBREAKER', cx, 170);
  ctx.shadowBlur = 0;

  // profondeur (héros)
  ctx.font = `800 40px ${FONT}`;
  ctx.fillStyle = C.dim;
  ctx.fillText('PROFONDEUR', cx, 290);
  ctx.font = `900 230px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.fillText(fmt(s.depth), cx, 500);

  // 3 stats
  const stats: [string, string][] = [
    ['VAGUE', fmt(s.wave)],
    ['MEILLEUR COMBO', fmt(s.stats.bestCombo)],
    ['DÉGÂTS MAX', fmt(s.stats.bestShotDamage)],
  ];
  const colW = (CARD_W - 120) / 3;
  stats.forEach(([label, val], i) => {
    const x = 60 + colW * i;
    ctx.fillStyle = 'rgba(18,26,43,0.9)';
    ctx.strokeStyle = C.wall;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x + 10, 560, colW - 20, 170, 24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.font = `900 76px ${FONT}`;
    ctx.fillText(val, x + colW / 2, 660);
    ctx.fillStyle = C.dim;
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(label, x + colW / 2, 705);
  });

  // volée en pastilles
  let y = 800;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillStyle = C.dim;
  ctx.fillText(`VOLÉE · ${s.volley.length} BALLE${s.volley.length > 1 ? 'S' : ''}`, cx, y);
  y += 60;
  const r = 18;
  const step = 62;
  const perRow = Math.floor((CARD_W - 120) / step);
  const maxShown = perRow * 2;
  const elements = elementTable(config);
  const balls = [...s.volley].sort((a, b) => b.tier - a.tier || elements.index(a.element) - elements.index(b.element));
  const shown = balls.slice(0, balls.length > maxShown ? maxShown - 1 : maxShown);
  const rows = Math.ceil((shown.length + (balls.length > shown.length ? 1 : 0)) / perRow) || 1;
  for (let row = 0; row < rows; row++) {
    const start = row * perRow;
    const n = Math.min(perRow, shown.length + (balls.length > shown.length ? 1 : 0) - start);
    const x0 = cx - ((n - 1) * step) / 2;
    for (let i = 0; i < n; i++) {
      const b = shown[start + i];
      const x = x0 + i * step;
      if (b) {
        const info = elements.get(b.element);
        drawBallShape(ctx, x, y + row * 70, r, info.family, info.color, b.tier, info.colors);
      }
      else {
        ctx.fillStyle = C.dim;
        ctx.font = `900 30px ${FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${balls.length - shown.length}`, x, y + row * 70);
        ctx.textBaseline = 'alphabetic';
      }
    }
  }
  y += rows * 70 + 30;

  // reliques (noms)
  ctx.font = `800 30px ${FONT}`;
  ctx.fillStyle = C.dim;
  ctx.fillText('RELIQUES', cx, y);
  y += 46;
  const names = s.relics.map((id) => config.relics.defs.find((d) => d.id === id)?.name ?? id);
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = C.frag;
  const relicLines = names.length ? wrap(ctx, names.join(' · '), CARD_W - 140, 2) : ['aucune'];
  for (const l of relicLines) {
    ctx.fillText(l, cx, y);
    y += 44;
  }

  // pied : seed + lien
  const footTop = CARD_H - 210;
  ctx.fillStyle = 'rgba(255,233,92,0.08)';
  ctx.fillRect(0, footTop, CARD_W, 210);
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, footTop, CARD_W, 4);
  ctx.font = `700 28px ${FONT}`;
  ctx.fillStyle = C.dim;
  ctx.fillText(`Graine : ${s.seed}${goal !== null ? ` · défi P${goal}` : ''}`, cx, footTop + 52);
  ctx.font = `900 40px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.fillText('Bats-moi :', cx, footTop + 104);
  ctx.font = `700 28px ${FONT}`;
  ctx.fillStyle = C.accent;
  let ly = footTop + 146;
  for (const l of wrap(ctx, link, CARD_W - 100, 2)) {
    ctx.fillText(l, cx, ly);
    ly += 36;
  }
  return cv;
}

export function canvasToBlob(cv: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      cv.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refus de permission : on tente l'ancienne méthode */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Partage : image + texte + lien via navigator.share({ files }) si supporté ; sinon lien copié
 * et image téléchargée. `blob` peut être pré-calculé (préserve l'activation utilisateur).
 */
export async function shareRun(summary: RunSummary, link: string, blob: Blob | null): Promise<{ result: ShareResult; copied: boolean }> {
  const name = `pegbreaker-p${summary.depth}.png`;
  const text = shareText(summary);
  const file = blob && typeof File !== 'undefined' ? new File([blob], name, { type: 'image/png' }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (file && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Pegbreaker', text: `${text} ${link}`, url: link });
      return { result: 'shared', copied: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { result: 'cancelled', copied: false };
      // autre échec : repli ci-dessous
    }
  }
  const copied = await copy(link);
  if (blob) download(blob, name);
  return { result: blob || copied ? 'fallback' : 'failed', copied };
}
