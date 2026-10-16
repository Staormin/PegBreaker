// =====================================================================
// ui/index.ts — propriétaire : ui-dev.
//
//   createUI(deps: UiDeps): UI
//
// - `root` : l'overlay #ui (pointer-events:none ; seuls les éléments interactifs les réactivent).
// - `canvas` : #game ; reçoit l'input drag-to-aim (pointer events) et sert de cadre au HUD.
// - `renderer.screenToBoard(px, py)` reçoit des px CSS relatifs au coin haut-gauche du canvas.
// - Les écrans sont créés une fois et montrés/cachés par la classe `.visible`.
// - Tout clic de bouton émet `ui:click` ; tout changement d'écran émet `ui:screen`.
// - Les écrans suivent les événements (`reward:offered`, `shop:opened`, `run:over`...) et, en
//   secours (reprise d'une sauvegarde), la phase de `RunState` lue dans `update`.
// =====================================================================
import './styles.css';
import type { EventBus } from '../core/events';
import type { AudioSystem, GameConfig, MetaSystem, RewardOption, RunPhase, RunState, RunSummary, Renderer, Sim, UI, UiScreen } from '../core/types';
import { createHud } from './hud';
import { createHints } from './hints';
import { createInput } from './input';
import { createOnboarding } from './onboarding';
import { registerServiceWorker } from './pwa';
import { createGameoverScreen } from './screens/gameover';
import { createDailyScreen } from './screens/daily';
import { createRewardScreen } from './screens/reward';
import type { ScreenEl } from './screens/screen';
import { createSettingsScreen } from './screens/settings';
import { createShopScreen } from './screens/shop';
import { createToasts } from './screens/toasts';
import { createWellScreen } from './screens/well';

export interface UiDeps {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  sim: Sim;
  bus: EventBus;
  renderer: Renderer;
  audio: AudioSystem | null;
  meta: MetaSystem | null;
  config: GameConfig;
}

const MODAL_RUN_SCREENS: ReadonlySet<UiScreen> = new Set<UiScreen>(['reward', 'shop', 'gameover']);
/** écrans « hors run » ouverts par-dessus un autre, refermés par « Retour » */
const SUB_SCREENS: ReadonlySet<UiScreen> = new Set<UiScreen>(['meta', 'daily', 'settings']);

export function createUI(deps: UiDeps): UI {
  const { root, canvas, sim, bus, renderer, audio, meta, config } = deps;
  root.classList.add('pb-ui');
  registerServiceWorker();

  let screen: UiScreen = 'game';
  let dragging = false;
  let lastPhase: RunPhase | null = null;
  let lastCoins = -1;


  // --- HUD + input ---------------------------------------------------------
  const isDaily = new URLSearchParams(location.search).get('daily') === '1';
  /** modificateurs avec lesquels la sim courante a été créée (la sim ne relit pas la méta) */
  const createdWith = meta ? JSON.stringify(meta.getModifiers()) : '';
  const metaChanged = (): boolean => !!meta && JSON.stringify(meta.getModifiers()) !== createdWith;
  /** nouvelle run avec les modificateurs à jour : seul un rechargement recrée la sim */
  const freshRunReload = (): void => {
    meta?.setCurrentRun(null);
    location.reload();
  };
  const backStack: UiScreen[] = [];
  function openSub(id: UiScreen): void {
    if (!SUB_SCREENS.has(screen)) backStack.length = 0;
    if (screen !== id) backStack.push(screen);
    show(id);
  }
  function back(): void {
    let prev = backStack.pop();
    while (prev !== undefined && prev === screen) prev = backStack.pop();
    show(prev ?? (sim.state.phase === 'gameover' ? 'gameover' : 'game'));
  }

  if (meta) {
    audio?.setSfxVolume(meta.data.settings.sfx);
    audio?.setMusicVolume(meta.data.settings.music);
  }

  const hud = createHud({
    root,
    canvas,
    sim,
    bus,
    config,
    renderer,
    onWell: meta ? () => openSub('meta') : null,
    onSettings: meta ? () => openSub('settings') : null,
    isDaily,
  });
  createInput({
    canvas,
    sim,
    renderer,
    audio,
    isGameScreen: () => screen === 'game' || screen === 'title',
    onDragChange: (d) => {
      dragging = d;
    },
  });

  // --- écrans ----------------------------------------------------------------
  const reward = createRewardScreen(sim, bus, config);
  const shop = createShopScreen(sim, bus, config);
  const gameover = createGameoverScreen({
    bus,
    onRestart: () => {
      if (isDaily) {
        location.href = './'; // fin du défi : retour en run normale
        return;
      }
      if (metaChanged()) {
        freshRunReload();
        return;
      }
      sim.restart();
      show('game');
    },
    onWell: meta ? () => openSub('meta') : null,
    onDaily: meta ? () => openSub('daily') : null,
  });
  // premier lancement : logo + fantôme de geste par-dessus le plateau (ne bloque pas le jeu)
  const onboarding = createOnboarding(hud.el, renderer, bus, !!meta && meta.data.onboarded === false);
  const hints = createHints();
  const subScreens: ScreenEl[] = [];
  const well = meta
    ? createWellScreen({ meta, bus, config, onBack: back, onDaily: () => openSub('daily'), onRestartNow: freshRunReload })
    : null;
  const dailyScreen = meta ? createDailyScreen(meta, bus, back) : null;
  const settingsScreen = meta
    ? createSettingsScreen(meta, bus, audio, back, () => {
        // abandon : nouvelle run (mêmes modificateurs méta que la sim courante)
        meta.setCurrentRun(null);
        sim.restart();
        show('game');
      })
    : null;
  if (well) subScreens.push(well);
  if (dailyScreen) subScreens.push(dailyScreen);
  if (settingsScreen) subScreens.push(settingsScreen);
  const toasts = createToasts(root);

  const screens: ScreenEl[] = [reward, shop, gameover, ...subScreens];
  for (const s of screens) root.append(s.root);

  // focus automatique seulement pour les joueurs au clavier (sinon l'anneau de focus
  // ressemble à une recommandation sur la première carte)
  let keyboardUser = false;
  window.addEventListener('keydown', () => (keyboardUser = true), true);
  window.addEventListener('pointerdown', () => (keyboardUser = false), true);
  /** changement d'écran : fondu court (100 ms, CSS) à l'ouverture, fermeture instantanée */
  function show(next: UiScreen): void {
    if (next === screen) return;
    screen = next;
    if (next === 'title') onboarding.showLogo();
    for (const s of screens) s.root.classList.toggle('visible', s.id === next);
    root.dataset.screen = next;
    if (next === 'game') hud.layout();
    if (next === 'meta') well?.refresh(true);
    else if (next === 'daily') dailyScreen?.refresh(true);
    else if (next === 'settings') settingsScreen?.refresh(true);
    // focus clavier sur le premier bouton de l'écran modal
    const visible = screens.find((s) => s.id === next);
    if (visible && keyboardUser) {
      const first = visible.root.querySelector<HTMLElement>('button:not([disabled])') ?? visible.root;
      setTimeout(() => first.focus({ preventScroll: true }), 0);
    }
    bus.emit({ type: 'ui:screen', screen: next });
  }
  root.dataset.screen = screen;

  /** indices one-shot sur les cartes (récompense ou boutique) */
  function cardHints(container: HTMLElement, options: readonly RewardOption[], attr: string): void {
    const ballIdx = options.findIndex((o) => o.kind === 'ball');
    if (attr === 'data-reward-index' && ballIdx >= 0 && hints.take('reward')) {
      const card = container.querySelector<HTMLElement>(`[${attr}="${ballIdx}"]`);
      if (card) {
        const ping = document.createElement('span');
        ping.className = 'hint-ping';
        ping.setAttribute('aria-hidden', 'true');
        card.append(ping);
        setTimeout(() => ping.remove(), 2000 + 400);
      }
    }
    const fuseIdx = options.findIndex((o) => o.kind === 'fuse');
    if (fuseIdx >= 0 && hints.take('fuse')) {
      const icon = container.querySelector<HTMLElement>(`[${attr}="${fuseIdx}"] .card-icon`);
      if (icon) {
        icon.classList.add('hint-pulse');
        setTimeout(() => icon.classList.remove('hint-pulse'), 2400);
      }
    }
  }

  function openReward(options: RunState['rewardOffer']): void {
    if (!options) return;
    reward.open(options);
    cardHints(reward.root, options, 'data-reward-index');
    show('reward');
  }
  function openShop(): void {
    const st = sim.state.shop;
    if (!st) return;
    shop.render(st, sim.state.coins);
    cardHints(shop.root, st.items.map((i) => i.option), 'data-shop-index');
    lastCoins = sim.state.coins;
    show('shop');
  }
  // record de profondeur AVANT la run (main.ts appelle meta.onRunEnd sur run:over)
  let bestDepthBefore: number | null = meta ? meta.data.stats.bestDepth : null;
  /** l'écran de fin attend la fin du feedback de mort */
  const GAMEOVER_DELAY_MS = 700;
  let gameoverTimer = 0;
  let gameoverPending = false;
  function openGameover(summary: RunSummary): void {
    gameoverPending = false;
    clearTimeout(gameoverTimer);
    gameover.open(summary, bestDepthBefore);
    show('gameover');
  }
  function scheduleGameover(summary: RunSummary): void {
    gameoverPending = true;
    clearTimeout(gameoverTimer);
    gameoverTimer = window.setTimeout(() => {
      if (gameoverPending) openGameover(summary);
    }, GAMEOVER_DELAY_MS);
  }
  function summaryFromState(s: Readonly<RunState>): RunSummary {
    return {
      seed: s.seed,
      depth: s.depth,
      wave: s.wave,
      stats: { ...s.stats },
      relics: [...s.relics],
      volley: s.volley.map((b) => ({ ...b })),
      isDaily: false,
      dailyDate: null,
      score: 0,
    };
  }

  // --- événements ------------------------------------------------------------
  bus.on('reward:offered', (e) => openReward(e.options));
  bus.on('reward:chosen', () => {
    if (screen === 'reward') show('game');
  });
  bus.on('reward:skipped', () => {
    if (screen === 'reward') show('game');
  });
  bus.on('shop:opened', (e) => {
    shop.render(e.shop, sim.state.coins);
    cardHints(shop.root, e.shop.items.map((i) => i.option), 'data-shop-index');
    lastCoins = sim.state.coins;
    show('shop');
  });
  const refreshShop = (): void => {
    const st = sim.state.shop;
    if (st) shop.render(st, sim.state.coins);
    lastCoins = sim.state.coins;
  };
  bus.on('shop:bought', refreshShop);
  bus.on('shop:rerolled', refreshShop);
  bus.on('shop:left', () => {
    if (screen === 'shop') show('game');
  });
  bus.on('run:over', (e) => scheduleGameover(e.summary));
  bus.on('run:started', () => {
    gameoverPending = false;
    clearTimeout(gameoverTimer);
    hud.reset();
    bestDepthBefore = meta ? meta.data.stats.bestDepth : null;
    if (screen !== 'title') show('game');
  });

  // onboarding validé au premier tir réussi
  bus.on('volley:start', () => {
    if (meta && !meta.data.onboarded) meta.setOnboarded();
  });
  bus.on('combo:milestone', (e) => {
    if (hints.take('combo')) hud.comboHint(e.combo);
  });
  bus.on('achievement:unlocked', (e) => {
    const def = config.meta.achievements.find((a) => a.id === e.achievementId);
    toasts.achievement(def?.name ?? e.achievementId, def?.rewardFragments ?? 0);
  });

  // --- premier geste de la session : déverrouille l'audio -------------------
  // le premier geste ferme aussi le logo (screen 'title' → 'game') sans bloquer la visée
  window.addEventListener(
    'pointerdown',
    () => {
      if (screen === 'title') show('game');
    },
    true,
  );
  const unlockOnce = (): void => {
    audio?.unlock();
    window.removeEventListener('pointerdown', unlockOnce, true);
  };
  window.addEventListener('pointerdown', unlockOnce, true);

  // --- cadre du HUD calé sur le canvas -------------------------------------
  const relayout = (): void => {
    hud.layout();
    onboarding.relayout();
  };
  window.addEventListener('resize', relayout);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(relayout).observe(canvas);
  requestAnimationFrame(relayout);

  // pas d'écran titre bloquant : le jeu est visible et jouable dès le chargement

  function update(state: Readonly<RunState>): void {
    // secours : écran cohérent avec la phase (reprise de run, événement manqué)
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      if (state.phase === 'reward' && screen !== 'reward') openReward(state.rewardOffer);
      else if (state.phase === 'shop' && screen !== 'shop') openShop();
      else if (state.phase === 'gameover' && screen !== 'gameover' && !gameoverPending) scheduleGameover(summaryFromState(state));
      else if ((state.phase === 'aiming' || state.phase === 'firing') && MODAL_RUN_SCREENS.has(screen)) show('game');
    }
    // écrans méta : reconstruits seulement si meta.data a changé de référence
    if (screen === 'meta') well?.refresh();
    else if (screen === 'daily') dailyScreen?.refresh();
    else if (screen === 'settings') settingsScreen?.refresh();
    if (screen === 'shop' && state.coins !== lastCoins) {
      lastCoins = state.coins;
      shop.refreshAffordability(state.coins);
    }
    if (screen === 'settings') settingsScreen?.tick(state);
    hud.update(state);
    onboarding.update(state, (screen === 'game' || screen === 'title') && !dragging);
  }

  return {
    show,
    get screen() {
      return screen;
    },
    update,
  };
}
