// ui/screens/settings.ts — pause / réglages (ui:screen 'settings') : volumes, abandon, reset.
import type { EventBus } from '../../core/events';
import type { AudioSystem, MetaSystem, RunState, SaveData } from '../../core/types';
import { button, el } from '../dom';
import { createScreen, type ScreenEl } from './screen';

export interface SettingsScreen extends ScreenEl {
  refresh(force?: boolean): void;
  /** chaque frame quand l'écran est visible : état de la run (« Volée en cours », abandon possible) */
  tick(state: Readonly<RunState>): void;
}

const RESET_CONFIRM_MS = 4000;

export function createSettingsScreen(
  meta: MetaSystem,
  bus: EventBus,
  audio: AudioSystem | null,
  onBack: () => void,
  onAbandon: (() => void) | null = null,
): SettingsScreen {
  // fait aussi office de menu pause (la sim n'avance pas en visée ; une volée continue)
  const s = createScreen('settings', '⏸ Pause');
  const status = el('p', 'pause-status', '');
  status.hidden = true;
  s.panel.append(status);

  function slider(label: string, key: 'sfx' | 'music'): HTMLInputElement {
    const row = el('label', 'set-row');
    const name = el('span', 'set-name', label);
    const input = el('input', 'set-range');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
    input.dataset.setting = key;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      meta.updateSettings(key === 'sfx' ? { sfx: v } : { music: v });
      if (key === 'sfx') audio?.setSfxVolume(v);
      else audio?.setMusicVolume(v);
    });
    input.addEventListener('change', () => bus.emit({ type: 'ui:click' }));
    row.append(name, input);
    s.panel.append(row);
    return input;
  }

  const sfx = slider('🔊 Effets', 'sfx');
  const music = slider('🎵 Musique', 'music');

  // abandon de la descente : confirmation en deux clics
  let abArmed = false;
  let abTimer = 0;
  const ABANDON_LABEL = '⚑ Abandonner la descente';
  const abandon = button(bus, 'btn btn-danger', ABANDON_LABEL, () => {
    if (!abArmed) {
      abArmed = true;
      abandon.textContent = 'Confirmer l’abandon ?';
      abandon.classList.add('armed');
      clearTimeout(abTimer);
      abTimer = window.setTimeout(disarmAbandon, RESET_CONFIRM_MS);
      return;
    }
    disarmAbandon();
    onAbandon?.();
  });
  abandon.dataset.action = 'abandon-run';
  abandon.hidden = !onAbandon;
  function disarmAbandon(): void {
    abArmed = false;
    abandon.textContent = ABANDON_LABEL;
    abandon.classList.remove('armed');
  }
  s.panel.append(abandon);

  let armed = false;
  let timer = 0;
  const reset = button(bus, 'btn btn-danger', 'Réinitialiser la sauvegarde', () => {
    if (!armed) {
      armed = true;
      reset.textContent = 'Confirmer : tout effacer ?';
      reset.classList.add('armed');
      clearTimeout(timer);
      timer = window.setTimeout(disarm, RESET_CONFIRM_MS);
      return;
    }
    meta.reset();
    location.reload();
  });
  reset.dataset.action = 'reset-save';
  function disarm(): void {
    armed = false;
    reset.textContent = 'Réinitialiser la sauvegarde';
    reset.classList.remove('armed');
  }
  const back = button(bus, 'btn btn-primary', '▶ Reprendre', () => {
    disarm();
    disarmAbandon();
    onBack();
  });
  s.panel.append(reset, back);

  let lastRef: Readonly<SaveData> | null = null;
  function refresh(force = false): void {
    const data = meta.data;
    if (!force && data === lastRef) return;
    lastRef = data;
    const st = data.settings;
    if (document.activeElement !== sfx) sfx.value = String(st.sfx);
    if (document.activeElement !== music) music.value = String(st.music);
    if (!force) return;
    disarm();
    disarmAbandon();
  }

  let lastPhase = '';
  function tick(state: Readonly<RunState>): void {
    if (state.phase === lastPhase) return;
    lastPhase = state.phase;
    const firing = state.phase === 'firing';
    status.hidden = !firing;
    status.textContent = firing ? '⏩ Volée en cours' : '';
    abandon.hidden = !onAbandon || state.phase === 'gameover';
  }

  return { ...s, refresh, tick };
}
