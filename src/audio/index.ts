// audio/index.ts — propriétaire : audio-dev.
// createAudio(bus, settings) : s'abonne au bus et joue un SFX synthétisé par événement, plus une
// musique générative. Aucun nœud ni AudioContext avant unlock() ; tout est inoffensif sans WebAudio.
//
// Modules : engine (contexte, déverrouillage, graphe master + compresseur/limiteur),
//           sfx (recettes), music (générateur), mixer (limiteur de polyphonie).
import type { EventBus, EventType, Handler } from '../core/events';
import type { AudioSystem, Settings } from '../core/types';
import { createEngine, type EngineStats } from './engine';
import { createMixer, type MixerStats, type Priority } from './mixer';
import { createMusic } from './music';
import { createSfx, type Sfx } from './sfx';

/** silence laissé au geste au début d'une run (s) */
const MUSIC_INTRO_SILENCE_S = 2;

export interface AudioDebug {
  readonly engine: EngineStats;
  readonly mixer: MixerStats;
  readonly musicPlaying: boolean;
  readonly contextState: string;
  /** recettes directement jouables (preview, QA) — passent par le limiteur */
  readonly sfx: Sfx;
  /** échantillonne l'analyser maintenant */
  samplePeak(): void;
  resetPeak(): void;
}

export interface AudioSystemDev extends AudioSystem {
  /** compteurs et outils de QA (toujours présents, coût négligeable) */
  readonly debug: AudioDebug;
  dispose(): void;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createAudio(bus: EventBus, settings: Readonly<Settings>): AudioSystemDev {
  const measure = import.meta.env?.DEV === true;
  const engine = createEngine({ measure });
  const mixer = createMixer();
  const sfx = createSfx(engine);
  const music = createMusic(engine);

  let sfxVolume = clamp01(settings.sfx);
  let musicVolume = clamp01(settings.music);
  engine.setSfxGain(sfxVolume);
  engine.setMusicGain(musicVolume);

  // état de jeu suivi même avant unlock (pour décider de la musique au déverrouillage)
  let runActive = true;
  let runStartedAt = -Infinity;
  let wave = 1;
  let bossAlive = false;
  let unlockedSeen = false;
  let peakTimer: ReturnType<typeof setInterval> | null = null;
  const unsubs: (() => void)[] = [];

  /** déclenche une recette si le contexte tourne, le volume n'est pas nul et le limiteur l'admet */
  const fire = (priority: Priority, play: () => void): void => {
    if (!engine.running || sfxVolume <= 0) return;
    if (!mixer.admit(priority, nowMs(), engine.stats.voicesActive)) return;
    try {
      play();
    } catch {
      // une recette ne doit jamais casser la boucle de jeu
    }
  };

  const on = <T extends EventType>(type: T, h: Handler<T>): void => {
    unsubs.push(bus.on(type, h));
  };

  function wantMusic(): void {
    if (!engine.running || musicVolume <= 0 || !runActive || document.hidden) return;
    const since = (nowMs() - runStartedAt) / 1000;
    music.setWave(wave);
    music.setTension(bossAlive);
    music.start(Math.max(0, MUSIC_INTRO_SILENCE_S - since));
  }

  // --- SFX ---------------------------------------------------------------------------
  on('ball:bounce', (e) =>
    fire(0, () => (e.surface === 'wall' ? sfx.bounceWall() : sfx.bounceBlock(e.combo, e.surface === 'peg'))),
  );
  on('block:hit', (e) => fire(1, () => sfx.blockHit(e.element, e.crit)));
  on('lightning:chain', () => fire(1, () => sfx.lightningChain()));
  on('drop:collected', (e) => fire(1, () => sfx.dropCollected(e.kind)));
  on('block:destroyed', (e) => fire(2, () => sfx.blockDestroyed(e.kind, e.width)));
  on('block:explode', () => fire(2, () => sfx.blockExplode()));
  on('block:frozen', () => fire(2, () => sfx.blockFrozen()));
  on('block:breached', () => fire(2, () => sfx.blockBreached()));
  on('ball:split', () => fire(2, () => sfx.ballSplit()));
  on('combo:milestone', (e) => fire(2, () => sfx.comboMilestone(e.level)));
  on('volley:start', (e) => fire(2, () => sfx.volleyStart(e.count)));
  on('volley:end', (e) => fire(2, () => sfx.volleyEnd(e.bestCombo)));
  on('volley:fusion', () => fire(2, () => sfx.volleyFusion()));
  on('player:damaged', () => fire(2, () => sfx.playerDamaged()));
  on('player:healed', () => fire(2, () => sfx.playerHealed()));
  on('reward:offered', () => fire(2, () => sfx.rewardOffered()));
  on('reward:chosen', (e) => fire(2, () => sfx.rewardChosen(e.option.kind === 'fuse')));
  on('reward:skipped', () => fire(2, () => sfx.rewardSkipped()));
  on('shop:opened', () => fire(2, () => sfx.shopOpened()));
  on('shop:bought', () => fire(2, () => sfx.shopBought()));
  on('shop:rerolled', () => fire(2, () => sfx.shopRerolled()));
  on('achievement:unlocked', () => fire(2, () => sfx.achievement()));
  on('meta:unlocked', () => fire(2, () => sfx.achievement()));
  on('ui:click', () => fire(2, () => sfx.uiClick()));

  // --- SFX + musique ----------------------------------------------------------------
  on('wave:cleared', (e) => {
    wave = e.wave + 1;
    bossAlive = false;
    music.setTension(false);
    fire(2, () => sfx.waveCleared());
  });
  on('boss:spawned', () => {
    bossAlive = true;
    music.setTension(true);
    fire(2, () => sfx.bossSpawned());
  });
  on('boss:killed', () => {
    bossAlive = false;
    music.setTension(false);
    fire(2, () => sfx.bossKilled());
  });
  on('rows:advanced', (e) => {
    wave = e.wave;
    music.setWave(e.wave);
  });
  on('run:started', () => {
    runActive = true;
    runStartedAt = nowMs();
    wave = 1;
    bossAlive = false;
    music.stop(0.3);
    wantMusic();
  });
  on('run:over', () => {
    runActive = false;
    bossAlive = false;
    music.resolve();
    fire(2, () => sfx.runOver());
  });

  // --- visibilité de l'onglet ----------------------------------------------------------
  const onVisibility = (): void => {
    if (document.hidden) music.pause();
    else {
      music.resume();
      wantMusic();
    }
  };

  const onEngineState = (): void => {
    if (engine.running && !unlockedSeen) {
      unlockedSeen = true;
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      if (measure && peakTimer === null) peakTimer = setInterval(() => engine.samplePeak(), 20);
    }
    if (engine.running) wantMusic();
  };

  const system: AudioSystemDev = {
    unlock() {
      engine.unlock(onEngineState);
    },
    setSfxVolume(v) {
      sfxVolume = clamp01(v);
      engine.setSfxGain(sfxVolume);
    },
    setMusicVolume(v) {
      const was = musicVolume;
      musicVolume = clamp01(v);
      engine.setMusicGain(musicVolume, 0.15);
      if (musicVolume <= 0) music.stop(0.15);
      else if (was <= 0) wantMusic();
    },
    get unlocked() {
      return engine.running;
    },
    debug: {
      get engine() {
        return engine.stats;
      },
      get mixer() {
        return mixer.stats;
      },
      get musicPlaying() {
        return music.playing;
      },
      get contextState() {
        return engine.ctx?.state ?? 'none';
      },
      sfx,
      samplePeak: () => engine.samplePeak(),
      resetPeak: () => engine.resetPeak(),
    },
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      music.stop(0.1);
      if (peakTimer !== null) clearInterval(peakTimer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
  };
  return system;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
