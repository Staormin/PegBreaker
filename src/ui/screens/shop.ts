// ui/screens/shop.ts — boutique : articles + prix, reroll, « Continuer ».
import type { EventBus } from '../../core/events';
import type { GameConfig, ShopState, Sim } from '../../core/types';
import { button, coinIcon, el, fmt } from '../dom';
import { describeOption, optionIcon } from '../options';
import { createScreen, type ScreenEl } from './screen';

export interface ShopScreen extends ScreenEl {
  /** (re)construit les articles depuis l'état de la boutique */
  render(shop: Readonly<ShopState>, coins: number): void;
  /** met à jour uniquement l'accessibilité des achats (coins changés) */
  refreshAffordability(coins: number): void;
}

export function createShopScreen(sim: Sim, bus: EventBus, config: GameConfig): ShopScreen {
  const s = createScreen('shop', 'Boutique');
  const wallet = el('div', 'wallet');
  const walletVal = el('span', 'num', '0');
  wallet.append(coinIcon(), walletVal);
  wallet.setAttribute('aria-label', 'Pièces');
  const items = el('div', 'shop-items');
  const actions = el('div', 'actions');
  const reroll = button(bus, 'btn btn-ghost', '', () => sim.reroll());
  reroll.dataset.action = 'reroll';
  const rerollLabel = el('span', '', '↻ Reroll ');
  const rerollCost = el('span', 'num', '0');
  reroll.append(rerollLabel, coinIcon(), rerollCost);
  const leave = button(bus, 'btn btn-primary', 'Continuer', () => sim.leaveShop());
  leave.dataset.action = 'leave-shop';
  actions.append(reroll, leave);
  s.panel.append(wallet, items, actions);

  let current: Readonly<ShopState> | null = null;
  let cost = 0;

  function refreshAffordability(coins: number): void {
    walletVal.textContent = fmt(coins);
    if (!current) return;
    const btns = items.querySelectorAll<HTMLButtonElement>('button[data-shop-index]');
    btns.forEach((b) => {
      const it = current?.items[Number(b.dataset.shopIndex)];
      if (!it) return;
      const off = it.sold || coins < it.price;
      b.disabled = off;
      b.classList.toggle('sold', it.sold);
      b.classList.toggle('poor', !it.sold && coins < it.price);
    });
    reroll.disabled = coins < cost;
  }

  function render(shop: Readonly<ShopState>, coins: number): void {
    current = shop;
    cost = shop.rerollCost;
    rerollCost.textContent = fmt(cost);
    reroll.setAttribute('aria-label', `Reroll, ${cost} pièces`);
    items.textContent = '';
    shop.items.forEach((it, i) => {
      const v = describeOption(config, it.option);
      const b = button(bus, `card shop-item card-${it.option.kind}`, '', () => sim.buy(i));
      b.dataset.shopIndex = String(i);
      b.style.setProperty('--c', v.color);
      b.style.animationDelay = `${i * 60}ms`;
      b.setAttribute('aria-label', `${v.name}, ${it.sold ? 'vendu' : `${it.price} pièces`} : ${v.desc}`);
      const ico = el('div', 'card-icon');
      ico.append(optionIcon(config, it.option));
      const body = el('div', 'card-body');
      body.append(el('div', 'card-kind', v.kind), el('div', 'card-name', v.name), el('div', 'card-desc', v.desc));
      const price = el('div', 'price');
      if (it.sold) price.append(el('span', '', 'Vendu'));
      else price.append(coinIcon(), el('span', 'num', fmt(it.price)));
      b.append(ico, body, price);
      items.append(b);
    });
    refreshAffordability(coins);
  }

  return { ...s, render, refreshAffordability };
}
