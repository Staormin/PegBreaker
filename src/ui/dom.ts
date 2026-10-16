// ui/dom.ts — petits utilitaires DOM partagés par les modules UI.
// Règle : tout contenu dynamique passe par textContent (jamais innerHTML avec des données).
import type { EventBus } from '../core/events';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Bouton natif : émet `ui:click` puis appelle `onActivate` (souris, tactile et clavier). */
export function button(
  bus: EventBus,
  className: string,
  label: string,
  onActivate: () => void,
  ariaLabel?: string,
): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  b.addEventListener('click', () => {
    if (b.disabled) return;
    bus.emit({ type: 'ui:click' });
    onActivate();
  });
  return b;
}

const nf = new Intl.NumberFormat('fr-FR');
export function fmt(n: number): string {
  return nf.format(Math.round(n));
}

/** Tronque à `max` caractères (règle UI : ≤ 60 sur les cartes). */
export function clip(s: string, max = 60): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  // coupe sur une frontière de mot si possible, sans ponctuation pendante
  const base = sp > max * 0.6 ? cut.slice(0, sp) : cut;
  return `${base.replace(/[\s,;:.]+$/, '')}…`;
}

/** Pièce dessinée en CSS (pas d'emoji : rendu identique partout). */
export function coinIcon(): HTMLSpanElement {
  const s = el('span', 'ico-coin');
  s.setAttribute('aria-hidden', 'true');
  return s;
}
