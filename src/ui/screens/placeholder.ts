// ui/screens/placeholder.ts — écrans prévus mais pas encore livrés (Puits, réglages, quotidien).
import type { EventBus } from '../../core/events';
import type { UiScreen } from '../../core/types';
import { button, el } from '../dom';
import { createScreen, type ScreenEl } from './screen';

export function createPlaceholderScreen(id: UiScreen, title: string, bus: EventBus, onBack: () => void): ScreenEl {
  const s = createScreen(id, title);
  s.panel.append(el('p', 'muted', 'Bientôt.'), button(bus, 'btn btn-ghost', '← Retour', onBack));
  return s;
}
