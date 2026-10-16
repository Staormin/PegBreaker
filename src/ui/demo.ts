// ui/demo.ts — banc d'essai de l'UI sans la vraie sim ni le vrai renderer.
// Usage : `npm run dev` puis ouvrir /src/ui/demo.html (page de dev, hors build).
// Sim factice : état modifiable, actions qui loguent et changent la phase, événements émis
// directement sur le bus. Renderer factice : screenToBoard = identité (unités = px CSS du canvas).
import { createEventBus } from '../core/events';
import { loadConfig } from '../core/config';
import type {
  AudioSystem,
  BallElement,
  GameEvent,
  MetaSystem,
  Renderer,
  RewardOption,
  RunState,
  RunSummary,
  ShopItem,
  Sim,
  Vec2,
} from '../core/types';
import { createMeta, createMemoryStorage } from '../systems';
import { createUI } from './index';

const ELEMENTS: BallElement[] = ['stone', 'fire', 'lightning', 'ice', 'ghost', 'lead', 'split'];

function freshState(launch: Vec2): RunState {
  return {
    seed: 'demo',
    phase: 'aiming',
    wave: 1,
    shotInWave: 0,
    rowsLeftInWave: 5,
    depth: 0,
    hp: 5,
    maxHp: 5,
    coins: 0,
    volley: [
      { element: 'stone', tier: 1 },
      { element: 'stone', tier: 1 },
      { element: 'stone', tier: 1 },
    ],
    balls: [],
    blocks: [],
    drops: [],
    relics: [],
    launchPos: { ...launch },
    aimDir: null,
    currentShotDamage: 0,
    currentShotCombo: 0,
    rewardOffer: null,
    shop: null,
    pendingLaunches: 0,
    advanceProgress: 0,
    stats: {
      shots: 0,
      blocksDestroyed: 0,
      perfectWaves: 0,
      bestCombo: 0,
      bestShotDamage: 0,
      totalDamage: 0,
      coinsEarned: 0,
      fragmentsEarned: 0,
      fusions: 0,
      bossesKilled: 0,
      durationMs: 0,
    },
    rngState: 1,
    recallSpeed: 1,
  };
}

export function mountUiDemo(root: HTMLElement, canvas: HTMLCanvasElement): void {
  const config = loadConfig();
  const bus = createEventBus();
  const log = (...a: unknown[]): void => console.log('[ui-demo]', ...a);
  bus.onAny((e: GameEvent) => {
    if (e.type !== 'ui:click') log('event', e.type, e);
  });

  // --- canvas factice ------------------------------------------------------
  const W = 420;
  const H = 640;
  const ctx = canvas.getContext('2d');
  function sizeCanvas(): void {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    const cw = Math.floor(W * scale);
    const ch = Math.floor(H * scale);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.launchPos.x = cw / 2;
    state.launchPos.y = ch - 70;
  }

  let state = freshState({ x: W / 2, y: H - 70 });
  let firingMs = 0;
  let volleyMs = 2600;
  let milestones = 0;
  let rerolls = 0;

  function randomOption(i: number): RewardOption {
    const r = (i * 7 + state.stats.shots * 3 + rerolls) % 6;
    const el = ELEMENTS[(i + state.wave + rerolls) % ELEMENTS.length] ?? 'stone';
    const relic = config.relics.defs[(i + state.wave + rerolls) % config.relics.defs.length];
    if (r === 0 && relic) return { kind: 'relic', relicId: relic.id };
    if (r === 1) return { kind: 'heal', amount: 2 };
    if (r === 2) return { kind: 'coins', amount: 25 };
    if (r === 3) return { kind: 'fuse', element: el, tier: i % 2 === 0 ? 2 : 3 };
    return { kind: 'ball', element: el, tier: ((i % 3) + 1) as 1 | 2 | 3 };
  }
  function makeShopItems(): ShopItem[] {
    const out: ShopItem[] = [];
    for (let i = 0; i < config.economy.shop.itemCount; i++) {
      const option = randomOption(i + 1);
      const price =
        option.kind === 'relic' ? config.economy.shop.prices.relicByRarity.rare : option.kind === 'heal' ? config.economy.shop.prices.heal : config.economy.shop.prices.ball;
      out.push({ option, price, sold: false });
    }
    return out;
  }
  function endVolley(): void {
    if (state.phase !== 'firing') return;
    state.phase = 'aiming';
    state.aimDir = null;
    state.depth++;
    state.stats.bestShotDamage = Math.max(state.stats.bestShotDamage, state.currentShotDamage);
    bus.emit({ type: 'volley:end', shotDamage: state.currentShotDamage, bestCombo: state.currentShotCombo });
  }

  const sim: Sim = {
    get state() {
      return state;
    },
    config,
    step() {
      return [];
    },
    aim(dir) {
      const l = Math.hypot(dir.x, dir.y) || 1;
      state.aimDir = { x: dir.x / l, y: Math.min(dir.y / l, -0.1) };
    },
    cancelAim() {
      log('cancelAim');
      state.aimDir = null;
    },
    fire() {
      if (state.phase !== 'aiming' || !state.aimDir) return;
      log('fire', state.aimDir);
      state.phase = 'firing';
      state.stats.shots++;
      state.currentShotDamage = 0;
      state.currentShotCombo = 0;
      state.recallSpeed = 1;
      firingMs = 0;
      volleyMs = 2600;
      milestones = 0;
      bus.emit({ type: 'volley:start', count: state.volley.length, from: { ...state.launchPos }, dir: { ...state.aimDir } });
    },
    recall() {
      if (state.phase !== 'firing') return;
      log('recall');
      state.recallSpeed = config.blocks.board.recallSpeed;
      volleyMs = Math.min(volleyMs, firingMs + 400);
    },
    chooseReward(i) {
      const o = state.rewardOffer?.[i];
      log('chooseReward', i, o);
      if (!o) return;
      if (o.kind === 'ball') state.volley.push({ element: o.element, tier: o.tier });
      else if (o.kind === 'coins') state.coins += o.amount;
      else if (o.kind === 'heal') state.hp = Math.min(state.maxHp, state.hp + o.amount);
      else if (o.kind === 'relic') state.relics.push(o.relicId);
      else {
        const prev = (o.tier - 1) as 1 | 2;
        const i1 = state.volley.findIndex((b) => b.element === o.element && b.tier === prev);
        if (i1 >= 0) state.volley.splice(i1, 1);
        const i2 = state.volley.findIndex((b) => b.element === o.element && b.tier === prev);
        if (i2 >= 0) state.volley.splice(i2, 1, { element: o.element, tier: o.tier });
      }
      state.rewardOffer = null;
      state.phase = 'aiming';
      bus.emit({ type: 'reward:chosen', option: o });
    },
    skipReward() {
      log('skipReward');
      state.coins += config.economy.reward.skipCoins;
      state.rewardOffer = null;
      state.phase = 'aiming';
      bus.emit({ type: 'reward:skipped' });
    },
    buy(i) {
      const it = state.shop?.items[i];
      log('buy', i, it);
      if (!it || it.sold || state.coins < it.price) return;
      state.coins -= it.price;
      it.sold = true;
      bus.emit({ type: 'shop:bought', item: { ...it } });
    },
    reroll() {
      const shop = state.shop;
      if (!shop || state.coins < shop.rerollCost) return;
      log('reroll');
      state.coins -= shop.rerollCost;
      rerolls++;
      const cost = shop.rerollCost;
      shop.items = makeShopItems();
      shop.rerollsUsed++;
      shop.rerollCost += config.economy.shop.rerollGrowth;
      bus.emit({ type: 'shop:rerolled', cost });
    },
    leaveShop() {
      log('leaveShop');
      state.shop = null;
      state.phase = 'aiming';
      bus.emit({ type: 'shop:left' });
    },
    restart(seed) {
      log('restart', seed);
      const lp = state.launchPos;
      state = freshState(lp);
      bus.emit({ type: 'run:started', seed: seed ?? 'demo' });
    },
    preview(dir) {
      return [{ ...state.launchPos }, { x: state.launchPos.x + dir.x * 400, y: state.launchPos.y + dir.y * 400 }];
    },
    snapshot() {
      return structuredClone(state);
    },
  };

  const renderer: Renderer = {
    draw() {},
    resize: sizeCanvas,
    screenToBoard: (px, py) => ({ x: px, y: py }),
    boardToScreen: (p) => ({ x: p.x, y: p.y }),
    particleCount: 0,
    dpr: 1,
  };
  const audio: AudioSystem = {
    unlocked: false,
    unlock() {
      if (!this.unlocked) log('audio.unlock()');
      (this as { unlocked: boolean }).unlocked = true;
    },
    setSfxVolume() {},
    setMusicVolume() {},
  };

  // méta en mémoire (rien n'est écrit dans localStorage) ; ?title : premier lancement
  const params = new URLSearchParams(location.search);
  const meta: MetaSystem = createMeta(createMemoryStorage(), config);
  if (!params.has('title')) meta.setOnboarded();

  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);
  const ui = createUI({ root, canvas, sim, bus, renderer, audio, meta, config });

  // --- boucle factice ------------------------------------------------------
  let last = performance.now();
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = Math.min(100, now - last);
    last = now;
    if (state.phase === 'firing') {
      firingMs += dt * state.recallSpeed;
      state.currentShotDamage += Math.round(dt * 0.05 * state.volley.length * (1 + milestones));
      const at = [700, 1300, 1900];
      while (milestones < 3 && firingMs > (at[milestones] ?? Infinity)) {
        milestones++;
        const combo = config.balls.comboMilestones[milestones - 1] ?? 5;
        state.currentShotCombo = combo;
        state.stats.bestCombo = Math.max(state.stats.bestCombo, combo);
        bus.emit({ type: 'combo:milestone', combo, pos: { x: 3.5, y: 4 }, level: milestones as 1 | 2 | 3 });
      }
      if (firingMs >= volleyMs) endVolley();
    }
    draw();
    ui.update(state);
  };
  function draw(): void {
    if (!ctx) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    ctx.fillStyle = '#121a2b';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = 'rgba(232,236,245,0.06)';
    for (let i = 1; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo((cw / 7) * i, 0);
      ctx.lineTo((cw / 7) * i, ch);
      ctx.stroke();
    }
    ctx.fillStyle = '#2a3a5c';
    ctx.fillRect(0, state.launchPos.y + 8, cw, 2);
    const lp = state.launchPos;
    if (state.aimDir && state.phase === 'aiming') {
      ctx.strokeStyle = '#ffe95c';
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(lp.x, lp.y);
      ctx.lineTo(lp.x + state.aimDir.x * 1000, lp.y + state.aimDir.y * 1000);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#cfd6e6';
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(frame);

  // --- panneau de debug ----------------------------------------------------
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;left:4px;top:50%;transform:translateY(-50%);z-index:10;display:flex;flex-direction:column;gap:4px;font:12px system-ui;';
  const body = document.createElement('div');
  body.style.cssText = 'flex-direction:column;gap:4px;';
  const setOpen = (v: boolean): void => {
    body.style.display = v ? 'flex' : 'none';
  };
  setOpen(window.innerWidth >= 600);
  const toggle = document.createElement('button');
  toggle.textContent = 'debug';
  toggle.style.cssText = 'padding:6px 8px;background:#4f7cff;color:#fff;border:0;border-radius:6px;cursor:pointer;';
  toggle.addEventListener('click', () => {
    setOpen(body.style.display === 'none');
  });
  panel.append(toggle, body);
  const add = (label: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:6px 8px;background:#2a3a5c;color:#e8ecf5;border:0;border-radius:6px;opacity:.85;cursor:pointer;';
    b.addEventListener('click', () => {
      fn();
      if (window.innerWidth < 600) setOpen(false);
    });
    body.append(b);
  };
  add('reward:offered', () => {
    const options = [randomOption(0), randomOption(1), randomOption(2)];
    state.phase = 'reward';
    state.rewardOffer = options;
    bus.emit({ type: 'reward:offered', options });
  });
  add('shop:opened', () => {
    state.coins += 40;
    state.phase = 'shop';
    state.shop = { items: makeShopItems(), rerollCost: config.economy.shop.rerollBase, rerollsUsed: 0 };
    bus.emit({ type: 'shop:opened', shop: state.shop });
  });
  add('run:over', () => {
    state.phase = 'gameover';
    state.stats.fragmentsEarned += 37;
    const summary: RunSummary = {
      seed: state.seed,
      depth: state.depth,
      wave: state.wave,
      stats: { ...state.stats },
      relics: [...state.relics],
      volley: state.volley.map((b) => ({ ...b })),
      isDaily: false,
      dailyDate: null,
      score: 1234,
    };
    bus.emit({ type: 'run:over', summary });
    // comme main.ts : crédite la méta puis annonce les succès
    for (const id of meta.onRunEnd(summary)) bus.emit({ type: 'achievement:unlocked', achievementId: id });
  });
  add('−1 PV', () => {
    state.hp = Math.max(0, state.hp - 1);
    bus.emit({ type: 'player:damaged', amount: 1, hpLeft: state.hp });
  });
  add('+3 PV max', () => {
    state.maxHp += 3;
    state.hp += 3;
    bus.emit({ type: 'player:healed', amount: 3, hpLeft: state.hp });
  });
  add('+balle', () => {
    const el = ELEMENTS[state.volley.length % ELEMENTS.length] ?? 'stone';
    state.volley.push({ element: el, tier: 1 });
    bus.emit({ type: 'drop:collected', dropId: 0, kind: 'ball', pos: { x: 0, y: 0 }, value: 1 });
  });
  add('fusion', () => {
    const i = state.volley.findIndex((b, j) => {
      const n = state.volley[j + 1];
      return n !== undefined && n.element === b.element && n.tier === b.tier && b.tier < 3;
    });
    const b = state.volley[i];
    if (!b) return;
    state.volley.splice(i, 2, { element: b.element, tier: (b.tier + 1) as 2 | 3 });
    state.stats.fusions++;
    bus.emit({ type: 'volley:fusion', element: b.element, tier: (b.tier + 1) as 2 | 3, index: i, pos: { x: state.launchPos.x, y: state.launchPos.y } });
  });
  add('+10 pièces', () => {
    state.coins += 10;
    bus.emit({ type: 'drop:collected', dropId: 0, kind: 'coin', pos: { x: 0, y: 0 }, value: 10 });
  });
  add('+1 fragment', () => {
    state.stats.fragmentsEarned += 1;
    bus.emit({ type: 'drop:collected', dropId: 0, kind: 'fragment', pos: { x: 0, y: 0 }, value: 1 });
  });
  add('vague +1', () => {
    state.wave++;
  });
  add('écran titre', () => ui.show('title'));
  add('+200 ◆ méta', () => {
    meta.onRunEnd({
      seed: 'demo-bank',
      depth: 0,
      wave: 1,
      stats: { ...freshState({ x: 0, y: 0 }).stats, fragmentsEarned: 200 },
      relics: [],
      volley: [],
      isDaily: false,
      dailyDate: null,
      score: 0,
    });
  });
  add('toast succès', () => {
    const a = config.meta.achievements[Math.floor(Math.random() * config.meta.achievements.length)];
    if (a) bus.emit({ type: 'achievement:unlocked', achievementId: a.id });
  });
  add('résultat quotidien', () => {
    const st = freshState({ x: 0, y: 0 }).stats;
    meta.onRunEnd({ seed: 'daily', depth: 7, wave: 3, stats: st, relics: [], volley: [], isDaily: true, dailyDate: meta.todayKey(), score: 1234 });
  });
  add('Puits', () => ui.show('meta'));
  add('Réglages', () => ui.show('settings'));
  add('Quotidien', () => ui.show('daily'));
  document.body.append(panel);

  (window as unknown as { __uiDemo: unknown }).__uiDemo = { sim, bus, ui, get state() { return state; } };
}
