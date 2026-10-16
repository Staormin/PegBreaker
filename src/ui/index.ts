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
// - Lot 1 : `run:lost` → écran « Revanche ? » (id interne 'revive', émis 'gameover' sur le bus,
//   `#ui[data-screen=revive]`) → `sim.revive()` / `sim.giveUp()` ; `run:over` → fin de run.
//   Mode défi lu dans `location.search` (`?seed=X&goal=N`).
// - Lot 2 : F8 quotidien muté (`?daily=1`) : mutateurs `meta.dailyMods()` dans le badge HUD,
//   écran 'daily' (mutateurs, multiplicateur, série + calendrier 7 j), « Série : N jours, ×M
//   fragments » en fin de quotidien. F9 : `reward:offered.source === 'boss'` → coffre
//   (screens/reward.ts). Une reprise de sauvegarde en phase 'reward' rouvre en mode normal
//   (RunState ne mémorise pas la source de l'offre).
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
import { createRewardScreen, type RewardSource } from './screens/reward';
import { dailyModViews, streakMult, streakOf } from './dailyInfo';
import { createReviveScreen } from './screens/revive';
import type { ScreenEl, UiLocalScreen } from './screens/screen';
import { readChallenge } from './share';
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

const MODAL_RUN_SCREENS: ReadonlySet<UiLocalScreen> = new Set<UiLocalScreen>(['reward', 'shop', 'gameover', 'revive']);
/** écrans « hors run » ouverts par-dessus un autre, refermés par « Retour » */
const SUB_SCREENS: ReadonlySet<UiLocalScreen> = new Set<UiLocalScreen>(['meta', 'daily', 'settings']);

export function createUI(deps: UiDeps): UI {
  const { root, canvas, sim, bus, renderer, audio, meta, config } = deps;
  root.classList.add('pb-ui');
  registerServiceWorker();

  let screen: UiLocalScreen = 'game';
  let dragging = false;
  let lastPhase: RunPhase | null = null;
  let lastCoins = -1;


  // --- HUD + input ---------------------------------------------------------
  const isDaily = new URLSearchParams(location.search).get('daily') === '1';
  // mode défi (lien partagé) : ?seed=X&goal=N
  const challenge = readChallenge(location.search);
  const challengeGoal = challenge.goal;
  // record de vague AVANT la run (main.ts appelle meta.onRunEnd sur run:over)
  let bestWaveBefore: number | null = meta ? meta.data.stats.bestWave : null;
  /** modificateurs avec lesquels la sim courante a été créée (la sim ne relit pas la méta) */
  const createdWith = meta ? JSON.stringify(meta.getModifiers()) : '';
  const metaChanged = (): boolean => !!meta && JSON.stringify(meta.getModifiers()) !== createdWith;
  /** nouvelle run avec les modificateurs à jour : seul un rechargement recrée la sim */
  const freshRunReload = (): void => {
    meta?.setCurrentRun(null);
    location.reload();
  };
  const backStack: UiLocalScreen[] = [];
  function openSub(id: UiLocalScreen): void {
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
    dailyMods: isDaily && meta ? dailyModViews(config, meta) : [],
    challengeGoal,
    bestWave: () => bestWaveBefore,
    onNewRecord: (wave) => toasts.notice('Nouveau record', 'RECORD !', `V${wave}`, 'record'),
    isGameScreen: () => screen === 'game',
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
      if (isDaily || challengeGoal !== null) {
        location.href = location.pathname; // fin du quotidien / du défi : retour en run normale
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
    config,
    challengeGoal,
    onReplayChallenge: () => location.reload(),
    dailyStreak: meta
      ? (sum) => {
          // main.ts enregistre le résultat sur run:over ; s'il ne l'est pas encore, la partie compte
          const date = sum.dailyDate ?? meta.todayKey();
          const rec = meta.data.daily[date];
          const streak = Math.max(1, rec ? (rec.streak ?? streakOf(meta, date)) : streakOf(meta, date) + 1);
          return { streak, multiplier: streakMult(meta, streak) };
        }
      : null,
  });
  const revive = createReviveScreen({
    bus,
    config,
    meta,
    onRevive: () => {
      if (sim.state.phase !== 'gameover') return false;
      const ok = sim.revive();
      if (ok) show('game');
      return ok;
    },
    onGiveUp: () => {
      gaveUp = true;
      sim.giveUp();
    },
  });
  // premier lancement : logo + fantôme de geste par-dessus le plateau (ne bloque pas le jeu)
  const onboarding = createOnboarding(hud.el, renderer, bus, !!meta && meta.data.onboarded === false);
  const hints = createHints();
  const subScreens: ScreenEl[] = [];
  const well = meta
    ? createWellScreen({ meta, bus, config, onBack: back, onDaily: () => openSub('daily'), onRestartNow: freshRunReload })
    : null;
  const dailyScreen = meta ? createDailyScreen(meta, bus, back, config) : null;
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

  const screens: ScreenEl[] = [reward, shop, revive, gameover, ...subScreens];
  for (const s of screens) root.append(s.root);

  // focus automatique seulement pour les joueurs au clavier (sinon l'anneau de focus
  // ressemble à une recommandation sur la première carte)
  let keyboardUser = false;
  window.addEventListener('keydown', () => (keyboardUser = true), true);
  window.addEventListener('pointerdown', () => (keyboardUser = false), true);
  /** changement d'écran : fondu court (100 ms, CSS) à l'ouverture, fermeture instantanée */
  /** dernier écran annoncé sur le bus ('revive' → 'gameover' n'est pas annoncé deux fois) */
  let lastPublished: UiScreen = 'game';
  function show(next: UiLocalScreen): void {
    if (next === screen) return;
    if (screen === 'revive') revive.stop();
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
    // 'revive' n'existe pas dans UiScreen (core) : annoncé comme 'gameover'
    const pub: UiScreen = next === 'revive' ? 'gameover' : next;
    if (pub !== lastPublished) bus.emit({ type: 'ui:screen', screen: pub });
    lastPublished = pub;
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

  function openReward(options: RunState['rewardOffer'], source: RewardSource = 'wave'): void {
    if (!options) return;
    reward.open(options, source);
    // coffre de boss : pas d'indice (il trahirait le contenu d'une carte face cachée)
    if (source !== 'boss') cardHints(reward.root, options, 'data-reward-index');
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
    gameover.open(summary, bestDepthBefore, bestWaveBefore);
    show('gameover');
  }
  // --- seconde chance -------------------------------------------------------
  let lostPending = false;
  let lostTimer = 0;
  /** le joueur (ou le compte à rebours) a abandonné : run:over ouvre la fin sans délai */
  let gaveUp = false;
  function openRevive(info: { canRevive: boolean; wave: number; depth: number }): void {
    lostPending = false;
    clearTimeout(lostTimer);
    gaveUp = false;
    revive.open({ ...info, bestWave: bestWaveBefore });
    show('revive');
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
      revivesUsed: s.revivesUsed ?? 0,
      contractsCompleted: s.stats.contractsCompleted ?? 0,
    };
  }

  // --- événements ------------------------------------------------------------
  bus.on('reward:offered', (e) => openReward(e.options, e.source));
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
  bus.on('run:lost', (e) => {
    gameoverPending = false;
    clearTimeout(gameoverTimer);
    lostPending = true;
    clearTimeout(lostTimer);
    // même délai que la fin de run : le feedback de mort se joue d'abord
    lostTimer = window.setTimeout(() => {
      if (lostPending) openRevive({ canRevive: e.canRevive, wave: e.wave, depth: e.depth });
    }, GAMEOVER_DELAY_MS);
  });
  bus.on('run:revived', () => {
    lostPending = false;
    clearTimeout(lostTimer);
    gaveUp = false;
    if (screen === 'revive') show('game');
  });
  bus.on('run:over', (e) => {
    lostPending = false;
    clearTimeout(lostTimer);
    // abandon depuis « Revanche ? » : la mort a déjà été vue, pas de second délai
    if (gaveUp || screen === 'revive') openGameover(e.summary);
    else scheduleGameover(e.summary);
    gaveUp = false;
  });
  bus.on('run:started', () => {
    gameoverPending = false;
    clearTimeout(gameoverTimer);
    lostPending = false;
    clearTimeout(lostTimer);
    gaveUp = false;
    hud.reset();
    bestDepthBefore = meta ? meta.data.stats.bestDepth : null;
    bestWaveBefore = meta ? meta.data.stats.bestWave : null;
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
      else if (state.phase === 'gameover' && screen !== 'gameover' && screen !== 'revive' && !gameoverPending && !lostPending) {
        // reprise d'une run perdue en attente de décision (snapshot pris après run:lost)
        const maxRevives = config.economy.revive?.maxPerRun ?? 0;
        openRevive({ canRevive: (state.revivesUsed ?? 0) < maxRevives, wave: state.wave, depth: state.depth });
      }
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
    get screen(): UiScreen {
      return screen === 'revive' ? 'gameover' : screen;
    },
    update,
  };
}
