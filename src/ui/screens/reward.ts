// ui/screens/reward.ts — choix 1 parmi 3 (cartes en cascade 60 ms) ou « Passer (+N pièces) ».
import type { EventBus } from '../../core/events';
import type { GameConfig, RewardOption, Sim } from '../../core/types';
import { button, coinIcon, el } from '../dom';
import { describeOption, optionIcon } from '../options';
import { createScreen, type ScreenEl } from './screen';

export interface RewardScreen extends ScreenEl {
  open(options: readonly RewardOption[]): void;
}

/** décalage de la cascade d'apparition des cartes (ms) */
const CASCADE_MS = 60;

export function createRewardScreen(sim: Sim, bus: EventBus, config: GameConfig): RewardScreen {
  const s = createScreen('reward', 'Choisis');
  const cards = el('div', 'cards');
  const skipCoins = config.economy.reward.skipCoins;
  const skip = button(bus, 'btn btn-ghost', '', () => {
    lock();
    sim.skipReward();
  });
  skip.dataset.action = 'skip-reward';
  skip.append(`Passer (+${skipCoins} `, coinIcon(), ')');
  skip.setAttribute('aria-label', `Passer, plus ${skipCoins} pièces`);
  s.panel.append(cards, skip);

  let locked = false;
  function lock(): void {
    locked = true;
    for (const b of cards.querySelectorAll('button')) b.disabled = true;
    skip.disabled = true;
  }

  function open(options: readonly RewardOption[]): void {
    locked = false;
    skip.disabled = false;
    cards.textContent = '';
    options.forEach((o, i) => {
      const v = describeOption(config, o);
      const card = button(bus, `card card-${o.kind}`, '', () => {
        if (locked) return;
        lock();
        sim.chooseReward(i);
      });
      card.dataset.rewardIndex = String(i);
      card.style.setProperty('--c', v.color);
      card.style.animationDelay = `${i * CASCADE_MS}ms`;
      card.setAttribute('aria-label', `${v.name} : ${v.desc}`);
      const ico = el('div', 'card-icon');
      ico.append(optionIcon(config, o));
      const body = el('div', 'card-body');
      body.append(el('div', 'card-kind', v.kind), el('div', 'card-name', v.name), el('div', 'card-desc', v.desc));
      card.append(ico, body);
      cards.append(card);
    });
    skip.style.animationDelay = `${options.length * CASCADE_MS}ms`;
  }

  return { ...s, open };
}
