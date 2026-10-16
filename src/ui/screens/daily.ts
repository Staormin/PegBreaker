// ui/screens/daily.ts — défi quotidien (ui:screen 'daily') : date, meilleur résultat du jour, historique.
import type { EventBus } from '../../core/events';
import type { MetaSystem, SaveData } from '../../core/types';
import { button, el, fmt } from '../dom';
import { createScreen, type ScreenEl } from './screen';

export interface DailyScreen extends ScreenEl {
  refresh(force?: boolean): void;
}

/** 'YYYY-MM-DD' → Date locale (midi, pour éviter les bascules de fuseau). */
function parseKey(k: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}
const longFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
const HISTORY_DAYS = 30;

export function createDailyScreen(meta: MetaSystem, bus: EventBus, onBack: () => void): DailyScreen {
  const s = createScreen('daily', 'Défi du jour');
  const date = el('p', 'daily-date', '');
  const best = el('div', 'daily-best');
  const play = button(bus, 'btn btn-primary btn-big', '▶ Jouer le défi du jour', () => {
    location.href = './?daily=1';
  });
  play.dataset.action = 'play-daily';
  const info = el('p', 'muted', 'Même seed pour tout le monde aujourd’hui.');
  const histTitle = el('h3', 'pane-title', 'Historique');
  const hist = el('ol', 'daily-hist');
  const back = button(bus, 'btn btn-ghost', '← Retour', onBack);
  s.panel.append(date, best, play, info, histTitle, hist, back);

  let lastRef: Readonly<SaveData> | null = null;

  function render(data: Readonly<SaveData>): void {
    const today = meta.todayKey();
    const td = parseKey(today);
    date.textContent = td ? longFmt.format(td) : today;
    best.textContent = '';
    const r = data.daily[today];
    if (r) {
      best.append(el('span', 'stat-label', 'Meilleur résultat'), el('span', 'num daily-score', `Profondeur ${fmt(r.depth)} · ${fmt(r.score)} pts`));
      play.textContent = '▶ Rejouer le défi du jour';
    } else {
      best.append(el('span', 'muted', 'Pas encore joué aujourd’hui.'));
      play.textContent = '▶ Jouer le défi du jour';
    }
    hist.textContent = '';
    const cutoff = td ? td.getTime() - HISTORY_DAYS * 86_400_000 : 0;
    const keys = Object.keys(data.daily).sort().reverse();
    let n = 0;
    for (const k of keys) {
      const d = parseKey(k);
      const res = data.daily[k];
      if (!d || !res || d.getTime() < cutoff) continue;
      const li = el('li', k === today ? 'today' : '');
      li.append(el('span', 'num', shortFmt.format(d)), el('span', 'num', `prof. ${fmt(res.depth)}`), el('span', 'num', `${fmt(res.score)} pts`));
      hist.append(li);
      n++;
    }
    histTitle.hidden = n === 0;
    if (n === 0) hist.append(el('li', 'muted empty', 'Aucun défi terminé pour l’instant.'));
  }

  function refresh(force = false): void {
    const data = meta.data;
    if (!force && data === lastRef) return;
    lastRef = data;
    render(data);
  }

  return { ...s, refresh };
}
