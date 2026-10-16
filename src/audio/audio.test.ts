// audio/audio.test.ts — propriétaire : audio-dev. Node (pas de WebAudio) : tout doit être inoffensif.
import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../core/events';
import ballsConfig from '../config/balls.json';
import type { BallElement, BallFamily, GameEvent } from '../core/types';
import type { Engine } from './engine';
import { explodeKind, explodeKindFrom, FAMILY_HIT, HIT_ELEMENTS, HIT_VOICES } from './hits';
import { createAudio } from './index';
import { bounceFreq, createSfx } from './sfx';

const P = { x: 1, y: 1 };
const EVENTS: GameEvent[] = [
  { type: 'run:started', seed: 's' },
  { type: 'volley:start', count: 30, from: P, dir: P, spread: 1 },
  { type: 'ball:launched', ballId: 1, element: 'stone', tier: 1, pos: P, golden: true },
  { type: 'ball:bounce', ballId: 1, pos: P, normal: P, surface: 'block', combo: 40 },
  { type: 'block:hit', blockId: 1, ballId: 1, pos: P, damage: 10, combo: 2, element: 'fire', hpLeft: 1, crit: true },
  { type: 'boss:spawned', bossId: 'b', blockId: 2 },
  { type: 'rows:advanced', wave: 5, newRow: true },
  { type: 'ball:grounded', ballId: 1, pos: P },
  { type: 'ui:click' },
  { type: 'contract:offered', contract: { id: 'c', progress: 0, target: 3, status: 'active' }, def: { id: 'c', kind: 'reachCombo', target: 3, text: 'Combo {n}', reward: { kind: 'coins', amount: 5 }, minWave: 1, weight: 1 } },
  { type: 'contract:progress', progress: 1, target: 3 },
  { type: 'contract:completed', def: { id: 'c', kind: 'reachCombo', target: 3, text: 'Combo {n}', reward: { kind: 'coins', amount: 5 }, minWave: 1, weight: 1 }, reward: { kind: 'coins', amount: 5 } },
  { type: 'contract:failed', def: { id: 'c', kind: 'reachCombo', target: 3, text: 'Combo {n}', reward: { kind: 'coins', amount: 5 }, minWave: 1, weight: 1 } },
  { type: 'reward:offered', options: [], source: 'boss' },
  { type: 'run:lost', canRevive: true, wave: 1, depth: 1 },
  { type: 'run:revived', hpLeft: 1, revivesUsed: 1 },
  { type: 'run:over', summary: { seed: 's', depth: 1, wave: 1, stats: { shots: 0, blocksDestroyed: 0, bestCombo: 0, bestShotDamage: 0, totalDamage: 0, coinsEarned: 0, fragmentsEarned: 0, fusions: 0, bossesKilled: 0, durationMs: 0, perfectWaves: 0, contractsCompleted: 0 }, relics: [], volley: [], isDaily: false, dailyDate: null, score: 0, revivesUsed: 0, contractsCompleted: 0 } },
];

describe('audio sans WebAudio', () => {
  it('est inoffensif : unlock, volumes et événements ne lèvent rien et ne loguent rien', () => {
    const err = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const bus = createEventBus();
    const audio = createAudio(bus, { sfx: 0.8, music: 0.5, musicTrack: 'neon' });
    expect(audio.unlocked).toBe(false);
    for (const e of EVENTS) bus.emit(e);
    audio.unlock();
    audio.setSfxVolume(0);
    audio.setMusicVolume(1);
    for (const e of EVENTS) bus.emit(e);
    expect(audio.unlocked).toBe(false);
    expect(audio.debug.engine.nodesCreated).toBe(0);
    expect(audio.debug.contextState).toBe('none');
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    audio.dispose();
  });

  it('pitch de rebond : un demi-ton par combo, plafonné à 24', () => {
    expect(bounceFreq(0)).toBeCloseTo(220);
    expect(bounceFreq(12)).toBeCloseTo(440);
    expect(bounceFreq(24)).toBeCloseTo(880);
    expect(bounceFreq(160)).toBeCloseTo(880);
  });

  it('piste musicale : initiale = settings.musicTrack, setMusicTrack sans WebAudio', () => {
    const bus = createEventBus();
    const audio = createAudio(bus, { sfx: 0.8, music: 0.5, musicTrack: 'deep' });
    expect(audio.musicTrack).toBe('deep');
    audio.setMusicTrack('arcade');
    expect(audio.musicTrack).toBe('arcade');
    audio.setMusicTrack('polka' as never);
    expect(audio.musicTrack).toBe('arcade');
    expect(audio.debug.engine.nodesCreated).toBe(0);
    audio.dispose();
  });
});

// ---------------------------------------------------------------------------------------
// Sons de block:hit par famille / élément (faux Engine qui trace les nœuds créés)
// ---------------------------------------------------------------------------------------

interface Traced {
  kind: 'osc' | 'noise' | 'filter' | 'gain' | 'other';
  type: string;
  freq: number;
}

function fakeParam(v = 0): AudioParam {
  const p = { value: v, setValueAtTime: () => p, exponentialRampToValueAtTime: () => p, linearRampToValueAtTime: () => p };
  return p as unknown as AudioParam;
}

function fakeNode(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: () => undefined, onended: null, ...extra };
}

function fakeEngine(trace: Traced[]): Engine {
  const stats = { nodesCreated: 0, voicesActive: 0, peak: 0, clipSamples: 0 };
  const push = <T>(t: Traced, n: Record<string, unknown>): T => {
    trace.push(t);
    stats.nodesCreated++;
    return n as T;
  };
  return {
    ctx: { currentTime: 0, state: 'running' } as unknown as AudioContext,
    running: true,
    sfxOut: fakeNode() as unknown as AudioNode,
    musicOut: null,
    noise: null,
    stats,
    unlock: () => undefined,
    setSfxGain: () => undefined,
    setMusicGain: () => undefined,
    osc: (type, freq) => push({ kind: 'osc', type, freq }, fakeNode({ type, frequency: fakeParam(freq), detune: fakeParam() })),
    gain: (v) => push({ kind: 'gain', type: 'gain', freq: 0 }, fakeNode({ gain: fakeParam(v) })),
    filter: (type, freq, q) => push({ kind: 'filter', type, freq }, fakeNode({ type, frequency: fakeParam(freq), Q: fakeParam(q) })),
    noiseSrc: () => push({ kind: 'noise', type: 'noise', freq: 0 }, fakeNode()),
    shaper: () => push({ kind: 'other', type: 'shaper', freq: 0 }, fakeNode({ curve: null })),
    delay: () => push({ kind: 'other', type: 'delay', freq: 0 }, fakeNode({ delayTime: fakeParam() })),
    panner: (pan) => push({ kind: 'other', type: 'panner', freq: 0 }, fakeNode({ pan: fakeParam(pan) })),
    countNode: (n) => n,
    trackVoice: () => undefined,
    resetPeak: () => undefined,
    samplePeak: () => undefined,
  };
}

/** trace d'un block:hit (Math.random figé : vary() = ×1) */
function hitTrace(el: BallElement, crit = false): Traced[] {
  const trace: Traced[] = [];
  const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    createSfx(fakeEngine(trace)).blockHit(el, crit);
  } finally {
    rnd.mockRestore();
  }
  return trace;
}

const sines = (t: Traced[]): number[] => t.filter((n) => n.kind === 'osc' && n.type === 'sine').map((n) => n.freq);
const hasRatio = (fs: number[], r: number): boolean => fs.some((a) => fs.some((b) => Math.abs(b / a - r) < 0.005));

describe('block:hit : une voix par famille, une identité par élément', () => {
  it('la table couvre les 27 éléments avec la famille de config/balls.json', () => {
    expect(HIT_ELEMENTS).toHaveLength(27);
    for (const def of ballsConfig.defs) {
      const v = HIT_VOICES[def.id as BallElement];
      expect(v, def.id).toBeDefined();
      expect(v.family, def.id).toBe(def.family);
      expect(v.note.length, def.id).toBeGreaterThan(10);
    }
    expect(new Set(ballsConfig.defs.map((d) => d.id)).size).toBe(HIT_ELEMENTS.length);
  });

  it('chaque famille a un timbre de base distinct (source + filtre + partiels)', () => {
    const sigs = Object.values(FAMILY_HIT).map((f) => `${f.wave}|${f.filter}|${f.partials.join(',')}`);
    expect(new Set(sigs).size).toBe(6);
  });

  it('le timbre de famille est réellement rendu pour chacun de ses éléments', () => {
    const checks: Record<BallFamily, (t: Traced[], el: BallElement) => boolean> = {
      // soufflé (bruit passe-bas) ou crépitant (≥ 3 bruits passe-haut)
      elemental: (t, el) =>
        HIT_VOICES[el].mode === 'crackle'
          ? t.filter((n) => n.kind === 'filter' && n.type === 'highpass').length >= 3
          : t.some((n) => n.kind === 'filter' && n.type === 'lowpass'),
      // sub sinus < 120 Hz, pas de clic square
      heavy: (t) => sines(t).some((f) => f < 120) && !t.some((n) => n.type === 'square'),
      // deux sinus détunés ×1,012
      tricky: (t) => hasRatio(sines(t), FAMILY_HIT.tricky.partials[1] ?? 0),
      // au moins deux bruits passe-bande (double clic)
      swarm: (t) => t.filter((n) => n.kind === 'filter' && n.type === 'bandpass').length >= 2,
      // partiel inharmonique ×2,76
      greed: (t) => hasRatio(sines(t), FAMILY_HIT.greed.partials[1] ?? 0),
      // triangle filtré passe-bande (stone : recette de base de la skill)
      arcane: (t, el) =>
        el === 'stone'
          ? t.some((n) => n.kind === 'filter' && n.type === 'bandpass' && n.freq === 1200)
          : t.some((n) => n.type === 'triangle') && t.some((n) => n.kind === 'filter' && n.type === 'bandpass'),
    };
    for (const el of HIT_ELEMENTS) {
      const fam = HIT_VOICES[el].family;
      expect(checks[fam](hitTrace(el), el), `${el} (${fam})`).toBe(true);
    }
  });

  it('les 27 éléments jouent sans erreur et ont chacun une trace de nœuds unique', () => {
    const seen = new Map<string, BallElement>();
    for (const el of HIT_ELEMENTS) {
      for (const crit of [false, true]) expect(() => hitTrace(el, crit), el).not.toThrow();
      const t = hitTrace(el);
      expect(t.length, el).toBeGreaterThan(0);
      const key = t.map((n) => `${n.kind}:${n.type}:${Math.round(n.freq)}`).join(' ');
      expect(seen.get(key), `${el} sonne comme ${seen.get(key) ?? ''}`).toBeUndefined();
      seen.set(key, el);
    }
    expect(seen.size).toBe(27);
  });

  it('les 27 block:hit passent par le bus sans WebAudio sans rien loguer', () => {
    const err = vi.spyOn(console, 'error');
    const bus = createEventBus();
    const audio = createAudio(bus, { sfx: 0.8, music: 0.5, musicTrack: 'neon' });
    audio.unlock();
    for (const el of HIT_ELEMENTS) bus.emit({ type: 'block:hit', blockId: 1, ballId: 1, pos: P, damage: 1, combo: 1, element: el, hpLeft: 1, crit: false });
    bus.emit({ type: 'block:destroyed', blockId: 1, kind: 'explosive', pos: P, width: 1, element: 'vampire' });
    bus.emit({ type: 'block:explode', pos: P, radius: 1.2, damage: 1 });
    bus.emit({ type: 'player:healed', amount: 1, hpLeft: 2 });
    for (let i = 0; i < 10; i++) bus.emit({ type: 'lightning:chain', from: P, to: P, damage: 1 });
    bus.emit({ type: 'ball:split', pos: P });
    expect(audio.debug.engine.nodesCreated).toBe(0);
    expect(err).not.toHaveBeenCalled();
    audio.dispose();
  });
});

describe('explosions : variante déduite du rayon', () => {
  it('bombe ≥ 1,4, nova = 1,2, bloc explosif 1,2 reste normal', () => {
    expect(explodeKind(1.1, false)).toBe('normal'); // feu
    expect(explodeKind(1.4, false)).toBe('bomb');
    expect(explodeKind(2.2, false)).toBe('bomb');
    expect(explodeKind(1.2, false)).toBe('nova');
    expect(explodeKind(1.2, true)).toBe('normal');
    expect(explodeKind(2.4, true)).toBe('normal'); // bloc explosif + Poudre noire
  });

  it('block:explode.element prime sur le rayon ; repli sur le rayon si absent', () => {
    expect(explodeKindFrom('bomb', 1.1, false)).toBe('bomb');
    expect(explodeKindFrom('nova', 3, false)).toBe('nova');
    expect(explodeKindFrom('fire', 1.65, false)).toBe('normal'); // Pyromane : plus de faux « bombe »
    expect(explodeKindFrom('explosive', 1.2, false)).toBe('normal');
    expect(explodeKindFrom(undefined, 1.4, false)).toBe('bomb');
    expect(explodeKindFrom(undefined, 1.2, true)).toBe('normal');
  });

  it('les champs source des événements passent par le bus sans erreur (avec et sans)', () => {
    const err = vi.spyOn(console, 'error');
    const bus = createEventBus();
    const audio = createAudio(bus, { sfx: 0.8, music: 0.5, musicTrack: 'neon' });
    audio.unlock();
    bus.emit({ type: 'block:explode', pos: P, radius: 1.4, damage: 1, element: 'bomb' });
    bus.emit({ type: 'block:explode', pos: P, radius: 1.2, damage: 1, element: 'explosive' });
    bus.emit({ type: 'lightning:chain', from: P, to: P, damage: 1, element: 'prism' });
    bus.emit({ type: 'ball:split', pos: P, element: 'crystal' });
    bus.emit({ type: 'player:healed', amount: 1, hpLeft: 2, source: 'vampire' });
    bus.emit({ type: 'player:healed', amount: 1, hpLeft: 2, source: 'heart' });
    expect(audio.debug.engine.nodesCreated).toBe(0);
    expect(err).not.toHaveBeenCalled();
    audio.dispose();
  });

  it('les variantes d\'explosion, prisme, cristal et vampire créent des nœuds sans erreur', () => {
    const trace: Traced[] = [];
    const sfx = createSfx(fakeEngine(trace));
    const count = (f: () => void): number => {
      const n = trace.length;
      f();
      return trace.length - n;
    };
    const normal = count(() => sfx.blockExplode('normal'));
    const bomb = count(() => sfx.blockExplode('bomb'));
    const nova = count(() => sfx.blockExplode('nova'));
    expect(normal).toBeGreaterThan(0);
    expect(bomb).toBeGreaterThan(normal);
    expect(nova).toBeGreaterThan(normal);
    expect(count(() => sfx.lightningChain(true))).toBeGreaterThan(0);
    expect(count(() => sfx.ballSplit(true))).toBeGreaterThan(count(() => sfx.ballSplit(false)));
    expect(count(() => sfx.playerHealed(true))).toBeGreaterThan(count(() => sfx.playerHealed(false)));
  });
});
