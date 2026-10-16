// ui/screens/toasts.ts — notifications empilables en haut de l'écran (succès débloqués).
import { el } from '../dom';

const TOAST_MS = 3000;

export interface Toasts {
  push(title: string, detail: string): void;
}

export function createToasts(root: HTMLElement): Toasts {
  const box = el('div', 'toasts');
  box.setAttribute('aria-live', 'polite');
  root.append(box);
  return {
    push(title, detail) {
      const t = el('div', 'toast');
      t.append(el('span', 'toast-kicker', 'Succès'), el('span', 'toast-title', title), el('span', 'num toast-detail', detail));
      box.append(t);
      setTimeout(() => {
        t.classList.add('out');
        setTimeout(() => t.remove(), 250);
      }, TOAST_MS);
    },
  };
}
