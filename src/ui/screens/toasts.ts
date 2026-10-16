// ui/screens/toasts.ts — notifications de succès en FILE (QA J3-01 : 12 toasts empilés d'un coup).
// Au plus 2 visibles ; chacun reste 2,2 s ; au-delà de 5 en attente, la file est regroupée
// en un seul toast « +N succès · +X ◆ ».
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
}

export function createToasts(root: HTMLElement): Toasts {
  const box = el('div', 'toasts');
  box.setAttribute('aria-live', 'polite');
  root.append(box);
  const queue: Item[] = [];
  let visible = 0;

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
    while (visible < MAX_VISIBLE) {
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
  };
}
