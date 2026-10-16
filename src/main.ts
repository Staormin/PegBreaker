// main.ts — propriétaire : architecte. Bootstrap, boucle, TimeControl, API de debug.
import type { DebugApi, GameEvent, MetaSystem, TimeControl, AudioSystem, RunPhase } from './core/types';
import { createEventBus } from './core/events';
import { loadConfig } from './core/config';
import { createSim } from './sim';
import { createRenderer } from './render';
import { createUI } from './ui';
import { createMeta } from './systems';
import { createAudio } from './audio';

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
  const meta: MetaSystem = createMeta(localStorage, config);

  const params = new URLSearchParams(location.search);
  const isDaily = params.get('daily') === '1';
  const forcedSeed = params.get('seed');
  const fresh = params.get('fresh') === '1';
  const resume = !forcedSeed && !isDaily && !fresh && meta.data.currentRun ? meta.data.currentRun : undefined;
  const seed = forcedSeed ?? (isDaily ? meta.dailySeed() : `run-${Date.now().toString(36)}`);
  const audio: AudioSystem = createAudio(bus, meta.data.settings);
  const sim = createSim(config, {
    seed,
    meta: meta.getModifiers(),
    ...(resume ? { snapshot: resume } : {}),
    isDaily,
    dailyDate: isDaily ? meta.todayKey() : null,
  });
  const renderer = createRenderer(canvas, bus, time, config);
  renderer.setShake(meta.data.settings.shake);
  renderer.setReduceMotion(meta.data.settings.reduceMotion);
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
  // --- Persistance : reprise de run, fin de run, succès -------------------
  let lastPhase: RunPhase = sim.state.phase;
  let sinceSave = 0;
  let persistEnabled = true;
  // plus aucune écriture une fois la page en cours de déchargement (l'UI fait setCurrentRun(null) puis reload)
  window.addEventListener('pagehide', () => {
    persistEnabled = false;
  });
  const persistRun = (): void => {
    if (forcedSeed || !persistEnabled) return; // runs QA/debug : jamais sauvegardées
    meta.setCurrentRun(sim.state.phase === 'gameover' ? null : sim.snapshot());
  };
  bus.on('run:over', (e) => {
    if (forcedSeed) return;
    const unlocked = meta.onRunEnd(e.summary);
    for (const id of unlocked) bus.emit({ type: 'achievement:unlocked', achievementId: id });
  });
  bus.on('run:started', () => {
    sinceSave = 0;
  });

  const debug: DebugApi = {
    sim,
    renderer,
    audio,
    bus,
    meta,
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

    // sauvegarde : à chaque changement de phase, et toutes les 5 s en jeu
    sinceSave += dtReal;
    if (sim.state.phase !== lastPhase) {
      lastPhase = sim.state.phase;
      persistRun();
      sinceSave = 0;
    } else if (sinceSave > 5000) {
      persistRun();
      sinceSave = 0;
    }
  };
  // run reprise depuis la sauvegarde : la sim n'émet pas run:started, on le fait pour render/audio
  if (resume) bus.emit({ type: 'run:started', seed: sim.state.seed });
  requestAnimationFrame(frame);
}

boot();
