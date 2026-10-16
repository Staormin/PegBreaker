// ui/screens/screen.ts — conteneur d'écran commun (<div class="screen">, montré par .visible).
import type { UiScreen } from '../../core/types';
import { el } from '../dom';

export interface ScreenEl {
  readonly id: UiScreen;
  readonly root: HTMLDivElement;
  /** panneau centré (contenu) */
  readonly panel: HTMLDivElement;
}

export function createScreen(id: UiScreen, title?: string): ScreenEl {
  const root = el('div', `screen screen-${id}`);
  root.dataset.screen = id;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const panel = el('div', 'panel');
  if (title !== undefined) {
    const h = el('h2', 'screen-heading', title);
    panel.append(h);
    root.setAttribute('aria-label', title);
  }
  root.append(panel);
  return { id, root, panel };
}
