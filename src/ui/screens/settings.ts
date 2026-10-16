// ui/screens/settings.ts — réglages (ui:screen 'settings') : volumes, secousses, mouvements réduits, reset.
import type { EventBus } from '../../core/events';
import type { AudioSystem, MetaSystem, Renderer, SaveData } from '../../core/types';
import { button, el } from '../dom';
import { createScreen, type ScreenEl } from './screen';

export interface SettingsScreen extends ScreenEl {
  refresh(force?: boolean): void;
}

const RESET_CONFIRM_MS = 4000;

export function createSettingsScreen(
  meta: MetaSystem,
  bus: EventBus,
  audio: AudioSystem | null,
  renderer: Renderer,
  onBack: () => void,
): SettingsScreen {
  const s = createScreen('settings', 'Réglages');

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

  function toggle(label: string, key: 'shake' | 'reduceMotion'): HTMLButtonElement {
    const b = button(bus, 'switch set-switch', '', () => {
      const v = !(meta.data.settings[key]);
      meta.updateSettings(key === 'shake' ? { shake: v } : { reduceMotion: v });
      if (key === 'shake') renderer.setShake(v);
      else renderer.setReduceMotion(v);
      refresh();
    });
    b.setAttribute('role', 'switch');
    b.dataset.setting = key;
    b.append(el('span', 'switch-track'), el('span', 'switch-label', label));
    s.panel.append(b);
    return b;
  }

  const sfx = slider('🔊 Effets', 'sfx');
  const music = slider('🎵 Musique', 'music');
  const shake = toggle('Secousses d’écran', 'shake');
  const reduce = toggle('Mouvements réduits', 'reduceMotion');

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
  const back = button(bus, 'btn btn-primary', '← Retour', () => {
    disarm();
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
    for (const [b, on] of [
      [shake, st.shake],
      [reduce, st.reduceMotion],
    ] as const) {
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (!force) return;
    disarm();
  }

  return { ...s, refresh };
}
