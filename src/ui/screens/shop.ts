// ui/screens/shop.ts — boutique : articles + prix, reroll, « Continuer », et (docs/HYBRIDS.md) :
// - « Ta volée » : un chip par balle (`.volley-chip[data-volley-index]`), bouton
//   `[data-action="sell"][data-volley-index]` « Vendre +N » (désactivé pour la dernière balle) ;
//   sur une hybride de rang < III : `[data-action="upgrade"][data-volley-index]` « Rang +1 (N) ».
// - « Forge » : `sim.forgeOptions()` → `.forge-option[data-action="forge"][data-i][data-j]`
//   (parents → hybride, nom, description, effet propre, coût ; `.forge-divine` pour la Divine),
//   grisée (`.poor`, disabled) si pièces < coût ; liste vide → `.forge-empty` + lien
//   `[data-action="open-codex"]` « Voir les recettes ».
// Après chaque action, l'écran est reconstruit depuis `sim.state` (les index de la volée changent).
import type { EventBus } from '../../core/events';
import type { BallElement, GameConfig, ShopState, Sim, VolleyBall } from '../../core/types';
import { button, coinIcon, el, fmt } from '../dom';
import { ballIcon, elementTable } from '../elements';
import { catalystRecipe, ownEffect, sellPrice, upgradeCost } from '../hybrids';
import { describeOption, optionIcon } from '../options';
import { createScreen, type ScreenEl } from './screen';

export interface ShopScreen extends ScreenEl {
  /** (re)construit les articles, la volée et la forge depuis l'état de la boutique */
  render(shop: Readonly<ShopState>, coins: number): void;
  /** met à jour uniquement l'accessibilité des achats (coins changés) */
  refreshAffordability(coins: number): void;
  /** flash (fondu 120 ms) sur la balle forgée dans « Ta volée » */
  flashForged(result: BallElement): void;
}

type ForgeOption = { i: number; j: number; result: BallElement; cost: number };

const RANK: Record<1 | 2 | 3, string> = { 1: 'I', 2: 'II', 3: 'III' };
const FLASH_MS = 160;

export function createShopScreen(sim: Sim, bus: EventBus, config: GameConfig, onCodex: (() => void) | null = null): ShopScreen {
  const s = createScreen('shop', 'Boutique');
  const elements = elementTable(config);
  const wallet = el('div', 'wallet');
  const walletVal = el('span', 'num', '0');
  wallet.append(coinIcon(), walletVal);
  wallet.setAttribute('aria-label', 'Pièces');
  wallet.setAttribute('aria-live', 'polite');
  const items = el('div', 'shop-items');

  // --- Ta volée ---------------------------------------------------------------
  const volleySec = el('section', 'shop-section shop-volley');
  const volleyHead = el('h3', 'shop-section-title', 'Ta volée');
  const volleyList = el('div', 'volley-list');
  volleyList.setAttribute('role', 'list');
  volleySec.append(volleyHead, volleyList);

  // --- Forge ------------------------------------------------------------------
  const forgeSec = el('section', 'shop-section shop-forge');
  const forgeHead = el('h3', 'shop-section-title', '⚒ Forge');
  const forgeList = el('div', 'forge-list');
  const forgeEmpty = el('p', 'forge-empty muted', "Forge : rien à combiner (il faut deux balles de rang III d'une recette)");
  const codexLink = button(bus, 'btn-link', 'Voir les recettes', () => onCodex?.());
  codexLink.dataset.action = 'open-codex';
  codexLink.hidden = !onCodex;
  const forgeFoot = el('div', 'forge-foot');
  forgeFoot.append(forgeEmpty, codexLink);
  forgeSec.append(forgeHead, forgeList, forgeFoot);

  const actions = el('div', 'actions');
  const reroll = button(bus, 'btn btn-ghost', '', () => sim.reroll());
  reroll.dataset.action = 'reroll';
  const rerollLabel = el('span', '', '↻ Reroll ');
  const rerollCost = el('span', 'num', '0');
  reroll.append(rerollLabel, coinIcon(), rerollCost);
  const leave = button(bus, 'btn btn-primary', 'Continuer', () => sim.leaveShop());
  leave.dataset.action = 'leave-shop';
  actions.append(reroll, leave);
  s.panel.append(wallet, items, volleySec, forgeSec, actions);

  let current: Readonly<ShopState> | null = null;
  let cost = 0;

  /** nombre de reconstructions : une action ne reconstruit que si l'événement ne l'a pas déjà fait */
  let renders = 0;
  /** exécute une action de la sim puis reconstruit si besoin (la sim peut n'émettre l'événement
   *  qu'au pas suivant ; s'il est émis tout de suite, index.ts a déjà reconstruit et flashé) */
  function act(fn: () => boolean): void {
    const before = renders;
    if (fn() && renders === before) rerender();
  }
  function rerender(): void {
    const st = sim.state.shop;
    if (st) render(st, sim.state.coins);
  }

  function refreshAffordability(coins: number): void {
    walletVal.textContent = fmt(coins);
    if (current) {
      const btns = items.querySelectorAll<HTMLButtonElement>('button[data-shop-index]');
      btns.forEach((b) => {
        const it = current?.items[Number(b.dataset.shopIndex)];
        if (!it) return;
        const off = it.sold || coins < it.price;
        b.disabled = off;
        b.classList.toggle('sold', it.sold);
        b.classList.toggle('poor', !it.sold && coins < it.price);
      });
    }
    // forge et upgrades : coût porté par data-cost
    s.panel.querySelectorAll<HTMLButtonElement>('button[data-action="forge"], button[data-action="upgrade"]').forEach((b) => {
      const poor = coins < Number(b.dataset.cost);
      b.disabled = poor;
      b.classList.toggle('poor', poor);
    });
    reroll.disabled = coins < cost;
  }

  function renderItems(shop: Readonly<ShopState>): void {
    items.textContent = '';
    shop.items.forEach((it, i) => {
      const v = describeOption(config, it.option);
      const b = button(bus, `card shop-item card-${it.option.kind}`, '', () => sim.buy(i));
      b.dataset.shopIndex = String(i);
      b.style.setProperty('--c', v.color);
      b.setAttribute('aria-label', `${v.name}, ${it.sold ? 'vendu' : `${it.price} pièces`} : ${v.desc}`);
      const ico = el('div', 'card-icon');
      ico.append(optionIcon(config, it.option));
      const body = el('div', 'card-body');
      body.append(el('div', 'card-kind', v.kind), el('div', 'card-name', v.name), el('div', 'card-desc', v.desc));
      // catalyseur de forge : partenaire manquant d'une recette (`.shop-item[data-catalyst="true"]`)
      if (it.catalyst) {
        b.dataset.catalyst = 'true';
        body.prepend(el('div', 'catalyst-tag', '⚒ Catalyseur'));
        const rec = it.option.kind === 'ball' || it.option.kind === 'fuse' ? catalystRecipe(config, it.option.element, sim.state.volley) : null;
        if (rec) {
          const line = `Partenaire de ${elements.get(rec.partner).name} → ${elements.get(rec.result).name}`;
          body.append(el('div', 'catalyst-line', line));
          b.setAttribute('aria-label', `Catalyseur : ${b.getAttribute('aria-label') ?? ''}. ${line}`);
        }
      }
      const price = el('div', 'price');
      if (it.sold) price.append(el('span', '', 'Vendu'));
      else price.append(coinIcon(), el('span', 'num', fmt(it.price)));
      b.append(ico, body, price);
      items.append(b);
    });
  }

  function volleyChip(b: Readonly<VolleyBall>, index: number, last: boolean): HTMLElement {
    const info = elements.get(b.element);
    const chip = el('div', 'volley-chip');
    chip.setAttribute('role', 'listitem');
    chip.dataset.volleyIndex = String(index);
    chip.dataset.element = b.element;
    chip.dataset.family = info.family;
    chip.dataset.tier = String(b.tier);
    chip.style.setProperty('--c', info.color);
    const head = el('div', 'vc-head');
    const label = el('div', 'vc-label');
    label.append(el('span', 'vc-name', info.name), el('span', 'vc-rank', `Rang ${RANK[b.tier]}`));
    head.append(ballIcon(config, b.element, b.tier, 32), label);
    chip.title = info.desc;
    const btns = el('div', 'vc-actions');
    const gain = sellPrice(config, b);
    const sell = button(bus, 'btn-mini btn-sell', '', () => {
      act(() => sim.sell(index) > 0);
    });
    sell.dataset.action = 'sell';
    sell.dataset.volleyIndex = String(index);
    sell.append(el('span', '', 'Vendre '), el('span', 'num', `+${fmt(gain)}`), coinIcon());
    sell.disabled = last;
    sell.setAttribute('aria-label', last ? `${info.name} rang ${b.tier} : dernière balle, invendable` : `Vendre ${info.name} rang ${b.tier}, +${gain} pièces`);
    if (last) sell.title = 'Impossible de vendre la dernière balle';
    btns.append(sell);
    const up = upgradeCost(config, b);
    if (up !== null) {
      const ub = button(bus, 'btn-mini btn-upgrade', '', () => {
        act(() => sim.upgrade(index));
      });
      ub.dataset.action = 'upgrade';
      ub.dataset.volleyIndex = String(index);
      ub.dataset.cost = String(up);
      const price = el('span', 'up-cost');
      price.append(el('span', '', '('), el('span', 'num', fmt(up)), coinIcon(), el('span', '', ')'));
      ub.append(el('span', '', 'Rang +1'), price);
      ub.setAttribute('aria-label', `Monter ${info.name} au rang ${b.tier + 1}, ${up} pièces : ${ownEffect(config, b.element, (b.tier + 1) as 2 | 3)}`);
      btns.append(ub);
    }
    chip.append(head, btns);
    return chip;
  }

  function renderVolley(volley: readonly Readonly<VolleyBall>[]): void {
    volleyList.textContent = '';
    volleyHead.textContent = `Ta volée · ${volley.length} balle${volley.length > 1 ? 's' : ''}`;
    // ordre : rang décroissant puis ordre du JSON (index d'origine conservés pour les actions)
    const order = volley.map((b, i) => ({ b, i })).sort((x, y) => y.b.tier - x.b.tier || elements.index(x.b.element) - elements.index(y.b.element) || x.i - y.i);
    const last = volley.length <= 1;
    for (const { b, i } of order) volleyList.append(volleyChip(b, i, last));
  }

  function forgeOptions(): ForgeOption[] {
    if (typeof sim.forgeOptions !== 'function') return [];
    const seen = new Set<string>();
    const out: ForgeOption[] = [];
    const v = sim.state.volley;
    for (const o of sim.forgeOptions()) {
      const a = v[o.i];
      const b = v[o.j];
      if (!a || !b) continue;
      // une carte par paire d'éléments (3 × Feu III + Glace III ne donnent qu'une ligne)
      const key = [a.element, b.element].sort().join('+');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(o);
    }
    return out;
  }

  function forgeCard(o: ForgeOption): HTMLButtonElement {
    const v = sim.state.volley;
    const a = v[o.i];
    const b = v[o.j];
    const res = elements.get(o.result);
    const divine = res.family === 'divine';
    const card = button(bus, divine ? 'card forge-option forge-divine' : 'card forge-option', '', () => {
      act(() => sim.forge(o.i, o.j));
    });
    card.dataset.action = 'forge';
    card.dataset.i = String(o.i);
    card.dataset.j = String(o.j);
    card.dataset.result = o.result;
    card.dataset.cost = String(o.cost);
    card.style.setProperty('--c', res.color);
    const recipe = el('div', 'forge-recipe');
    recipe.setAttribute('aria-hidden', 'true');
    if (a) recipe.append(ballIcon(config, a.element, a.tier, 30));
    recipe.append(el('span', 'fr-op', '+'));
    if (b) recipe.append(ballIcon(config, b.element, b.tier, 30));
    recipe.append(el('span', 'fr-op fr-arrow', '→'));
    const out = ballIcon(config, o.result, 1, 40);
    out.classList.add('fr-result');
    recipe.append(out);
    const body = el('div', 'card-body');
    const an = a ? elements.get(a.element).name : '?';
    const bn = b ? elements.get(b.element).name : '?';
    const effect = ownEffect(config, o.result, 1);
    body.append(
      el('div', 'card-kind', divine ? '✦ Divine' : `Hybride · ${an} + ${bn}`),
      el('div', 'card-name', res.name),
      el('div', 'card-desc', res.desc),
      el('div', 'forge-effect', effect),
    );
    const price = el('div', 'price');
    price.append(coinIcon(), el('span', 'num', fmt(o.cost)));
    card.append(recipe, body, price);
    card.setAttribute('aria-label', `Forger ${an} + ${bn} en ${res.name}, ${o.cost} pièces : ${res.desc}. ${effect}`);
    return card;
  }

  function renderForge(): void {
    forgeList.textContent = '';
    const opts = forgeOptions();
    for (const o of opts) forgeList.append(forgeCard(o));
    forgeEmpty.hidden = opts.length > 0;
    forgeList.hidden = opts.length === 0;
  }

  function render(shop: Readonly<ShopState>, coins: number): void {
    renders++;
    current = shop;
    cost = shop.rerollCost;
    rerollCost.textContent = fmt(cost);
    reroll.setAttribute('aria-label', `Reroll, ${cost} pièces`);
    renderItems(shop);
    renderVolley(sim.state.volley);
    renderForge();
    refreshAffordability(coins);
  }

  function flashForged(result: BallElement): void {
    const chips = volleyList.querySelectorAll<HTMLElement>(`.volley-chip[data-element="${result}"]`);
    // la plus récente : rang I de préférence (une hybride forgée arrive au rang I)
    let target: HTMLElement | null = null;
    chips.forEach((c) => {
      if (!target || c.dataset.tier === '1') target = c;
    });
    const t = target as HTMLElement | null;
    if (!t) return;
    t.classList.remove('flash');
    void t.offsetWidth; // relance l'animation
    t.classList.add('flash');
    setTimeout(() => t.classList.remove('flash'), FLASH_MS);
  }

  return { ...s, render, refreshAffordability, flashForged };
}
