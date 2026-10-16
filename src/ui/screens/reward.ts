// ui/screens/reward.ts — choix 1 parmi 3 (cartes en cascade 60 ms) ou « Passer (+N pièces) ».
// F9 : `source === 'boss'` → coffre « Butin du boss » : 3 cartes face cachée, le joueur en révèle
// jusqu'à `CHEST_MAX_REVEALS` (fondu ≤ 120 ms, pas de mouvement) puis « Prendre » sous une carte
// révélée → `sim.chooseReward(i)`. Pas de « Passer » sur le coffre.
// Sélecteurs : `.chest-card[data-revealed]`, `.chest-card[data-locked]`, `[data-action="reveal"]`,
// `[data-action="take"]`, `.screen-reward[data-source="boss"]`.
import type { EventBus } from '../../core/events';
import type { GameConfig, RewardOption, Sim } from '../../core/types';
import { button, coinIcon, el } from '../dom';
import { describeOption, optionIcon } from '../options';
import { createScreen, type ScreenEl } from './screen';

export type RewardSource = 'wave' | 'boss';

export interface RewardScreen extends ScreenEl {
  open(options: readonly RewardOption[], source?: RewardSource): void;
}

/** nombre de cartes que l'on peut retourner dans le coffre */
const CHEST_MAX_REVEALS = 2;

export function createRewardScreen(sim: Sim, bus: EventBus, config: GameConfig): RewardScreen {
  const s = createScreen('reward', 'Choisis');
  const heading = s.panel.querySelector<HTMLElement>('.screen-heading');
  const sub = el('p', 'muted chest-sub', '');
  sub.hidden = true;
  const cards = el('div', 'cards');
  const skipCoins = config.economy.reward.skipCoins;
  const skip = button(bus, 'btn btn-ghost', '', () => {
    if (locked) return;
    lock();
    sim.skipReward();
  });
  skip.dataset.action = 'skip-reward';
  skip.append(`Passer (+${skipCoins} `, coinIcon(), ')');
  skip.setAttribute('aria-label', `Passer, plus ${skipCoins} pièces`);
  s.panel.append(sub, cards, skip);

  let locked = false;
  function lock(): void {
    locked = true;
    for (const b of cards.querySelectorAll('button')) b.disabled = true;
    skip.disabled = true;
  }

  function face(o: RewardOption): { ico: HTMLElement; body: HTMLElement; color: string; label: string } {
    const v = describeOption(config, o);
    const ico = el('div', 'card-icon');
    ico.append(optionIcon(config, o));
    const body = el('div', 'card-body');
    body.append(el('div', 'card-kind', v.kind), el('div', 'card-name', v.name), el('div', 'card-desc', v.desc));
    return { ico, body, color: v.color, label: `${v.name} : ${v.desc}` };
  }

  function setTitle(t: string): void {
    if (heading) heading.textContent = t;
    s.root.setAttribute('aria-label', t);
  }

  function openWave(options: readonly RewardOption[]): void {
    options.forEach((o, i) => {
      const f = face(o);
      const card = button(bus, `card card-${o.kind}`, '', () => {
        if (locked) return;
        lock();
        sim.chooseReward(i);
      });
      card.dataset.rewardIndex = String(i);
      card.style.setProperty('--c', f.color);
      card.setAttribute('aria-label', f.label);
      card.append(f.ico, f.body);
      cards.append(card);
    });
  }

  function openChest(options: readonly RewardOption[]): void {
    let reveals = 0;
    const slots: { card: HTMLElement; reveal: HTMLButtonElement }[] = [];
    const updateSub = (): void => {
      const left = CHEST_MAX_REVEALS - reveals;
      sub.textContent =
        left > 0 ? `Retourne une carte (${left} sur ${CHEST_MAX_REVEALS}), puis prends-en une.` : 'Prends une des cartes révélées.';
    };
    options.forEach((o, i) => {
      const f = face(o);
      const slot = el('div', 'chest-slot');
      const card = el('div', `chest-card card-${o.kind}`);
      card.dataset.rewardIndex = String(i);
      card.style.setProperty('--c', f.color);
      const front = el('div', 'chest-face');
      front.append(f.ico, f.body);
      front.setAttribute('aria-hidden', 'true');
      const reveal = button(bus, 'chest-back', '', () => {
        if (locked || reveals >= CHEST_MAX_REVEALS || card.dataset.revealed) return;
        reveals++;
        card.dataset.revealed = 'true';
        front.removeAttribute('aria-hidden');
        reveal.disabled = true;
        reveal.tabIndex = -1;
        reveal.setAttribute('aria-hidden', 'true');
        take.hidden = false;
        take.setAttribute('aria-label', `Prendre ${f.label}`);
        if (reveals >= CHEST_MAX_REVEALS) {
          for (const other of slots) {
            if (other.card.dataset.revealed) continue;
            other.card.dataset.locked = 'true';
            other.reveal.disabled = true;
            other.reveal.setAttribute('aria-label', `Carte ${slots.indexOf(other) + 1} : restera cachée`);
          }
        }
        updateSub();
        if (!take.disabled) take.focus({ preventScroll: true });
      });
      reveal.dataset.action = 'reveal';
      reveal.setAttribute('aria-label', `Révéler la carte ${i + 1}`);
      const mark = el('span', 'chest-mark', '?');
      mark.setAttribute('aria-hidden', 'true');
      reveal.append(mark);
      card.append(front, reveal);
      const take = button(bus, 'btn btn-primary chest-take', 'Prendre', () => {
        if (locked || !card.dataset.revealed) return;
        lock();
        sim.chooseReward(i);
      });
      take.dataset.action = 'take';
      take.dataset.rewardIndex = String(i);
      take.hidden = true;
      slot.append(card, take);
      cards.append(slot);
      slots.push({ card, reveal });
    });
    updateSub();
  }

  function open(options: readonly RewardOption[], source: RewardSource = 'wave'): void {
    locked = false;
    skip.disabled = false;
    cards.textContent = '';
    const chest = source === 'boss';
    s.root.dataset.source = source;
    cards.classList.toggle('chest', chest);
    skip.hidden = chest;
    sub.hidden = !chest;
    setTitle(chest ? 'Butin du boss' : 'Choisis');
    if (chest) openChest(options);
    else openWave(options);
  }

  return { ...s, open };
}
