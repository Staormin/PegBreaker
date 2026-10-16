// main.ts — propriétaire : architecte. Bootstrap, boucle, API de debug.
import type { DebugApi, GameEvent, MetaSystem, AudioSystem, RunPhase } from './core/types';
import { createEventBus } from './core/events';
import { loadConfig } from './core/config';
import { createSim } from './sim';
import { createRenderer } from './render';
import { createUI } from './ui';
import { createMeta } from './systems';
import { createAudio } from './audio';

const VERSION = '0.4.0-j4';
const FIXED_MS = 1000 / 60;

// --- Vitesse de la simulation (QA : setSpeed) ------------------------------
function createTimeControl(): { speed: number; readonly timeScale: number } {
  return {
    speed: 1,
    get timeScale(): number {
      return this.speed;
    },
  };
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
  // qa=1 : run de test, jamais créditée ni sauvegardée ; une run de défi (?seed=&goal=) est créditée mais pas reprise
  const isQa = params.get('qa') === '1';
  const fresh = params.get('fresh') === '1';
  const resume = !forcedSeed && !isDaily && !fresh && meta.data.currentRun ? meta.data.currentRun : undefined;
  const seed = forcedSeed ?? (isDaily ? meta.dailySeed() : `run-${Date.now().toString(36)}`);
  const audio: AudioSystem = createAudio(bus, meta.data.settings);
  const baseMods = meta.getModifiers();
  const sim = createSim(config, {
    seed,
    meta: isDaily ? { ...baseMods, runMods: meta.dailyMods() } : baseMods,
    ...(resume ? { snapshot: resume } : {}),
    isDaily,
    dailyDate: isDaily ? meta.todayKey() : null,
  });
  const renderer = createRenderer(canvas, bus, config);
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
    if (forcedSeed || isDaily || !persistEnabled) return; // runs QA/debug et quotidiennes : jamais sauvegardées (mods hors état)
    // en 'gameover' (run:lost) on garde le snapshot : la seconde chance peut reprendre ; run:over efface
    meta.setCurrentRun(sim.snapshot());
  };
  bus.on('run:over', (e) => {
    if (isQa) return;
    const unlocked = meta.onRunEnd(e.summary);
    meta.setCurrentRun(null);
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
    get timeScale() {
      return time.timeScale;
    },
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
