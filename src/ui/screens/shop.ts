// ui/screens/shop.ts — boutique (spécification visuelle : docs/SHOP-UI.md).
// « On regarde des objets, on ne lit pas des lignes. » Aucune infobulle native (`title`) : tout passe
// par le panneau détail ; `aria-label` sur les tuiles, cartes et rangées.
//
// Structure (créée une fois, contenu via textContent) :
//   .panel
//     header.shop-head            « Boutique · vague N » + `.wallet .num`
//     .shop-main                  ≥ 900 px : deux colonnes ; sinon une colonne défilante
//       .shop-col-left            articles (`.shop-buy`) puis forge (`.shop-forge`)
//       .shop-col-right           « Ta volée » (`.shop-volley` : `.volley-grid` de tuiles) + `.volley-detail`
//     .actions                    Reroll / Continuer (index.ts l'enveloppe dans `.screen-footer`, hors flux défilant)
//   < 900 px : `.volley-detail` est déplacé hors de `.shop-main` (collant en bas, au-dessus du pied).
//
// Sélecteurs :
// - Articles : `button.shop-item[data-shop-index]` (`[data-catalyst="true"]` pour un catalyseur, `.card-icon`).
// - Tuiles : `button.volley-tile[data-element][data-tier][data-count][data-selected][data-volley-index]`
//   (alias historiques `.volley-group.volley-chip`), une par groupe (élément, rang).
// - Détail : `.volley-detail` ; boutons `[data-action="sell"][data-volley-index]`,
//   `[data-action="sell-all"][data-element][data-tier]` (si N ≥ 2), `[data-action="upgrade"][data-volley-index]`
//   (hybride < III), `[data-action="forge-with"]` (surligne la rangée de forge correspondante).
// - Forge : `button.forge-option[data-action="forge"][data-i][data-j][data-result]` (`.forge-divine`),
//   vide → `.forge-empty` + `[data-action="open-codex"]`.
// - Pied : `[data-action="reroll"]`, `[data-action="leave-shop"]`.
import type { EventBus } from '../../core/events';
import type { BallElement, BallTier, GameConfig, ShopState, Sim, VolleyBall } from '../../core/types';
import { button, coinIcon, el, fmt } from '../dom';
import { ballIcon, elementTable, FAMILY_SINGULAR } from '../elements';
import { catalystRecipe, ownEffect } from '../hybrids';
import { describeOption, optionIcon } from '../options';
import { dedupForge, detailActions, groupKey, pickSelection, roman, shopGroups, type ForgeOpt, type ShopGroup } from '../shopModel';
import { createScreen, type ScreenEl } from './screen';

export interface ShopScreen extends ScreenEl {
  /** (re)construit les articles, la volée et la forge depuis l'état de la boutique */
  render(shop: Readonly<ShopState>, coins: number): void;
  /** met à jour uniquement l'accessibilité des achats (coins changés) */
  refreshAffordability(coins: number): void;
  /** fondu (120 ms) sur la tuile de la balle forgée, qui devient la sélection */
  flashForged(result: BallElement): void;
}

const FLASH_MS = 120;
const WIDE = '(min-width: 900px)';

export function createShopScreen(sim: Sim, bus: EventBus, config: GameConfig, onCodex: (() => void) | null = null): ShopScreen {
  const s = createScreen('shop', 'Boutique');
  const elements = elementTable(config);

  // --- en-tête -----------------------------------------------------------------------------
  const head = el('header', 'shop-head');
  const heading = s.panel.querySelector<HTMLElement>('.screen-heading');
  const waveLabel = el('span', 'shop-wave', '');
  const wallet = el('div', 'wallet');
  const walletVal = el('span', 'num', '0');
  wallet.append(coinIcon(), walletVal);
  wallet.setAttribute('aria-label', 'Pièces');
  wallet.setAttribute('aria-live', 'polite');
  const titleBox = el('div', 'shop-title');
  if (heading) titleBox.append(heading);
  titleBox.append(waveLabel);
  head.append(titleBox, wallet);

  // --- articles ----------------------------------------------------------------------------
  const items = el('div', 'shop-items');
  const buySec = el('section', 'shop-section shop-buy');
  buySec.append(el('h3', 'shop-section-title', 'Articles'), items);

  // --- forge -------------------------------------------------------------------------------
  const forgeSec = el('section', 'shop-section shop-forge');
  const forgeList = el('div', 'forge-list');
  const forgeFoot = el('div', 'forge-foot');
  const forgeEmpty = el('p', 'forge-empty', `Combine deux balles d'une recette (rang II + rang I)${onCodex ? ' · ' : ''}`);
  const codexLink = button(bus, 'btn-link', 'Voir les recettes', () => onCodex?.());
  codexLink.dataset.action = 'open-codex';
  codexLink.hidden = !onCodex;
  forgeFoot.append(forgeEmpty, codexLink);
  forgeSec.append(el('h3', 'shop-section-title', 'Forge'), forgeList, forgeFoot);

  // --- volée + détail ----------------------------------------------------------------------
  const volleySec = el('section', 'shop-section shop-volley');
  const volleyHead = el('h3', 'shop-section-title', 'Ta volée');
  const grid = el('div', 'volley-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Ta volée');
  volleySec.append(volleyHead, grid);

  const detail = el('div', 'volley-detail');
  detail.setAttribute('aria-live', 'polite');
  const dIcon = el('div', 'vd-icon');
  const dText = el('div', 'vd-text');
  const dName = el('div', 'vd-name');
  const dNameMain = el('span', 'vd-title', '');
  const dRank = el('span', 'vd-rank', '');
  const dCount = el('span', 'vd-count num', '');
  dName.append(dNameMain, dRank, dCount);
  const dFamily = el('div', 'vd-family', '');
  const dDesc = el('div', 'vd-desc', '');
  const dEffect = el('div', 'vd-effect', '');
  const dNote = el('div', 'vd-note', '');
  dText.append(dName, dFamily, dDesc, dEffect, dNote);
  const dActions = el('div', 'vd-actions');
  detail.append(dIcon, dText, dActions);

  const colLeft = el('div', 'shop-col shop-col-left');
  colLeft.append(buySec, forgeSec);
  const colRight = el('div', 'shop-col shop-col-right');
  colRight.append(volleySec, detail);
  const main = el('div', 'shop-main');
  main.append(colLeft, colRight);

  // --- pied --------------------------------------------------------------------------------
  const actions = el('div', 'actions');
  const reroll = button(bus, 'btn btn-ghost', '', () => sim.reroll());
  reroll.dataset.action = 'reroll';
  const rerollCost = el('span', 'num', '0');
  reroll.append(el('span', '', '↻ Reroll '), coinIcon(), rerollCost);
  const leave = button(bus, 'btn btn-primary', 'Continuer ▶', () => sim.leaveShop());
  leave.dataset.action = 'leave-shop';
  actions.append(reroll, leave);
  s.panel.append(head, main, actions);

  // < 900 px : le détail sort de la zone défilante (collant au-dessus du pied)
  const mq = typeof matchMedia === 'function' ? matchMedia(WIDE) : null;
  const placeDetail = (): void => {
    if (!mq || mq.matches) colRight.append(detail);
    else main.after(detail);
  };
  placeDetail();
  mq?.addEventListener('change', placeDetail);

  // --- état local --------------------------------------------------------------------------
  let current: Readonly<ShopState> | null = null;
  let cost = 0;
  let groups: ShopGroup[] = [];
  let forgeOpts: ForgeOpt[] = [];
  let selKey: string | null = null;
  let selPos = 0;
  let highlight: string | null = null;
  /** vague du dernier rendu : une nouvelle boutique repart de la première tuile */
  let shownWave = -1;
  /** nombre de reconstructions : une action ne reconstruit que si l'événement ne l'a pas déjà fait */
  let renders = 0;

  function act(fn: () => boolean): void {
    const before = renders;
    if (fn() && renders === before) rerender();
  }
  function rerender(): void {
    const st = sim.state.shop;
    if (st) render(st, sim.state.coins);
  }
  const coins = (): number => sim.state.coins;

  /** « +12 » ou « 120 » avec la pièce, en ligne de valeur d'un bouton à deux étages */
  function value(text: string): HTMLElement {
    const v = el('span', 'da-val');
    v.append(coinIcon(), el('span', 'num', text));
    return v;
  }
  function actionBtn(cls: string, verb: string, val: HTMLElement | string, aria: string, fn: () => void): HTMLButtonElement {
    const b = button(bus, `da-btn ${cls}`, '', fn, aria);
    b.append(el('span', 'da-verb', verb), typeof val === 'string' ? el('span', 'da-val', val) : val);
    return b;
  }

  // --- articles ----------------------------------------------------------------------------
  function renderItems(shop: Readonly<ShopState>): void {
    items.textContent = '';
    shop.items.forEach((it, i) => {
      const v = describeOption(config, it.option);
      const b = button(bus, `shop-item shop-item-${it.option.kind}`, '', () => sim.buy(i));
      b.dataset.shopIndex = String(i);
      b.style.setProperty('--c', v.color);
      let aria = `${v.name}, ${it.sold ? 'vendu' : `${it.price} pièces`} : ${v.desc}`;
      const top = el('div', 'si-top');
      const ico = el('div', 'card-icon');
      ico.append(optionIcon(config, it.option));
      const price = el('div', 'si-price');
      if (!it.sold) price.append(coinIcon(), el('span', 'num', fmt(it.price)));
      top.append(ico, price);
      const name = el('div', 'si-name', v.name);
      const desc = el('div', 'si-desc', v.desc);
      b.append(top, name, desc);
      if (it.catalyst) {
        b.dataset.catalyst = 'true';
        b.prepend(el('div', 'si-ribbon', '⚒ Catalyseur'));
        const rec = it.option.kind === 'ball' || it.option.kind === 'fuse' ? catalystRecipe(config, it.option.element, sim.state.volley) : null;
        if (rec) {
          const res = elements.get(rec.result).name;
          b.append(el('div', 'si-catalyst', `→ ${res}`));
          aria = `Catalyseur : ${aria}. Avec ${elements.get(rec.partner).name}, forge ${res}`;
        }
      }
      b.append(el('span', 'si-cta', it.sold ? 'Vendu' : 'Acheter'));
      b.setAttribute('aria-label', aria);
      items.append(b);
    });
  }

  // --- tuiles ------------------------------------------------------------------------------
  function tileLabel(g: Readonly<ShopGroup>): string {
    const n = g.indices.length;
    return `${elements.get(g.element).name}, rang ${roman(g.tier)}${n > 1 ? `, ×${n}` : ''}`;
  }
  function tile(g: Readonly<ShopGroup>, k: number, selected: boolean): HTMLButtonElement {
    const info = elements.get(g.element);
    const n = g.indices.length;
    const t = button(bus, 'volley-tile volley-group volley-chip', '', () => select(k));
    t.dataset.element = g.element;
    t.dataset.tier = String(g.tier);
    t.dataset.count = String(n);
    t.dataset.family = g.family;
    t.dataset.volleyIndex = String(g.indices[0] ?? 0);
    t.dataset.selected = String(selected);
    t.setAttribute('aria-pressed', String(selected));
    t.setAttribute('aria-label', tileLabel(g));
    t.style.setProperty('--c', info.color);
    if (info.colors) {
      t.style.setProperty('--ca', info.colors[0]);
      t.style.setProperty('--cb', info.colors[1]);
    }
    t.append(ballIcon(config, g.element, 1, 34));
    if (n >= 2) t.append(el('span', 'vt-count num', `×${n}`));
    const pips = el('span', 'vt-pips');
    pips.setAttribute('aria-hidden', 'true');
    for (let p = 0; p < g.tier; p++) pips.append(el('i'));
    t.append(pips);
    return t;
  }
  /** mini-tuile statique (rangées de forge) */
  function miniTile(e: BallElement, tier: BallTier, cls = ''): HTMLElement {
    const info = elements.get(e);
    const m = el('span', `mini-tile ${cls}`.trim());
    m.dataset.family = info.family;
    m.style.setProperty('--c', info.color);
    if (info.colors) {
      m.style.setProperty('--ca', info.colors[0]);
      m.style.setProperty('--cb', info.colors[1]);
    }
    m.append(ballIcon(config, e, 1, 26));
    const pips = el('span', 'vt-pips');
    for (let p = 0; p < tier; p++) pips.append(el('i'));
    m.append(pips);
    return m;
  }

  function renderVolley(volley: readonly Readonly<VolleyBall>[]): void {
    groups = shopGroups(config, volley);
    const k = pickSelection(groups, selKey, selPos);
    const g = groups[k];
    selPos = Math.max(0, k);
    selKey = g ? groupKey(g) : null;
    volleyHead.textContent = `Ta volée · ${volley.length}`;
    grid.textContent = '';
    groups.forEach((x, i) => grid.append(tile(x, i, i === k)));
    renderDetail();
  }

  function select(k: number): void {
    const g = groups[k];
    if (!g) return;
    selPos = k;
    selKey = groupKey(g);
    highlight = null;
    grid.querySelectorAll<HTMLElement>('.volley-tile').forEach((t, i) => {
      t.dataset.selected = String(i === k);
      t.setAttribute('aria-pressed', String(i === k));
    });
    renderDetail();
    applyHighlight();
  }

  // --- détail ------------------------------------------------------------------------------
  function renderDetail(): void {
    const g = groups[selPos];
    dActions.textContent = '';
    dIcon.textContent = '';
    detail.hidden = !g;
    if (!g) return;
    const info = elements.get(g.element);
    const n = g.indices.length;
    const volley = sim.state.volley;
    detail.dataset.element = g.element;
    detail.dataset.tier = String(g.tier);
    detail.dataset.family = g.family;
    detail.style.setProperty('--c', info.color);
    dIcon.append(ballIcon(config, g.element, g.tier, 56));
    dNameMain.textContent = info.name;
    dRank.textContent = `rang ${roman(g.tier)}`;
    dCount.textContent = n > 1 ? `×${n}` : '';
    const recipe = info.recipe ? ` · ${elements.get(info.recipe[0]).name} + ${elements.get(info.recipe[1]).name}` : '';
    dFamily.textContent = `${FAMILY_SINGULAR[info.family]}${recipe}`;
    dDesc.textContent = info.desc;
    const forged = g.family === 'hybrid' || g.family === 'divine';
    dEffect.textContent = forged ? ownEffect(config, g.element, g.tier) : '';
    dEffect.hidden = !forged;
    detail.classList.toggle('has-effect', forged);

    const a = detailActions(config, g, volley, forgeOpts);
    const sell = actionBtn(
      'da-sell',
      'Vendre',
      value(`+${fmt(a.sell.gain)}`),
      a.sell.disabled ? `${info.name} : dernière balle, invendable` : `Vendre 1 ${info.name} rang ${g.tier}, +${a.sell.gain} pièces`,
      () => act(() => sim.sell(a.sell.index) > 0),
    );
    sell.dataset.action = 'sell';
    sell.dataset.volleyIndex = String(a.sell.index);
    sell.disabled = a.sell.disabled;
    dActions.append(sell);
    if (a.sellAll) {
      const sa = a.sellAll;
      const all = actionBtn(
        'da-sell-all',
        sa.all ? 'Vendre tout' : `Vendre ${sa.count}`,
        value(`+${fmt(sa.gain)}`),
        `Vendre ${sa.count} ${info.name} rang ${g.tier}, +${sa.gain} pièces${sa.all ? '' : ' (la dernière balle reste)'}`,
        () => act(() => sellAll(g)),
      );
      all.dataset.action = 'sell-all';
      all.dataset.element = g.element;
      all.dataset.tier = String(g.tier);
      all.dataset.count = String(sa.count);
      dActions.append(all);
    }
    if (a.upgrade) {
      const up = a.upgrade;
      const ub = actionBtn(
        'da-upgrade',
        `Rang ${roman((g.tier + 1) as BallTier)}`,
        value(fmt(up.cost)),
        `Monter 1 ${info.name} au rang ${g.tier + 1}, ${up.cost} pièces : ${ownEffect(config, g.element, (g.tier + 1) as BallTier)}`,
        () =>
          act(() => {
            selKey = groupKey({ element: g.element, tier: (g.tier + 1) as BallTier });
            return sim.upgrade(up.index);
          }),
      );
      ub.dataset.action = 'upgrade';
      ub.dataset.volleyIndex = String(up.index);
      ub.dataset.cost = String(up.cost);
      dActions.append(ub);
    }
    if (a.forgeWith) {
      const fw = a.forgeWith;
      const partner = elements.get(fw.partner).name;
      const fb = actionBtn('da-forge', 'Forger avec', partner, `Forger avec ${partner} : voir la rangée de forge`, () => {
        highlight = fw.option.result;
        applyHighlight(true);
      });
      fb.dataset.action = 'forge-with';
      fb.dataset.result = fw.option.result;
      dActions.append(fb);
    }
    dNote.textContent = a.sell.disabled ? 'Dernière balle : la volée ne peut pas être vide' : '';
    dNote.hidden = !a.sell.disabled;
    refreshCosts(coins());
  }

  /** vend les balles du groupe depuis le dernier index, en laissant toujours ≥ 1 balle */
  function sellAll(g: Readonly<ShopGroup>): boolean {
    let sold = false;
    for (let k = g.indices.length - 1; k >= 0; k--) {
      const idx = g.indices[k];
      if (idx === undefined) continue;
      const v = sim.state.volley;
      if (v.length <= 1) break;
      const b = v[idx];
      if (!b || b.element !== g.element || b.tier !== g.tier) continue;
      if (sim.sell(idx) > 0) sold = true;
    }
    return sold;
  }

  // --- forge -------------------------------------------------------------------------------
  function forgeRow(o: ForgeOpt): HTMLButtonElement {
    const v = sim.state.volley;
    const a = v[o.i];
    const b = v[o.j];
    const res = elements.get(o.result);
    const divine = res.family === 'divine';
    const row = button(bus, divine ? 'forge-option forge-divine' : 'forge-option', '', () => act(() => sim.forge(o.i, o.j)));
    row.dataset.action = 'forge';
    row.dataset.i = String(o.i);
    row.dataset.j = String(o.j);
    row.dataset.result = o.result;
    row.dataset.cost = String(o.cost);
    row.style.setProperty('--c', res.color);
    const recipe = el('span', 'fo-recipe');
    recipe.setAttribute('aria-hidden', 'true');
    if (a) recipe.append(miniTile(a.element, a.tier));
    recipe.append(el('span', 'fo-op', '+'));
    if (b) recipe.append(miniTile(b.element, b.tier));
    recipe.append(el('span', 'fo-op', '→'), miniTile(o.result, 1, 'fo-result'));
    const body = el('span', 'fo-body');
    const effect = ownEffect(config, o.result, 1);
    body.append(el('span', 'fo-name', res.name), el('span', 'fo-effect', effect));
    const price = el('span', 'fo-price');
    price.append(coinIcon(), el('span', 'num', fmt(o.cost)));
    row.append(recipe, body, price, el('span', 'fo-cta', 'Forger'));
    const an = a ? elements.get(a.element).name : '?';
    const bn = b ? elements.get(b.element).name : '?';
    row.setAttribute('aria-label', `Forger ${an} + ${bn} en ${res.name}, ${o.cost} pièces : ${effect}`);
    return row;
  }

  function renderForge(): void {
    forgeList.textContent = '';
    forgeOpts = typeof sim.forgeOptions === 'function' ? dedupForge(sim.state.volley, sim.forgeOptions()) : [];
    for (const o of forgeOpts) forgeList.append(forgeRow(o));
    forgeList.hidden = forgeOpts.length === 0;
    forgeFoot.hidden = forgeOpts.length > 0;
  }

  function applyHighlight(reveal = false): void {
    let target: HTMLElement | null = null;
    forgeList.querySelectorAll<HTMLElement>('.forge-option').forEach((r) => {
      const on = highlight !== null && r.dataset.result === highlight;
      r.classList.toggle('hl', on);
      if (on && !target) target = r;
    });
    const t = target as HTMLElement | null;
    if (reveal && t && typeof t.scrollIntoView === 'function') t.scrollIntoView({ block: 'nearest' });
  }

  // --- coûts -------------------------------------------------------------------------------
  function refreshCosts(c: number): void {
    s.panel.querySelectorAll<HTMLButtonElement>('button[data-action="forge"], button[data-action="upgrade"]').forEach((b) => {
      const poor = c < Number(b.dataset.cost);
      b.disabled = poor;
      b.classList.toggle('poor', poor);
    });
  }

  function refreshAffordability(c: number): void {
    walletVal.textContent = fmt(c);
    if (current) {
      items.querySelectorAll<HTMLButtonElement>('button[data-shop-index]').forEach((b) => {
        const it = current?.items[Number(b.dataset.shopIndex)];
        if (!it) return;
        b.disabled = it.sold || c < it.price;
        b.classList.toggle('sold', it.sold);
        b.classList.toggle('poor', !it.sold && c < it.price);
      });
    }
    refreshCosts(c);
    reroll.disabled = c < cost;
  }

  function render(shop: Readonly<ShopState>, c: number): void {
    renders++;
    if (sim.state.wave !== shownWave) {
      shownWave = sim.state.wave;
      selKey = null;
      selPos = 0;
      highlight = null;
    }
    current = shop;
    cost = shop.rerollCost;
    rerollCost.textContent = fmt(cost);
    waveLabel.textContent = `vague ${sim.state.wave}`;
    reroll.setAttribute('aria-label', `Reroll, ${cost} pièces`);
    renderItems(shop);
    renderForge();
    renderVolley(sim.state.volley);
    applyHighlight();
    refreshAffordability(c);
  }

  function flashForged(result: BallElement): void {
    const k = groups.findIndex((g) => g.element === result && g.tier === 1);
    const idx = k >= 0 ? k : groups.findIndex((g) => g.element === result);
    if (idx < 0) return;
    select(idx);
    const t = grid.querySelectorAll<HTMLElement>('.volley-tile')[idx];
    if (!t) return;
    t.classList.remove('flash');
    void t.offsetWidth; // relance l'animation
    t.classList.add('flash');
    setTimeout(() => t.classList.remove('flash'), FLASH_MS + 40);
  }

  return { ...s, render, refreshAffordability, flashForged };
}
