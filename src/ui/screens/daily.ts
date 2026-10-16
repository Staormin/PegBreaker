// ui/screens/daily.ts — défi quotidien (ui:screen 'daily') : date, mutateurs du jour (F8),
// multiplicateur de fragments, série + calendrier des 7 derniers jours, meilleur résultat, historique.
import type { EventBus } from '../../core/events';
import type { GameConfig, MetaSystem, SaveData } from '../../core/types';
import { dailyModViews, fmtDays, fmtMult, lastDays, parseKey, streakMult, streakOf } from '../dailyInfo';
import { button, el, fmt } from '../dom';
import { createScreen, type ScreenEl } from './screen';

export interface DailyScreen extends ScreenEl {
  refresh(force?: boolean): void;
}

const longFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
const dowFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'narrow' });
const longDayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const HISTORY_DAYS = 30;
const CAL_DAYS = 7;

export function createDailyScreen(meta: MetaSystem, bus: EventBus, onBack: () => void, config: GameConfig): DailyScreen {
  const s = createScreen('daily', 'Défi du jour');
  const date = el('p', 'daily-date', '');

  // mutateurs du jour
  const mods = el('ul', 'daily-mods');
  mods.setAttribute('aria-label', 'Mutateurs du jour');
  const mult = el('div', 'daily-mult');
  mult.setAttribute('role', 'status');

  // série + calendrier
  const streakBox = el('div', 'daily-streak');
  const streakText = el('span', 'daily-streak-text', '');
  const cal = el('ol', 'daily-cal');
  streakBox.append(streakText, cal);

  const best = el('div', 'daily-best');
  const play = button(bus, 'btn btn-primary btn-big', '▶ Jouer le défi du jour', () => {
    location.href = './?daily=1';
  });
  play.dataset.action = 'play-daily';
  const info = el('p', 'muted', 'Même seed et mêmes mutateurs pour tout le monde aujourd’hui.');
  const histTitle = el('h3', 'pane-title', 'Historique');
  const hist = el('ol', 'daily-hist');
  const back = button(bus, 'btn btn-ghost', '← Retour', onBack);
  s.panel.append(date, mods, mult, streakBox, best, play, info, histTitle, hist, back);

  let lastRef: Readonly<SaveData> | null = null;

  function renderMods(today: string, data: Readonly<SaveData>): void {
    mods.textContent = '';
    const views = dailyModViews(config, meta, today);
    mods.hidden = views.length === 0;
    let product = 1;
    for (const v of views) {
      product *= v.fragmentMultiplier;
      const li = el('li', 'daily-mod');
      li.dataset.mod = v.id;
      li.style.setProperty('--mc', v.color);
      const ico = el('span', 'daily-mod-ico', v.glyph);
      ico.setAttribute('aria-hidden', 'true');
      const body = el('div', 'daily-mod-body');
      body.append(el('span', 'daily-mod-name', v.name), el('span', 'daily-mod-desc', v.description));
      const m = el('span', 'num daily-mod-mult', fmtMult(v.fragmentMultiplier));
      m.setAttribute('aria-label', `fragments ${fmtMult(v.fragmentMultiplier)}`);
      m.hidden = v.fragmentMultiplier === 1;
      li.append(ico, body, m);
      mods.append(li);
    }
    // série si l'on joue aujourd'hui : la partie du jour compte dans la série
    const streak = streakOf(meta, today);
    const playedToday = !!data.daily[today];
    const effective = playedToday ? Math.max(1, streak) : streak + 1;
    const sm = streakMult(meta, effective);
    const total = product * sm;
    mult.textContent = '';
    const big = el('span', 'num daily-mult-val', fmtMult(total));
    const ico = el('span', 'ico-frag', '◆');
    ico.setAttribute('aria-hidden', 'true');
    const detail = el('span', 'daily-mult-detail', `mutateurs ${fmtMult(product)} · série ${fmtMult(sm)}`);
    mult.append(big, ico, el('span', 'stat-label', 'fragments'), detail);
    mult.setAttribute('aria-label', `Fragments ${fmtMult(total)} (mutateurs ${fmtMult(product)}, série ${fmtMult(sm)})`);

    // série en cours + calendrier
    streakBox.dataset.streak = String(streak);
    streakText.textContent = streak > 0 ? `Série : ${fmtDays(streak)}` : 'Pas de série en cours';
    cal.textContent = '';
    for (const k of lastDays(today, CAL_DAYS)) {
      const d = parseKey(k);
      const played = !!data.daily[k];
      const isToday = k === today;
      const li = el('li', 'cal-day');
      li.dataset.state = played ? 'played' : isToday ? 'today' : 'missed';
      if (isToday) li.dataset.today = 'true';
      const dow = el('span', 'cal-dow', d ? dowFmt.format(d) : '');
      const mark = el('span', 'cal-mark', played ? '✓' : isToday ? '•' : '·');
      dow.setAttribute('aria-hidden', 'true');
      mark.setAttribute('aria-hidden', 'true');
      li.append(dow, mark);
      const what = played ? 'joué' : isToday ? 'aujourd’hui, pas encore joué' : 'non joué';
      li.setAttribute('aria-label', `${d ? longDayFmt.format(d) : k} : ${isToday && played ? 'aujourd’hui, joué' : what}`);
      li.title = li.getAttribute('aria-label') ?? '';
      cal.append(li);
    }
  }

  function render(data: Readonly<SaveData>): void {
    const today = meta.todayKey();
    const td = parseKey(today);
    date.textContent = td ? longFmt.format(td) : today;
    renderMods(today, data);
    best.textContent = '';
    const r = data.daily[today];
    if (r) {
      best.append(el('span', 'stat-label', 'Meilleur résultat du jour'), el('span', 'num daily-score', `Profondeur ${fmt(r.depth)} · ${fmt(r.score)} pts`));
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
