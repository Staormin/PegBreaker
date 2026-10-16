// audio/music.ts — propriétaire : audio-dev.
// Lecteur temps réel des partitions (tracks.ts). Aucune note aléatoire : la partition est écrite,
// seule la vélocité varie (±10 %). Planification à la mesure : un setInterval de 50 ms planifie
// la mesure suivante EN BLOC dès qu'elle commence dans moins de PLAN_AHEAD_S (0,5 s) ; toute note
// part donc avec ≥ 150 ms d'avance tant que le thread n'est pas bloqué plus de 350 ms.
// Les changements (couches, boss, piste) prennent effet à la prochaine mesure non planifiée.
//
// Couches (vague) : 1 = basse + accords ; 3 = + mélodie ; 6 = + troisième couche (contre-chant
// ou percussion selon la piste). Boss : mineur harmonique + basse une octave plus bas.
// run:lost → tout s'éteint sauf un accord tenu ; run:revived → reprise à la mesure suivante ;
// run:over → résolution sur I majeur puis silence ; setTrack → fondu croisé 1 s à la mesure.
import type { MusicTrackId } from '../core/types';
import type { Engine } from './engine';
import { buildResolution, secondsPerBar, type BarOptions } from './score';
import {
  createRig,
  createTrackBus,
  fadeBus,
  playHold,
  playNote,
  planBar,
  REVERB_SECONDS,
  type HeldChord,
  type Layer,
  type Rig,
  type TrackBus,
} from './synth';
import { TRACKS } from './tracks';

export const TICK_MS = 50;
/** avance minimale garantie d'une note planifiée (hors blocage du thread) */
export const MIN_LEAD_S = 0.15;
/** une mesure est planifiée dès qu'elle commence dans moins de PLAN_AHEAD_S */
export const PLAN_AHEAD_S = MIN_LEAD_S + 0.35;
export const CROSSFADE_S = 1;
const LOST_FADE_S = 0.8;
const MELODY_WAVE = 3;
const THIRD_WAVE = 6;

export type MusicMode = 'idle' | 'intro' | 'play' | 'lost' | 'over';

export interface MusicStats {
  barsPlanned: number;
  notesPlanned: number;
  /** notes dont l'instant était passé à la planification (attendu : 0) */
  lateNotes: number;
  /** mesures planifiées trop tard, horloge recalée (attendu : 0) */
  resyncs: number;
  /** plus petite avance observée au moment de planifier une mesure (ms) */
  minLeadMs: number;
}

export interface Music {
  /** démarre après `delayS` s de silence, fondu d'entrée de `fadeInS` (défaut 3 s) ; idempotent */
  start(delayS: number, fadeInS?: number): void;
  /** fondu de sortie puis arrêt complet */
  stop(fadeS: number): void;
  /** run:lost : tout s'éteint sauf un accord tenu */
  lose(): void;
  /** run:revived : reprise à la mesure suivante ; false si la musique n'était pas en « lost » */
  revive(): boolean;
  /** run:over : résolution sur I majeur puis silence */
  resolve(): void;
  setWave(wave: number): void;
  setTension(on: boolean): void;
  /** change de piste : fondu croisé 1 s à la prochaine mesure */
  setTrack(id: MusicTrackId): void;
  readonly track: MusicTrackId;
  readonly mode: MusicMode;
  readonly wave: number;
  readonly tension: boolean;
  /** onglet caché : suspend la planification et coupe la sortie */
  pause(): void;
  resume(): void;
  readonly playing: boolean;
  readonly stats: MusicStats;
  /** arrêt immédiat et libération du planificateur */
  dispose(): void;
}

interface Player {
  bus: TrackBus;
  bar: number;
  /** début de la prochaine mesure non planifiée (temps du contexte) */
  nextT: number;
  /** plus aucune mesure ne commence à partir de cet instant (fondu de sortie) */
  stopAt: number;
  lastVoicing: readonly number[];
  hold: HeldChord | null;
}

export function layersFor(wave: number): { melody: boolean; third: boolean } {
  return { melody: wave >= MELODY_WAVE, third: wave >= THIRD_WAVE };
}

export function createMusic(e: Engine, initial: MusicTrackId): Music {
  let rig: Rig | null = null;
  let master: GainNode | null = null;
  let current: Player | null = null;
  const leaving: Player[] = [];
  let trackId: MusicTrackId = initial;
  let mode: MusicMode = 'idle';
  let wave = 1;
  let tension = false;
  let paused = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let fadeIn = 3;
  const stats: MusicStats = { barsPlanned: 0, notesPlanned: 0, lateNotes: 0, resyncs: 0, minLeadMs: Infinity };
  const plan = { notes: 0, late: 0 };

  function ensureRig(): Rig | null {
    const ctx = e.ctx;
    if (!ctx || !e.running || !e.musicOut) return null;
    if (!rig) {
      master = e.countNode(ctx.createGain());
      master.connect(e.musicOut);
      rig = createRig(ctx, master, (n) => e.countNode(n));
    }
    return rig;
  }

  const opts = (): BarOptions => ({ ...layersFor(wave), boss: tension, rand: Math.random });

  function newPlayer(r: Rig, id: MusicTrackId, t: number, fade: number): Player {
    const bus = createTrackBus(r, TRACKS[id], 0);
    const p: Player = { bus, bar: 0, nextT: t, stopAt: Infinity, lastVoicing: [], hold: null };
    fadeBus(bus, Math.max(r.ctx.currentTime, t - 0.01), t + Math.max(0.05, fade), 1);
    return p;
  }

  function retire(p: Player, at: number, fadeS: number): void {
    const r = rig;
    if (!r) return;
    p.stopAt = at;
    fadeBus(p.bus, Math.max(r.ctx.currentTime, at), at + Math.max(0.05, fadeS), 0);
    p.hold?.release(at, fadeS);
    p.hold = null;
    leaving.push(p);
    const bar = secondsPerBar(p.bus.def);
    const ms = (at + fadeS + bar + REVERB_SECONDS + 0.5 - r.ctx.currentTime) * 1000;
    setTimeout(() => {
      p.bus.disconnect();
      const i = leaving.indexOf(p);
      if (i >= 0) leaving.splice(i, 1);
    }, Math.max(0, ms));
  }

  function planPlayer(r: Rig, p: Player, now: number): void {
    const bar = secondsPerBar(p.bus.def);
    while (p.nextT < now + PLAN_AHEAD_S && p.nextT < p.stopAt) {
      const lead = p.nextT - now;
      if (lead < 0.01) {
        // thread bloqué trop longtemps : on recale l'horloge plutôt que de jouer en retard
        stats.resyncs++;
        p.nextT = now + 0.05;
      }
      stats.minLeadMs = Math.min(stats.minLeadMs, (p.nextT - now) * 1000);
      plan.notes = 0;
      plan.late = 0;
      const bp = planBar(r, p.bus, p.bar, p.nextT, opts(), plan);
      stats.notesPlanned += plan.notes;
      stats.lateNotes += plan.late;
      stats.barsPlanned++;
      p.lastVoicing = bp.chord.voicing;
      p.bar++;
      p.nextT += bar;
    }
  }

  function tick(): void {
    const r = rig;
    if (!r || !e.running || paused) return;
    const now = r.ctx.currentTime;
    if (mode === 'play' && current) planPlayer(r, current, now);
    for (const p of leaving) if (mode === 'play') planPlayer(r, p, now);
  }

  function ensureTimer(): void {
    if (timer === null) timer = setInterval(tick, TICK_MS);
  }

  function clearStart(): void {
    if (startTimer !== null) clearTimeout(startTimer);
    startTimer = null;
  }

  /** prochaine frontière de mesure du lecteur courant, au moins MIN_LEAD_S après maintenant */
  function nextBoundary(p: Player, now: number): number {
    const bar = secondsPerBar(p.bus.def);
    if (p.nextT >= now + MIN_LEAD_S) return p.nextT;
    const k = Math.ceil((now + MIN_LEAD_S - p.nextT) / bar);
    p.bar += k;
    p.nextT += k * bar;
    return p.nextT;
  }

  function setLayers(p: Player, layers: readonly Layer[], at: number, to: number, dur: number): void {
    for (const l of layers) {
      const g = p.bus.layers[l].gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(g.value, at);
      g.linearRampToValueAtTime(to, at + dur);
    }
  }
  const PLAY_LAYERS: readonly Layer[] = ['bass', 'chord', 'melody', 'counter', 'perc'];

  function begin(): void {
    startTimer = null;
    const r = ensureRig();
    if (!r) return;
    const t = r.ctx.currentTime + MIN_LEAD_S + 0.05;
    if (current) retire(current, r.ctx.currentTime, 0.2);
    current = newPlayer(r, trackId, t, fadeIn);
    mode = 'play';
    ensureTimer();
    tick();
  }

  function stopAll(fadeS: number): void {
    clearStart();
    const r = rig;
    if (r && current) retire(current, r.ctx.currentTime, fadeS);
    current = null;
    mode = 'idle';
  }

  return {
    get track() {
      return trackId;
    },
    get mode() {
      return mode;
    },
    get wave() {
      return wave;
    },
    get tension() {
      return tension;
    },
    get playing() {
      return mode === 'play' && current !== null;
    },
    stats,

    start(delayS, fadeInS = 3) {
      if (!e.running) return;
      if (mode === 'play' || mode === 'intro' || mode === 'lost') return;
      clearStart();
      fadeIn = fadeInS;
      mode = 'intro';
      startTimer = setTimeout(begin, Math.max(0, delayS) * 1000);
    },

    stop(fadeS) {
      stopAll(fadeS);
    },

    lose() {
      const r = rig;
      if (mode === 'intro') {
        stopAll(0.1);
        return;
      }
      if (mode !== 'play' || !r || !current) return;
      const now = r.ctx.currentTime;
      mode = 'lost';
      setLayers(current, PLAY_LAYERS, now, 0, LOST_FADE_S);
      current.hold?.release(now, 0.3);
      current.hold = playHold(r, current.bus, current.lastVoicing, now + 0.05);
    },

    revive() {
      const r = rig;
      if (mode !== 'lost' || !r || !current) return false;
      const now = r.ctx.currentTime;
      const p = current;
      const T = nextBoundary(p, now);
      p.hold?.release(T, 0.6);
      p.hold = null;
      for (const l of PLAY_LAYERS) {
        const g = p.bus.layers[l].gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, Math.min(T, now + 0.1));
        g.setValueAtTime(0, T - 0.005);
        g.linearRampToValueAtTime(1, T + 0.04);
      }
      mode = 'play';
      if (p.bus.def.id !== trackId) {
        // piste changée pendant l'écran de mort : on repart directement sur la nouvelle
        retire(p, T, 0.05);
        current = newPlayer(r, trackId, T, 0.6);
      }
      ensureTimer();
      tick();
      return true;
    },

    resolve() {
      const r = rig;
      clearStart();
      if (!r || !current || (mode !== 'play' && mode !== 'lost')) {
        stopAll(0.3);
        return;
      }
      const now = r.ctx.currentTime;
      const p = current;
      const def = p.bus.def;
      const wasLost = mode === 'lost';
      const T = wasLost ? now + 0.1 : Math.max(p.nextT, now + 0.05);
      mode = 'over';
      p.stopAt = T;
      const dest: Layer | undefined = wasLost ? 'hold' : undefined;
      if (wasLost) p.hold?.release(T, 1.2);
      p.hold = null;
      const spb = 60 / def.bpm;
      let end = T;
      for (const ev of buildResolution(def, layersFor(wave).melody)) {
        playNote(r, p.bus, ev, T + ev.beat * spb, dest);
        end = Math.max(end, T + (ev.beat + ev.dur) * spb);
      }
      current = null;
      retire(p, end + 0.2, 1.5);
      setTimeout(() => {
        if (mode === 'over') mode = 'idle';
      }, Math.max(0, (end + 1.7 - now) * 1000));
    },

    setWave(w) {
      wave = Number.isFinite(w) ? Math.max(1, Math.floor(w)) : 1;
    },
    setTension(on) {
      tension = on;
    },

    setTrack(id) {
      if (!(id in TRACKS) || id === trackId) return;
      trackId = id;
      const r = rig;
      if (mode !== 'play' || !r || !current) return; // appliqué au prochain démarrage / à la reprise
      const now = r.ctx.currentTime;
      const old = current;
      let T = nextBoundary(old, now);
      // la mesure en T est peut-être déjà planifiée : l'ancienne piste la joue en s'effaçant
      if (T - now < 0.03) T += secondsPerBar(old.bus.def);
      retire(old, T, CROSSFADE_S);
      old.stopAt = T + CROSSFADE_S;
      current = newPlayer(r, id, T, CROSSFADE_S);
      tick();
    },

    dispose() {
      stopAll(0.1);
      if (timer !== null) clearInterval(timer);
      timer = null;
    },

    pause() {
      if (paused) return;
      paused = true;
      const r = rig;
      if (!r || !master) return;
      const t = r.ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(0, t, 0.05);
    },
    resume() {
      if (!paused) return;
      paused = false;
      const r = rig;
      if (!r || !master) return;
      const t = r.ctx.currentTime;
      if (current) nextBoundary(current, t);
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(1, t, 0.4);
    },
  };
}
