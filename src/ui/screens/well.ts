// ui/screens/well.ts — « Le Puits » (ui:screen 'meta') : arbre à 3 branches, mods de run, succès.
// Colonnes à partir de 720 px, onglets en dessous. Reconstruit seulement si meta.data change.
// Arsenal (27 balles) : une entrée par élément dans l'ordre de config.balls.defs, grille 2 colonnes
// (mobile) / 3 (desktop), filtre par famille (`.well-filter[data-family]`, aria-pressed ; un
// second appui retire le filtre). Un élément débloqué par un succès (`AchievementDef.unlocksElement`)
// est un nœud `.node[data-unlock="achievement"]` qui affiche « Succès : <nom> » au lieu d'un coût.
// Les nœuds hors élément (reliques) suivent ; ils sont masqués quand un filtre est actif.
// Codex (docs/HYBRIDS.md) : onglet `.pane-codex`, une `.codex-entry[data-element][data-known]`
// par hybride + la Divine ; connue (`meta.data.codex`) → parents, nom, description, effet ;
// sinon « ? + ? → ??? » et la famille des parents en indice. Compteur `.codex-count`.
import type { EventBus } from '../../core/events';
import type { AchievementDef, BallElement, BallFamily, GameConfig, MetaNode, MetaSystem, SaveData } from '../../core/types';
import { availableRunMods, effectiveFragmentMultiplier, nextCost } from '../../systems';
import { button, clip, el, fmt } from '../dom';
import { ballIcon, BASE_FAMILIES, elementTable, FAMILY_LABELS, familyIcon, type ElementInfo } from '../elements';
import { codexEntries, ownEffect, recipeHint, recipeLabel } from '../hybrids';
import { createScreen, type ScreenEl } from './screen';

export type WellPane = 'arsenal' | 'foundations' | 'depth' | 'achievements' | 'codex';
type Pane = WellPane;
const PANES: { id: Pane; label: string }[] = [
  { id: 'arsenal', label: 'Arsenal' },
  { id: 'foundations', label: 'Fondations' },
  { id: 'depth', label: 'Profondeur' },
  { id: 'achievements', label: 'Succès' },
  { id: 'codex', label: 'Codex' },
];

export interface WellScreen extends ScreenEl {
  /** reconstruit si `meta.data` a changé de référence (ou si `force`) */
  refresh(force?: boolean): void;
  /** une modification méta a eu lieu depuis la création de la sim (run en cours non concernée) */
  readonly dirty: boolean;
  /** onglet actif (mobile) ; sur grand écran, amène la section en vue */
  select(pane: WellPane): void;
}

export interface WellDeps {
  meta: MetaSystem;
  bus: EventBus;
  config: GameConfig;
  onBack: () => void;
  onDaily: () => void;
  /** « Recommencer maintenant » : nouvelle run avec les nouveaux modificateurs */
  onRestartNow: () => void;
}

const fmtMult = (m: number): string => `×${String(Math.round(m * 100) / 100).replace('.', ',')}`;

export function createWellScreen(d: WellDeps): WellScreen {
  const { meta, bus, config } = d;
  const s = createScreen('meta', 'Le Puits');

  const wallet = el('div', 'wallet wallet-frag');
  const walletVal = el('span', 'num', '0');
  const ico = el('span', 'ico-frag', '◆');
  ico.setAttribute('aria-hidden', 'true');
  wallet.append(ico, walletVal);
  wallet.setAttribute('aria-label', 'Fragments');

  const note = el('p', 'muted note', 'Appliqué à la prochaine descente');
  const restartBox = el('div', 'banner');
  restartBox.append(el('span', '', 'Nouveaux pouvoirs prêts.'), button(bus, 'btn btn-primary', 'Recommencer maintenant', d.onRestartNow));
  restartBox.hidden = true;

  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const panesBox = el('div', 'well-panes');
  const paneEls = new Map<Pane, HTMLDivElement>();
  const tabEls = new Map<Pane, HTMLButtonElement>();
  let active: Pane = 'arsenal';
  const setActive = (p: Pane): void => {
    active = p;
    for (const [id, e] of paneEls) e.classList.toggle('active', id === p);
    for (const [id, b] of tabEls) b.setAttribute('aria-selected', String(id === p));
  };
  for (const p of PANES) {
    const t = button(bus, 'tab', p.label, () => setActive(p.id));
    t.setAttribute('role', 'tab');
    tabEls.set(p.id, t);
    tabs.append(t);
    const pane = el('div', `pane pane-${p.id}`);
    pane.append(el('h3', 'pane-title', p.label));
    pane.append(el('div', 'pane-body'));
    paneEls.set(p.id, pane);
    panesBox.append(pane);
  }
  setActive('arsenal');

  // --- filtre par famille (Arsenal) : créé une fois, survit aux reconstructions -----------
  const elements = elementTable(config);
  let filter: BallFamily | null = null;
  const filters = el('div', 'well-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Filtrer par famille');
  const filterBtns = new Map<BallFamily, HTMLButtonElement>();
  for (const f of BASE_FAMILIES) {
    const b = button(bus, 'well-filter', '', () => {
      filter = filter === f ? null : f;
      applyFilter();
    });
    b.dataset.family = f;
    b.setAttribute('aria-pressed', 'false');
    b.title = FAMILY_LABELS[f];
    b.append(familyIcon(f, 20), el('span', 'wf-label', FAMILY_LABELS[f]));
    filterBtns.set(f, b);
    filters.append(b);
  }
  const arsenalPane = paneEls.get('arsenal')!;
  arsenalPane.querySelector('.pane-body')!.classList.add('arsenal-grid');
  arsenalPane.insertBefore(filters, arsenalPane.querySelector('.pane-body'));
  function applyFilter(): void {
    for (const [f, b] of filterBtns) b.setAttribute('aria-pressed', String(f === filter));
    arsenalPane.dataset.filter = filter ?? '';
    for (const c of Array.from(body('arsenal').children) as HTMLElement[]) {
      c.hidden = filter !== null && c.dataset.family !== filter;
    }
  }

  const actions = el('div', 'actions');
  actions.append(button(bus, 'btn btn-ghost', '📅 Défi du jour', d.onDaily), button(bus, 'btn btn-primary', '← Retour', d.onBack));
  s.panel.classList.add('panel-wide');
  s.panel.append(wallet, note, restartBox, tabs, panesBox, actions);

  const createdWith = JSON.stringify(meta.getModifiers());
  let lastRef: Readonly<SaveData> | null = null;
  let dirty = false;

  function body(p: Pane): HTMLElement {
    return paneEls.get(p)!.querySelector('.pane-body') as HTMLElement;
  }

  function nodeName(id: string): string {
    return config.meta.nodes.find((n) => n.id === id)?.name ?? id;
  }

  /** icône de balle du nœud (estompée tant que l'élément n'est pas débloqué) */
  function elIcon(info: ElementInfo, owned: boolean): SVGSVGElement {
    const ico = ballIcon(config, info.id, 1, 28);
    ico.classList.add('node-ico');
    ico.classList.toggle('owned', owned);
    return ico;
  }

  /** élément débloqué par un succès : pas de coût, « Succès : <nom> » */
  function achievementCard(info: ElementInfo, a: AchievementDef, data: Readonly<SaveData>): HTMLElement {
    const owned = data.meta.unlockedElements.includes(info.id) || data.achievements.includes(a.id);
    const card = el('div', owned ? 'node maxed' : 'node ach-locked');
    card.dataset.unlock = 'achievement';
    card.dataset.element = info.id;
    card.dataset.family = info.family;
    card.dataset.achievement = a.id;
    const head = el('div', 'node-head');
    head.append(elIcon(info, owned), el('span', 'node-name', info.name));
    card.append(head, el('div', 'node-desc', info.desc));
    if (owned) card.append(el('div', 'node-state ok', '✓ Débloquée'));
    else {
      const st = el('div', 'node-state node-ach');
      st.append(el('span', 'na-ico', '🏆'), el('span', 'na-name', `Succès : ${a.name}`));
      st.title = a.description;
      card.append(st);
      card.setAttribute('aria-label', `${info.name}, verrouillée : succès ${a.name} (${a.description})`);
    }
    return card;
  }

  function nodeCard(n: MetaNode, data: Readonly<SaveData>, info?: ElementInfo): HTMLElement {
    const lvl = data.meta.nodes[n.id] ?? 0;
    const max = n.costs.length;
    const cost = nextCost(n, lvl);
    const missing = n.requires.filter((r) => (data.meta.nodes[r] ?? 0) < 1);
    const card = el('div', 'node');
    card.dataset.nodeId = n.id;
    const head = el('div', 'node-head');
    if (info) {
      card.dataset.element = info.id;
      card.dataset.family = info.family;
      card.dataset.unlock = 'fragments';
      head.append(elIcon(info, lvl > 0 || data.meta.unlockedElements.includes(info.id)));
    }
    head.append(el('span', 'node-name', n.name), el('span', 'num node-lvl', `${lvl}/${max}`));
    // élément : la mécanique (≤ 60 car.) ; le texte du nœud reste en titre
    const desc = el('div', 'node-desc', info?.desc || clip(n.description));
    if (info) desc.title = n.description;
    card.append(head, desc);

    if (cost === null) {
      card.classList.add('maxed');
      card.append(el('div', 'node-state ok', '✓ Max'));
    } else if (missing.length > 0) {
      card.classList.add('locked');
      card.append(el('div', 'node-state', `🔒 Requiert ${missing.map(nodeName).join(', ')}`));
    } else {
      const afford = data.meta.fragments >= cost;
      const b = button(bus, afford ? 'btn btn-buy' : 'btn btn-buy poor', '', () => {
        if (meta.buyNode(n.id)) {
          bus.emit({ type: 'meta:unlocked', nodeId: n.id });
          refresh();
        }
      });
      b.dataset.action = 'buy-node';
      b.append(el('span', 'buy-verb', lvl === 0 ? 'Débloquer' : 'Améliorer'), el('span', 'ico-frag', '◆'), el('span', 'num', fmt(cost)));
      b.disabled = !afford;
      b.setAttribute('aria-label', `${lvl === 0 ? 'Débloquer' : 'Améliorer'} ${n.name}, ${cost} fragments`);
      if (!afford) card.classList.add('poor');
      card.append(b);
    }

    // mod de run disponible : interrupteur
    const modMatch = /^runMod:(\w+)$/.exec(n.effect);
    if (modMatch && lvl > 0) {
      const id = modMatch[1]!;
      const def = config.meta.runMods.find((m) => m.id === id);
      if (def && availableRunMods(data.meta, config).includes(id)) {
        const on = data.meta.activeRunMods.includes(id);
        const sw = button(bus, on ? 'switch on' : 'switch', '', () => {
          meta.toggleRunMod(id);
          refresh();
        });
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(on));
        sw.dataset.action = 'toggle-mod';
        sw.append(el('span', 'switch-track'), el('span', 'switch-label', 'Activer pour la prochaine run'), el('span', 'num switch-mult', `◆ ${fmtMult(def.fragmentMultiplier)}`));
        card.append(sw);
      }
    }
    return card;
  }

  function render(data: Readonly<SaveData>): void {
    walletVal.textContent = fmt(data.meta.fragments);
    for (const p of ['foundations', 'depth'] as const) {
      const b = body(p);
      b.textContent = '';
      for (const n of config.meta.nodes) if (n.branch === p) b.append(nodeCard(n, data));
    }
    renderArsenal(data);
    // multiplicateur effectif de la prochaine run
    const mult = effectiveFragmentMultiplier(meta.getModifiers(), config);
    body('depth').prepend(el('div', 'pane-info', `Fragments prochaine run : ${fmtMult(mult)}`));

    const ach = body('achievements');
    ach.textContent = '';
    const got = new Set(data.achievements);
    let n = 0;
    const list = el('div', 'ach-list');
    for (const a of config.meta.achievements) {
      const ok = got.has(a.id);
      if (ok) n++;
      const row = el('div', ok ? 'ach done' : 'ach');
      row.append(
        el('span', 'ach-ico', ok ? '✓' : '🔒'),
        el('span', 'ach-text'),
        el('span', 'num ach-reward', `+${a.rewardFragments} ◆`),
      );
      const t = row.querySelector('.ach-text')!;
      t.append(el('span', 'ach-name', a.name), el('span', 'ach-desc', a.description));
      if (a.unlocksElement) t.append(el('span', 'ach-unlock', `Débloque la balle ${elements.get(a.unlocksElement).name}`));
      row.setAttribute('aria-label', `${a.name}, ${ok ? 'débloqué' : 'verrouillé'}, ${a.rewardFragments} fragments`);
      list.append(row);
    }
    ach.append(el('div', 'pane-info', `${n}/${config.meta.achievements.length} débloqués`), list);
    renderCodex(data);

    dirty = JSON.stringify(meta.getModifiers()) !== createdWith;
    restartBox.hidden = !dirty;
  }

  /** une entrée par élément (ordre du JSON), puis les nœuds Arsenal restants (reliques...) */
  function renderArsenal(data: Readonly<SaveData>): void {
    const b = body('arsenal');
    b.textContent = '';
    const used = new Set<string>();
    const arsenal = config.meta.nodes.filter((n) => n.branch === 'arsenal');
    for (const info of elements.list) {
      const ach = config.meta.achievements.find((a) => a.unlocksElement === info.id);
      const node = arsenal.find((n) => n.effect === `unlockElement:${info.id}`);
      if (node) used.add(node.id);
      if (ach) b.append(achievementCard(info, ach, data));
      else if (node) b.append(nodeCard(node, data, info));
      // sinon : élément de départ (pierre), pas de nœud
    }
    for (const n of arsenal) if (!used.has(n.id)) b.append(nodeCard(n, data));
    applyFilter();
  }

  /** codex : recettes découvertes en clair, les autres en « ? + ? → ??? » */
  function renderCodex(data: Readonly<SaveData>): void {
    const b = body('codex');
    b.textContent = '';
    const known = new Set<BallElement>(data.codex ?? []);
    const ids = codexEntries(config);
    const found = ids.filter((id) => known.has(id)).length;
    const count = el('div', 'pane-info codex-count', `${found} / ${ids.length} découvertes`);
    const grid = el('div', 'codex-grid');
    grid.setAttribute('role', 'list');
    for (const id of ids) grid.append(codexEntry(id, known.has(id)));
    b.append(count, el('p', 'muted codex-help', 'Forge deux balles de rang III en boutique pour révéler une recette.'), grid);
  }

  function codexEntry(id: BallElement, known: boolean): HTMLElement {
    const info = elements.get(id);
    const divine = info.family === 'divine';
    const card = el('div', `codex-entry${divine ? ' codex-divine' : ''}`);
    card.setAttribute('role', 'listitem');
    card.dataset.element = id;
    card.dataset.known = String(known);
    card.style.setProperty('--c', info.color);
    const formula = el('div', 'codex-formula');
    formula.setAttribute('aria-hidden', 'true');
    if (known) {
      if (info.recipe) formula.append(ballIcon(config, info.recipe[0], 3, 28), el('span', 'fr-op', '+'), ballIcon(config, info.recipe[1], 3, 28));
      else formula.append(el('span', 'codex-q', 'Hybride III'), el('span', 'fr-op', '+'), el('span', 'codex-q', 'Hybride III'));
      formula.append(el('span', 'fr-op fr-arrow', '→'), ballIcon(config, id, 1, 36));
      const text = el('div', 'codex-text');
      text.append(
        el('div', 'codex-name', divine ? `✦ ${info.name}` : info.name),
        el('div', 'codex-recipe', recipeLabel(config, id)),
        el('div', 'codex-desc', info.desc),
        el('div', 'forge-effect', ownEffect(config, id, 1)),
      );
      card.append(formula, text);
      card.setAttribute('aria-label', `${info.name} : ${recipeLabel(config, id)}. ${info.desc}`);
    } else {
      formula.append(el('span', 'codex-q', '?'), el('span', 'fr-op', '+'), el('span', 'codex-q', '?'), el('span', 'fr-op fr-arrow', '→'), el('span', 'codex-q', '???'));
      const text = el('div', 'codex-text');
      const hint = recipeHint(config, id);
      text.append(el('div', 'codex-name', divine ? '✦ ???' : '???'), el('div', 'codex-hint', `Indice : ${hint}`));
      card.append(formula, text);
      card.setAttribute('aria-label', `Recette inconnue, indice : ${hint}`);
    }
    return card;
  }

  function select(p: WellPane): void {
    setActive(p);
    const pane = paneEls.get(p);
    // grand écran : onglets masqués, toutes les sections visibles → on amène la section en vue
    if (pane && typeof pane.scrollIntoView === 'function' && getComputedStyle(tabs).display === 'none') {
      requestAnimationFrame(() => pane.scrollIntoView({ block: 'start' }));
    }
  }

  function refresh(force = false): void {
    const data = meta.data;
    if (!force && data === lastRef) return;
    lastRef = data;
    render(data);
  }

  return {
    ...s,
    refresh,
    select,
    get dirty() {
      return dirty;
    },
  };
}
