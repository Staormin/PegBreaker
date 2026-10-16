// ui/screens/revive.ts — « Revanche ? » (F4), ouvert sur `run:lost`.
// Bouton principal « Seconde chance » (coût economy.revive.cost ◆, gratuit à la toute première run
// si freeOnFirstRun ; grisé si ◆ insuffisants ou canRevive false), compte à rebours de 6 s en
// texte (aucune animation) puis « Abandonner » automatique. Le coût est débité ici via
// `meta.spendFragments` AVANT `onRevive` (qui appelle sim.revive()).
import type { EventBus } from '../../core/events';
import type { GameConfig, MetaSystem } from '../../core/types';
import { button, el, fmt } from '../dom';
import { createScreen, type ScreenEl } from './screen';

const COUNTDOWN_S = 6;

export interface ReviveInfo {
  canRevive: boolean;
  wave: number;
  depth: number;
  /** meilleure vague avant la run (null = inconnue) */
  bestWave: number | null;
}

export interface ReviveScreen extends ScreenEl {
  open(info: ReviveInfo): void;
  /** arrête le compte à rebours (écran quitté) */
  stop(): void;
}

export interface ReviveDeps {
  bus: EventBus;
  config: GameConfig;
  meta: MetaSystem | null;
  /** appelle sim.revive() ; true = la run reprend */
  onRevive: () => boolean;
  /** appelle sim.giveUp() */
  onGiveUp: () => void;
}

export function createReviveScreen(d: ReviveDeps): ReviveScreen {
  const { bus, config, meta } = d;
  const s = createScreen('revive', 'Revanche ?');
  const grid = el('div', 'stats');
  const mk = (label: string): HTMLSpanElement => {
    const cell = el('div', 'stat');
    const v = el('span', 'num stat-val', '0');
    cell.append(v, el('span', 'stat-label', label));
    grid.append(cell);
    return v;
  };
  const vWave = mk('Vague');
  const vDepth = mk('Profondeur');
  const recordLine = el('p', 'muted revive-record');
  recordLine.hidden = true;
  const offer = el('p', 'muted revive-offer');

  const reviveBtn = button(bus, 'btn btn-primary btn-big revive-btn', '', () => doRevive());
  reviveBtn.dataset.action = 'revive';
  const reviveLabel = el('span', 'revive-label', 'Seconde chance');
  const reviveCost = el('span', 'num revive-cost');
  reviveBtn.append(reviveLabel, reviveCost);
  const msg = el('p', 'revive-msg');
  msg.setAttribute('aria-live', 'assertive');
  msg.hidden = true;
  const countdown = el('p', 'num revive-countdown');
  countdown.setAttribute('aria-live', 'off');
  const giveUpBtn = button(bus, 'btn btn-ghost', 'Abandonner', () => doGiveUp());
  giveUpBtn.dataset.action = 'give-up';
  const actions = el('div', 'actions actions-col');
  actions.append(reviveBtn, msg, countdown, giveUpBtn);
  s.panel.append(grid, recordLine, offer, actions);

  let cost = 0;
  let left = COUNTDOWN_S;
  let timer = 0;
  let decided = true;
  let canRevive = false;

  function balance(): number {
    return meta ? meta.data.meta.fragments : 0;
  }

  function computeCost(): number {
    const r = config.economy.revive;
    if (r.freeOnFirstRun && meta && meta.data.stats.runs === 0) return 0;
    return Math.max(0, r.cost);
  }

  function refresh(): void {
    const enough = cost === 0 || (!!meta && balance() >= cost);
    reviveBtn.disabled = decided || !canRevive || !enough;
    reviveCost.textContent = cost === 0 ? 'Gratuit' : `${fmt(cost)} ◆`;
    reviveBtn.setAttribute('aria-label', cost === 0 ? 'Seconde chance, gratuite' : `Seconde chance pour ${cost} fragments`);
    if (!canRevive) offer.textContent = 'Seconde chance déjà utilisée';
    else if (cost === 0) offer.textContent = 'Première descente : c’est offert';
    else offer.textContent = `PV à moitié · tu as ${fmt(balance())} ◆`;
    if (canRevive && !enough) showMsg('Pas assez de ◆');
  }

  function showMsg(t: string): void {
    msg.textContent = t;
    msg.hidden = false;
  }

  function renderCountdown(): void {
    countdown.textContent = `Abandon dans ${left} s`;
  }

  function stop(): void {
    clearInterval(timer);
    timer = 0;
  }

  function finish(): void {
    decided = true;
    stop();
    reviveBtn.disabled = true;
    giveUpBtn.disabled = true;
  }

  function doGiveUp(): void {
    if (decided) return;
    finish();
    countdown.textContent = '';
    d.onGiveUp();
  }

  function doRevive(): void {
    if (decided || !canRevive) return;
    if (cost > 0) {
      if (!meta || !meta.spendFragments(cost)) {
        showMsg('Pas assez de ◆');
        refresh();
        return;
      }
    }
    finish();
    if (!d.onRevive()) {
      // la sim refuse (état inattendu) : on abandonne proprement
      d.onGiveUp();
    }
  }

  function tick(): void {
    if (decided) return stop();
    if (typeof document !== 'undefined' && document.hidden) return; // onglet caché : compte à rebours suspendu
    left--;
    if (left <= 0) {
      left = 0;
      renderCountdown();
      doGiveUp();
      return;
    }
    renderCountdown();
  }

  function open(info: ReviveInfo): void {
    stop();
    decided = false;
    canRevive = info.canRevive;
    cost = computeCost();
    left = COUNTDOWN_S;
    vWave.textContent = fmt(info.wave);
    vDepth.textContent = fmt(info.depth);
    const best = info.bestWave;
    recordLine.hidden = best === null || best <= 0;
    if (best !== null && best > 0) {
      const gap = best - info.wave;
      recordLine.textContent =
        gap > 0 ? `À ${gap} vague${gap > 1 ? 's' : ''} du record (V${best})` : gap === 0 ? `Record égalé : vague ${best}` : `Nouveau record : vague ${info.wave}`;
    }
    msg.hidden = true;
    giveUpBtn.disabled = false;
    refresh();
    renderCountdown();
    timer = window.setInterval(tick, 1000);
  }

  return { ...s, open, stop };
}
