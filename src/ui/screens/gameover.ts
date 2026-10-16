// ui/screens/gameover.ts — fin de run : stats, fragments (compteur animé), Rejouer, Puits.
import type { EventBus } from '../../core/events';
import type { RunSummary } from '../../core/types';
import { button, el, fmt } from '../dom';
import { createScreen, type ScreenEl } from './screen';

export interface GameoverScreen extends ScreenEl {
  /** `bestDepthBefore` : record de profondeur avant cette run (null = inconnu, pas de méta) */
  open(summary: RunSummary, reduceMotion: boolean, bestDepthBefore: number | null): void;
}

const COUNT_MS = 900;

export interface GameoverDeps {
  bus: EventBus;
  /** « Rejouer » : décide lui-même entre sim.restart(), reload ou retour en run normale */
  onRestart: () => void;
  onWell: (() => void) | null;
  onDaily: (() => void) | null;
}

export function createGameoverScreen(d: GameoverDeps): GameoverScreen {
  const { bus, onRestart, onWell, onDaily } = d;
  const s = createScreen('gameover', 'Fin de la descente');
  const grid = el('div', 'stats');
  const mk = (label: string): HTMLSpanElement => {
    const cell = el('div', 'stat');
    const v = el('span', 'num stat-val', '0');
    cell.append(v, el('span', 'stat-label', label));
    grid.append(cell);
    return v;
  };
  const vDepth = mk('Profondeur');
  const vWave = mk('Vague');
  const vCombo = mk('Meilleur combo');
  const vDmg = mk('Dégâts max / tir');
  const fragRow = el('div', 'frag-gain');
  const fragVal = el('span', 'num', '+0');
  const fragIco = el('span', 'ico-frag', '◆');
  fragIco.setAttribute('aria-hidden', 'true');
  fragRow.append(fragVal, fragIco, el('span', 'stat-label', 'fragments'));
  fragRow.setAttribute('aria-live', 'polite');

  const record = el('div', 'record');
  record.hidden = true;

  const restart = button(bus, 'btn btn-primary btn-big', '↻ Rejouer', onRestart);
  restart.dataset.action = 'restart';
  const well = button(bus, 'btn btn-ghost', onWell ? 'Le Puits' : '🔒 Le Puits', () => onWell?.());
  well.dataset.action = 'well';
  if (!onWell) {
    well.disabled = true;
    well.title = 'Bientôt';
  }
  const dailyBtn = button(bus, 'btn btn-ghost', '📅 Défi du jour', () => onDaily?.());
  dailyBtn.dataset.action = 'daily';
  dailyBtn.hidden = !onDaily;
  const row2 = el('div', 'actions');
  row2.append(well, dailyBtn);
  const actions = el('div', 'actions actions-col');
  actions.append(restart, row2);
  s.panel.append(record, grid, fragRow, actions);

  let raf = 0;
  function open(summary: RunSummary, reduceMotion: boolean, bestDepthBefore: number | null): void {
    const isRecord = bestDepthBefore !== null && summary.depth > 0 && summary.depth >= bestDepthBefore;
    record.hidden = !isRecord;
    if (isRecord) {
      record.textContent = `${summary.depth > (bestDepthBefore ?? 0) ? '★ Nouveau record' : '★ Record égalé'} : profondeur ${fmt(summary.depth)}`;
    }
    vDepth.textContent = fmt(summary.depth);
    vWave.textContent = fmt(summary.wave);
    vCombo.textContent = fmt(summary.stats.bestCombo);
    vDmg.textContent = fmt(summary.stats.bestShotDamage);
    const target = summary.stats.fragmentsEarned;
    cancelAnimationFrame(raf);
    if (reduceMotion || target <= 0) {
      fragVal.textContent = `+${fmt(target)}`;
      return;
    }
    fragVal.textContent = '+0';
    const t0 = performance.now() + 250; // laisse l'écran apparaître
    let shown = -1;
    const tick = (now: number): void => {
      const t = Math.min(1, Math.max(0, (now - t0) / COUNT_MS));
      const k = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const v = Math.round(target * k);
      if (v !== shown) {
        shown = v;
        fragVal.textContent = `+${fmt(v)}`;
      }
      if (t < 1) raf = requestAnimationFrame(tick);
      else fragRow.classList.add('done');
    };
    fragRow.classList.remove('done');
    raf = requestAnimationFrame(tick);
  }

  return { ...s, open };
}
