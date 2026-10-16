// ui/screens/well.ts — « Le Puits » (ui:screen 'meta') : arbre à 3 branches, mods de run, succès.
// Colonnes à partir de 720 px, onglets en dessous. Reconstruit seulement si meta.data change.
import type { EventBus } from '../../core/events';
import type { GameConfig, MetaNode, MetaSystem, SaveData } from '../../core/types';
import { availableRunMods, effectiveFragmentMultiplier, nextCost } from '../../systems';
import { button, el, fmt } from '../dom';
import { ballColor } from '../options';
import { createScreen, type ScreenEl } from './screen';

type Pane = 'arsenal' | 'foundations' | 'depth' | 'achievements';
const PANES: { id: Pane; label: string }[] = [
  { id: 'arsenal', label: 'Arsenal' },
  { id: 'foundations', label: 'Fondations' },
  { id: 'depth', label: 'Profondeur' },
  { id: 'achievements', label: 'Succès' },
];

export interface WellScreen extends ScreenEl {
  /** reconstruit si `meta.data` a changé de référence (ou si `force`) */
  refresh(force?: boolean): void;
  /** une modification méta a eu lieu depuis la création de la sim (run en cours non concernée) */
  readonly dirty: boolean;
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

  function nodeCard(n: MetaNode, data: Readonly<SaveData>): HTMLElement {
    const lvl = data.meta.nodes[n.id] ?? 0;
    const max = n.costs.length;
    const cost = nextCost(n, lvl);
    const missing = n.requires.filter((r) => (data.meta.nodes[r] ?? 0) < 1);
    const card = el('div', 'node');
    card.dataset.nodeId = n.id;
    const head = el('div', 'node-head');
    const elMatch = /^unlockElement:(\w+)$/.exec(n.effect);
    if (elMatch) {
      const dot = el('span', lvl > 0 ? 'node-dot owned' : 'node-dot');
      dot.style.setProperty('--c', ballColor(config, elMatch[1] as Parameters<typeof ballColor>[1]));
      dot.setAttribute('aria-hidden', 'true');
      head.append(dot);
    }
    head.append(el('span', 'node-name', n.name), el('span', 'num node-lvl', `${lvl}/${max}`));
    card.append(head, el('div', 'node-desc', n.description));

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
      b.append(el('span', '', lvl === 0 ? 'Débloquer' : 'Améliorer'), el('span', 'ico-frag', '◆'), el('span', 'num', fmt(cost)));
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
    for (const p of ['arsenal', 'foundations', 'depth'] as const) {
      const b = body(p);
      b.textContent = '';
      for (const n of config.meta.nodes) if (n.branch === p) b.append(nodeCard(n, data));
    }
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
      row.setAttribute('aria-label', `${a.name}, ${ok ? 'débloqué' : 'verrouillé'}, ${a.rewardFragments} fragments`);
      list.append(row);
    }
    ach.append(el('div', 'pane-info', `${n}/${config.meta.achievements.length} débloqués`), list);

    dirty = JSON.stringify(meta.getModifiers()) !== createdWith;
    restartBox.hidden = !dirty;
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
    get dirty() {
      return dirty;
    },
  };
}
