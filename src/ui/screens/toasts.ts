// ui/screens/toasts.ts — notifications de succès en FILE (QA J3-01 : 12 toasts empilés d'un coup).
// Au plus 2 visibles ; chacun reste 2,2 s ; au-delà de 5 en attente, la file est regroupée
// en un seul toast « +N succès · +X ◆ ».
// Placement (QA FG-04) : jamais sur un onglet ou un bouton.
// - `band(top, height)` : écran de jeu → toasts compacts (une ligne) dans la bande entre la barre
//   du haut et le plateau ; autant de toasts visibles que la bande en contient (au moins 1).
// - `dock(footer)` : boutique / Puits → la pile entre dans le pied d'écran collant, au-dessus
//   des boutons (elle prend sa propre place, ne recouvre rien).
// - `float()` : autres écrans → en haut, comme avant.
import { el } from '../dom';

const TOAST_MS = 2200;
const MAX_VISIBLE = 2;
const MAX_QUEUED = 5;

interface Item {
  kicker: string;
  title: string;
  /** fragments rapportés (pour le regroupement) */
  frags: number;
  /** nombre de succès représentés (1, ou N pour un groupe) */
  count: number;
  /** annonce hors succès (record…) : texte de droite libre, jamais regroupée */
  detail?: string;
  variant?: string;
}

export interface Toasts {
  /** un succès débloqué : nom et fragments gagnés */
  achievement(name: string, frags: number): void;
  /** annonce courte (record de vague…) : `variant` → classe `toast-<variant>` */
  notice(kicker: string, title: string, detail: string, variant: string): void;
  /** écran de jeu : bande libre (px, relatifs à l'overlay) */
  band(top: number, height: number): void;
  /** boutique / Puits : pile insérée en tête de `footer` (au-dessus des boutons) */
  dock(footer: HTMLElement): void;
  /** autres écrans : en haut de l'overlay */
  float(): void;
}

/** hauteur d'un toast compact (CSS `.toasts-band .toast`) + écart */
const BAND_ROW = 36;

export function createToasts(root: HTMLElement): Toasts {
  const box = el('div', 'toasts');
  box.setAttribute('aria-live', 'polite');
  root.append(box);
  const queue: Item[] = [];
  let visible = 0;
  let maxVisible = MAX_VISIBLE;

  function display(it: Item): void {
    visible++;
    const cls = it.variant ? `toast toast-${it.variant}` : it.count > 1 ? 'toast toast-group' : 'toast';
    const t = el('div', cls);
    t.append(el('span', 'toast-kicker', it.kicker), el('span', 'toast-title', it.title), el('span', 'num toast-detail', it.detail ?? `+${it.frags} ◆`));
    box.append(t);
    setTimeout(() => {
      t.remove();
      visible--;
      pump();
    }, TOAST_MS);
  }

  function pump(): void {
    while (visible < maxVisible) {
      const next = queue.shift();
      if (!next) return;
      display(next);
    }
  }

  function regroup(): void {
    if (queue.length <= MAX_QUEUED) return;
    let count = 0;
    let frags = 0;
    const kept: Item[] = [];
    for (const q of queue) {
      if (q.variant) {
        kept.push(q);
        continue;
      }
      count += q.count;
      frags += q.frags;
    }
    queue.length = 0;
    queue.push(...kept);
    if (count > 0) queue.push({ kicker: 'Succès', title: `+${count} succès`, frags, count });
  }

  return {
    achievement(name, frags) {
      queue.push({ kicker: 'Succès', title: name, frags, count: 1 });
      regroup();
      pump();
    },
    notice(kicker, title, detail, variant) {
      // annonce prioritaire : en tête de file
      queue.unshift({ kicker, title, frags: 0, count: 1, detail, variant });
      pump();
    },
    band(top, height) {
      if (box.parentElement !== root) root.append(box);
      box.className = 'toasts toasts-band';
      box.style.top = `${Math.round(top)}px`;
      maxVisible = Math.max(1, Math.min(MAX_VISIBLE, Math.floor((height + 6) / BAND_ROW)));
      // déjà affichés au-delà de la place : masqués (leur minuterie suit son cours)
      Array.from(box.children).forEach((c, i) => ((c as HTMLElement).hidden = i >= maxVisible));
    },
    dock(footer) {
      if (box.parentElement !== footer) footer.prepend(box);
      box.className = 'toasts toasts-dock';
      box.style.top = '';
      maxVisible = MAX_VISIBLE;
      for (const c of Array.from(box.children)) (c as HTMLElement).hidden = false;
      pump();
    },
    float() {
      if (box.parentElement !== root) root.append(box);
      box.className = 'toasts';
      box.style.top = '';
      maxVisible = MAX_VISIBLE;
      for (const c of Array.from(box.children)) (c as HTMLElement).hidden = false;
      pump();
    },
  };
}
