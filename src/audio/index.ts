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
/** contract:progress : au plus 4 tics par seconde */
const CONTRACT_TICK_MIN_MS = 250;
/** fondu de sortie de la musique à la mort (s), pendant l'accord mineur */
const LOST_MUSIC_FADE_S = 1.2;
/** fondu d'entrée de la musique après une seconde chance (s) */
const REVIVE_MUSIC_FADE_S = 1;
/** run:over juste après run:lost : l'accord de mort suffit, pas de descente chromatique en plus */
const LOST_THEN_OVER_MS = 1500;

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
  let lastContractTick = -Infinity;
  let lostAt = -Infinity;
  /** balles dorées en vol (ballId) jusqu'à ball:grounded */
  const golden = new Set<number>();
  /** vrai dès qu'un block:hit porte un ballId (évolution de core) : le ping doré passe alors par le hit */
  let hitCarriesBallId = false;
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

  function wantMusic(fadeInS?: number): void {
    if (!engine.running || musicVolume <= 0 || !runActive || document.hidden) return;
    const since = (nowMs() - runStartedAt) / 1000;
    music.setWave(wave);
    music.setTension(bossAlive);
    music.start(Math.max(0, MUSIC_INTRO_SILENCE_S - since), fadeInS);
  }

  // --- SFX ---------------------------------------------------------------------------
  on('ball:bounce', (e) => {
    fire(0, () => (e.surface === 'wall' ? sfx.bounceWall() : sfx.bounceBlock(e.combo, e.surface === 'peg')));
    // block:hit ne porte pas (encore) de ballId : la sim émet le hit juste avant le rebond bloc/peg
    // de la même balle, on attache donc le ping doré à ce rebond.
    if (e.surface !== 'wall' && !hitCarriesBallId && golden.has(e.ballId)) fire(1, () => sfx.goldenPing(e.combo));
  });
  on('block:hit', (e) => {
    fire(1, () => sfx.blockHit(e.element, e.crit));
    const id = hitBallId(e);
    if (id !== null) {
      hitCarriesBallId = true;
      if (golden.has(id)) fire(1, () => sfx.goldenPing(e.combo));
    }
  });
  on('ball:launched', (e) => {
    if (!e.golden) return;
    golden.add(e.ballId);
    fire(2, () => sfx.goldenLaunch());
  });
  on('ball:grounded', (e) => {
    golden.delete(e.ballId);
  });
  on('lightning:chain', () => fire(1, () => sfx.lightningChain()));
  on('drop:collected', (e) => fire(1, () => sfx.dropCollected(e.kind)));
  on('block:destroyed', (e) => fire(2, () => sfx.blockDestroyed(e.kind, e.width)));
  on('block:explode', () => fire(2, () => sfx.blockExplode()));
  on('block:frozen', () => fire(2, () => sfx.blockFrozen()));
  on('block:breached', () => fire(2, () => sfx.blockBreached()));
  on('ball:split', () => fire(2, () => sfx.ballSplit()));
  on('combo:milestone', (e) => fire(2, () => sfx.comboMilestone(e.level)));
  on('volley:start', (e) => fire(2, () => sfx.volleyStart(e.count, e.spread)));
  on('volley:end', (e) => {
    golden.clear();
    fire(2, () => sfx.volleyEnd(e.bestCombo));
  });
  on('volley:fusion', () => fire(2, () => sfx.volleyFusion()));
  on('player:damaged', () => fire(2, () => sfx.playerDamaged()));
  on('player:healed', () => fire(2, () => sfx.playerHealed()));
  on('reward:offered', (e) => fire(2, () => sfx.rewardOffered(e.source)));
  on('reward:chosen', (e) => fire(2, () => sfx.rewardChosen(e.option.kind === 'fuse')));
  on('reward:skipped', () => fire(2, () => sfx.rewardSkipped()));
  on('shop:opened', () => fire(2, () => sfx.shopOpened()));
  on('shop:bought', () => fire(2, () => sfx.shopBought()));
  on('shop:rerolled', () => fire(2, () => sfx.shopRerolled()));
  on('achievement:unlocked', () => fire(2, () => sfx.achievement()));
  on('meta:unlocked', () => fire(2, () => sfx.achievement()));
  on('ui:click', () => fire(2, () => sfx.uiClick()));
  on('contract:offered', () => fire(2, () => sfx.contractOffered()));
  on('contract:progress', (e) => {
    const t = nowMs();
    if (t - lastContractTick < CONTRACT_TICK_MIN_MS) return;
    lastContractTick = t;
    fire(0, () => sfx.contractProgress(e.target > 0 ? e.progress / e.target : 0));
  });
  on('contract:completed', (e) => fire(2, () => sfx.contractCompleted(e.reward.kind === 'coins')));
  on('contract:failed', () => fire(2, () => sfx.contractFailed()));

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
    lostAt = -Infinity;
    golden.clear();
    music.stop(0.3);
    wantMusic();
  });
  on('run:lost', () => {
    runActive = false;
    lostAt = nowMs();
    golden.clear();
    music.stop(LOST_MUSIC_FADE_S);
    fire(2, () => sfx.runLost());
  });
  on('run:revived', () => {
    runActive = true;
    runStartedAt = -Infinity; // pas de silence d'intro : reprise immédiate en fondu
    lostAt = -Infinity;
    fire(2, () => sfx.runRevived());
    wantMusic(REVIVE_MUSIC_FADE_S);
  });
  on('run:over', () => {
    runActive = false;
    bossAlive = false;
    music.resolve(); // sans effet si la musique s'est déjà tue sur run:lost
    if (nowMs() - lostAt < LOST_THEN_OVER_MS) return;
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

/** ballId d'un block:hit si core l'ajoute un jour (absent du contrat actuel) */
function hitBallId(e: object): number | null {
  const v = (e as { ballId?: unknown }).ballId;
  return typeof v === 'number' ? v : null;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
