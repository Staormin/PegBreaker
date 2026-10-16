// ui/screens/gameover.ts — fin de run : stats, fragments gagnés, Rejouer, Puits.
// Lot 1 : record de vague (F5), résultat du défi + « Rejouer le défi » (F6), « Partager » (F6).
import type { EventBus } from '../../core/events';
import type { GameConfig, RunSummary } from '../../core/types';
import { fmtDays, fmtMult } from '../dailyInfo';
import { button, el, fmt } from '../dom';
import { ballIcon, elementTable, groupVolley } from '../elements';
import { canvasToBlob, challengeLink, renderShareCard, shareRun } from '../share';
import { createScreen, type ScreenEl } from './screen';

export interface GameoverScreen extends ScreenEl {
  /** `bestDepthBefore` : record de profondeur avant cette run (null = inconnu, pas de méta) */
  open(summary: RunSummary, bestDepthBefore: number | null, bestWaveBefore?: number | null): void;
}

export interface GameoverDeps {
  bus: EventBus;
  /** « Rejouer » : décide lui-même entre sim.restart(), reload ou retour en run normale */
  onRestart: () => void;
  onWell: (() => void) | null;
  onDaily: (() => void) | null;
  config: GameConfig;
  /** mode défi (?goal=N) : null = run normale */
  challengeGoal: number | null;
  /** « Rejouer le défi » : recharge la même URL */
  onReplayChallenge: () => void;
  /** F8 : série du quotidien après cette run (null = pas de méta) */
  dailyStreak?: ((summary: RunSummary) => { streak: number; multiplier: number }) | null;
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

  // volée finale : une puce par (élément, rang), nom au survol (title) et en aria-label
  const volleyTitle = el('p', 'end-volley-title', 'Volée finale');
  const volleyRow = el('div', 'end-volley');
  volleyRow.setAttribute('role', 'list');
  volleyRow.setAttribute('aria-label', 'Volée finale');

  const record = el('div', 'record');
  record.hidden = true;
  const recordGap = el('p', 'muted record-gap');
  recordGap.hidden = true;
  const dailyLine = el('p', 'daily-streak-end');
  dailyLine.hidden = true;
  const challenge = el('div', 'challenge-result');
  challenge.setAttribute('role', 'status');
  challenge.hidden = true;

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

  const replay = button(bus, 'btn btn-primary btn-big', '⚔ Rejouer le défi', () => d.onReplayChallenge());
  replay.dataset.action = 'replay-challenge';
  replay.hidden = d.challengeGoal === null;
  if (d.challengeGoal !== null) {
    // en défi, « Rejouer » lance une descente normale : libellé distinct, bouton secondaire
    restart.textContent = '↻ Nouvelle run';
    restart.className = 'btn btn-ghost';
  }
  const share = button(bus, 'btn btn-ghost btn-share', '⇪ Partager', () => void doShare());
  share.dataset.action = 'share';
  const shareMsg = el('p', 'muted share-msg');
  shareMsg.setAttribute('aria-live', 'polite');
  shareMsg.hidden = true;
  const actions = el('div', 'actions actions-col');
  if (d.challengeGoal !== null) {
    // défi : tout doit tenir en 360×640 → « Partager » et « Nouvelle run » sur une rangée
    const row1 = el('div', 'actions');
    row1.append(share, restart);
    actions.append(replay, row1, shareMsg, row2);
  } else actions.append(restart, share, shareMsg, row2);
  s.panel.append(challenge, dailyLine, record, recordGap, grid, fragRow, volleyTitle, volleyRow, actions);

  function renderVolley(sum: RunSummary): void {
    volleyRow.textContent = '';
    const groups = groupVolley(d.config, sum.volley);
    volleyTitle.hidden = volleyRow.hidden = groups.length === 0;
    volleyTitle.textContent = `Volée finale · ${sum.volley.length} balle${sum.volley.length > 1 ? 's' : ''}`;
    const t = elementTable(d.config);
    for (const g of groups) {
      const info = t.get(g.element);
      const rank = g.tier === 1 ? '' : g.tier === 2 ? ' II' : ' III';
      const chip = el('span', 'ev-chip');
      chip.setAttribute('role', 'listitem');
      chip.dataset.element = g.element;
      chip.dataset.family = info.family;
      chip.dataset.tier = String(g.tier);
      chip.title = `${info.name}${rank} ×${g.count} — ${info.desc}`;
      chip.setAttribute('aria-label', `${info.name}${rank} ×${g.count}`);
      chip.append(ballIcon(d.config, g.element, g.tier, 28), el('span', 'num', `×${g.count}`));
      volleyRow.append(chip);
    }
  }

  let current: RunSummary | null = null;
  let cardBlob: Promise<Blob | null> | null = null;
  let sharing = false;

  function link(sum: RunSummary): string {
    return challengeLink(sum.seed, sum.depth);
  }

  async function doShare(): Promise<void> {
    if (!current || sharing) return;
    sharing = true;
    const sum = current;
    try {
      const blob = cardBlob ? await cardBlob : null;
      const r = await shareRun(sum, link(sum), blob);
      if (r.result === 'fallback') {
        shareMsg.textContent = r.copied ? (blob ? 'Lien copié · image téléchargée' : 'Lien copié') : 'Image téléchargée';
        shareMsg.hidden = false;
      } else if (r.result === 'failed') {
        shareMsg.textContent = `Lien : ${link(sum)}`;
        shareMsg.hidden = false;
      } else if (r.result === 'shared') {
        shareMsg.textContent = 'Partagé !';
        shareMsg.hidden = false;
      }
    } finally {
      sharing = false;
    }
  }

  function open(summary: RunSummary, bestDepthBefore: number | null, bestWaveBefore: number | null = null): void {
    current = summary;
    shareMsg.hidden = true;
    // carte pré-calculée : le clic sur « Partager » garde l'activation utilisateur
    cardBlob = null;
    try {
      cardBlob = canvasToBlob(renderShareCard(d.config, summary, link(summary), d.challengeGoal));
    } catch {
      cardBlob = null;
    }
    // défi : « Défi réussi ! » si profondeur > N
    const goal = d.challengeGoal;
    challenge.hidden = goal === null;
    if (goal !== null) {
      const res = summary.depth > goal ? 'won' : summary.depth === goal ? 'tie' : 'lost';
      challenge.dataset.result = res;
      challenge.textContent =
        res === 'won' ? '✓ Défi réussi !' : res === 'tie' ? `= Égalité : P${fmt(goal)}` : `✗ Défi raté : P${fmt(summary.depth)} / P${fmt(goal)}`;
    }
    // F8 : fin d'un quotidien → « Série : N jours, ×M fragments »
    const ds = summary.isDaily && d.dailyStreak ? d.dailyStreak(summary) : null;
    dailyLine.hidden = !ds;
    if (ds) {
      dailyLine.textContent = `🔥 Série : ${fmtDays(ds.streak)}, ${fmtMult(ds.multiplier)} fragments`;
      dailyLine.dataset.streak = String(ds.streak);
    }
    // record de vague (prioritaire), sinon record de profondeur
    const bw = bestWaveBefore;
    let rec = '';
    recordGap.hidden = true;
    if (bw !== null && summary.wave > bw) rec = `★ Nouveau record : vague ${fmt(summary.wave)}`;
    else if (bw !== null && bw > 0 && summary.wave === bw) rec = `★ Record égalé : vague ${fmt(summary.wave)}`;
    else if (bw !== null && bw > summary.wave) {
      const gap = bw - summary.wave;
      recordGap.textContent = `À ${gap} vague${gap > 1 ? 's' : ''} du record (V${fmt(bw)})`;
      recordGap.hidden = false;
    }
    if (!rec && bestDepthBefore !== null && summary.depth > 0 && summary.depth >= bestDepthBefore) {
      rec = `${summary.depth > bestDepthBefore ? '★ Nouveau record' : '★ Record égalé'} : profondeur ${fmt(summary.depth)}`;
    }
    record.hidden = rec === '';
    record.textContent = rec;
    vDepth.textContent = fmt(summary.depth);
    vWave.textContent = fmt(summary.wave);
    vCombo.textContent = fmt(summary.stats.bestCombo);
    vDmg.textContent = fmt(summary.stats.bestShotDamage);
    fragVal.textContent = `+${fmt(summary.stats.fragmentsEarned)}`;
    renderVolley(summary);
  }

  return { ...s, open };
}
