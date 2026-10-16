// main.ts — propriétaire : architecte. Bootstrap, boucle, TimeControl, API de debug.
import type { DebugApi, GameEvent, MetaModifiers, MetaSystem, TimeControl, AudioSystem } from './core/types';
import { createEventBus } from './core/events';
import { loadConfig } from './core/config';
import { createSim } from './sim';
import { createRenderer } from './render';
import { createUI } from './ui';

const VERSION = '0.1.0-j1';
const FIXED_MS = 1000 / 60;

// --- TimeControl : hit-stop et slow-mo ------------------------------------
function createTimeControl(): TimeControl & { tick(dtReal: number): void; speed: number } {
  let hitStopLeft = 0;
  let slowLeft = 0;
  let slowScale = 1;
  const tc = {
    speed: 1,
    get timeScale(): number {
      if (hitStopLeft > 0) return 0;
      return (slowLeft > 0 ? slowScale : 1) * tc.speed;
    },
    requestHitStop(ms: number): void {
      hitStopLeft = Math.max(hitStopLeft, ms);
    },
    requestSlowMo(scale: number, ms: number): void {
      slowScale = Math.min(scale, slowLeft > 0 ? slowScale : 1);
      slowLeft = Math.max(slowLeft, ms);
    },
    tick(dtReal: number): void {
      if (hitStopLeft > 0) hitStopLeft -= dtReal;
      else if (slowLeft > 0) slowLeft -= dtReal;
    },
  };
  return tc;
}

// --- Modificateurs méta neutres (J1 : pas de systems/) ----------------------
const NEUTRAL_META: MetaModifiers = {
  bonusHp: 0,
  bonusStartBalls: 0,
  coinMultiplier: 1,
  fragmentMultiplier: 1,
  freeRerolls: 0,
  unlockedElements: ['stone', 'fire', 'lightning', 'split'],
  unlockedRelics: ['bouncy', 'piggy', 'firstblood', 'bigboom', 'safetynet', 'magnet'],
  runMods: [],
};

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui');
  const app = document.getElementById('app');
  if (!canvas || !uiRoot || !app) throw new Error('index.html : #game, #ui ou #app manquant');

  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String((e as PromiseRejectionEvent).reason)));

  const config = loadConfig();
  const bus = createEventBus();
  const time = createTimeControl();
  const meta: MetaSystem | null = null;
  const audio: AudioSystem | null = null;

  const seed = new URLSearchParams(location.search).get('seed') ?? `run-${Date.now().toString(36)}`;
  const sim = createSim(config, { seed, meta: NEUTRAL_META });
  const renderer = createRenderer(canvas, bus, time, config);
  const ui = createUI({ root: uiRoot, canvas, sim, bus, renderer, audio, meta, config });

  // --- API de debug / QA ---------------------------------------------------
  const eventCounts: Record<string, number> = {};
  let firstRewardAt: number | null = null;
  bus.onAny((e: GameEvent) => {
    eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
    if (firstRewardAt === null && (e.type === 'block:destroyed' || e.type === 'drop:collected')) {
      firstRewardAt = performance.now();
    }
  });
  const debug: DebugApi = {
    sim,
    renderer,
    bus,
    meta: meta as unknown as MetaSystem,
    eventCounts,
    setSpeed(mult: number) {
      time.speed = Math.max(0.1, Math.min(50, mult));
    },
    fps: 0,
    errors,
    get firstRewardAt() {
      return firstRewardAt;
    },
    version: VERSION,
  };
  (window as unknown as { __pegbreaker: DebugApi }).__pegbreaker = debug;

  // --- Boucle --------------------------------------------------------------
  let last = performance.now();
  let acc = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let paused = false;

  const resize = (): void => renderer.resize();
  window.addEventListener('resize', resize);
  resize();

  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (!paused) last = performance.now();
  });

  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    if (paused) return;
    const dtReal = Math.min(now - last, 100);
    last = now;

    fpsAcc += dtReal;
    fpsFrames++;
    if (fpsAcc >= 1000) {
      debug.fps = Math.round((fpsFrames * 1000) / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }

    time.tick(dtReal);
    acc += dtReal * time.timeScale;
    // garde-fou : jamais plus de 20 pas par frame (speed élevé en QA)
    let steps = 0;
    while (acc >= FIXED_MS && steps < 20 * Math.max(1, time.speed)) {
      const events = sim.step(FIXED_MS);
      for (let i = 0; i < events.length; i++) bus.emit(events[i] as GameEvent);
      acc -= FIXED_MS;
      steps++;
    }
    if (acc > FIXED_MS * 4) acc = 0;

    renderer.draw(sim.state, dtReal);
    ui.update(sim.state);
  };
  requestAnimationFrame(frame);
}

boot();
