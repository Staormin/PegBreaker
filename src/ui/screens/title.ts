// ui/screens/title.ts — écran titre (premier lancement uniquement : meta.data.onboarded === false).
// Disparaît au premier pointerdown (ou touche clavier).
import { el } from '../dom';
import { createScreen, type ScreenEl } from './screen';

export function createTitleScreen(onDismiss: () => void): ScreenEl {
  const s = createScreen('title');
  s.root.setAttribute('aria-label', 'Pegbreaker');
  const logo = el('h1', 'logo', 'PEGBREAKER');
  const hint = el('div', 'title-hint');
  const arrow = el('div', 'hint-arrow');
  arrow.setAttribute('aria-hidden', 'true');
  hint.append(arrow, el('p', 'title-sub', 'Glisse pour viser'));
  s.panel.append(logo, hint);
  const dismiss = (e: Event): void => {
    if (!s.root.classList.contains('visible')) return;
    e.preventDefault();
    onDismiss();
  };
  s.root.addEventListener('pointerdown', dismiss);
  s.root.addEventListener('keydown', dismiss);
  s.root.tabIndex = -1;
  return s;
}
