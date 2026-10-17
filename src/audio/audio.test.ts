// audio/audio.test.ts — propriétaire : audio-dev. Node (pas de WebAudio) : tout doit être inoffensif.
import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../core/events';
import ballsConfig from '../config/balls.json';
import type { BallElement, BallFamily, GameEvent } from '../core/types';
import type { Engine } from './engine';
import { chainKindFrom, explodeKind, explodeKindFrom, FAMILY_HIT, HIT_ELEMENTS, HIT_VOICES, HYBRID_ELEMENTS, HYBRID_SECOND_DELAY_S, HYBRID_SECOND_GAIN, hitPriority } from './hits';
import { createMixer } from './mixer';
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
  { type: 'run:over', summary: { seed: 's', depth: 1, wave: 1, stats: { shots: 0, blocksDestroyed: 0, bestCombo: 0, bestShotDamage: 0, totalDamage: 0, coinsEarned: 0, fragmentsEarned: 0, fusions: 0, bossesKilled: 0, durationMs: 0, perfectWaves: 0, contractsCompleted: 0 }, relics: [], volley: [], isDaily: false, dailyDate: null, score: 0, revivesUsed: 0, contractsCompleted: 0, forged: [] } },
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

/** automation d'un AudioParam de gain : [méthode, valeur, instant] */
type ParamCall = [string, number, number];

function fakeParam(v = 0, log?: ParamCall[]): AudioParam {
  const rec = (m: string) => (value: number, at: number) => {
    log?.push([m, value, at]);
    return p;
  };
  const p = { value: v, setValueAtTime: rec('set'), exponentialRampToValueAtTime: rec('exp'), linearRampToValueAtTime: rec('lin') };
  return p as unknown as AudioParam;
}

function fakeNode(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: () => undefined, onended: null, ...extra };
}

function fakeEngine(trace: Traced[], gainLog?: ParamCall[]): Engine {
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
    gain: (v) => push({ kind: 'gain', type: 'gain', freq: 0 }, fakeNode({ gain: fakeParam(v, gainLog) })),
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
function hitTrace(el: BallElement, crit = false, gainLog?: ParamCall[]): Traced[] {
  const trace: Traced[] = [];
  const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    createSfx(fakeEngine(trace, gainLog)).blockHit(el, crit);
  } finally {
    rnd.mockRestore();
  }
  return trace;
}

const sines = (t: Traced[]): number[] => t.filter((n) => n.kind === 'osc' && n.type === 'sine').map((n) => n.freq);
const hasRatio = (fs: number[], r: number): boolean => fs.some((a) => fs.some((b) => Math.abs(b / a - r) < 0.005));

describe('block:hit : une voix par famille, une identité par élément', () => {
  it('la table couvre les 41 éléments avec la famille de config/balls.json', () => {
    expect(HIT_ELEMENTS).toHaveLength(41);
    expect(HYBRID_ELEMENTS).toHaveLength(13);
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
    expect(new Set(sigs).size).toBe(8);
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
      // les deux voix parentes sont rendues (au moins autant de nœuds que leurs deux traces réunies)
      hybrid: (t, el) => {
        const [a, b] = HIT_VOICES[el].parents ?? ['stone', 'stone'];
        return t.length > hitTrace(a).length + hitTrace(b).length;
      },
      // fondamentale + quinte + octave
      divine: (t) => hasRatio(sines(t), 1.5) && hasRatio(sines(t), 2),
    };
    for (const el of HIT_ELEMENTS) {
      const fam = HIT_VOICES[el].family;
      expect(checks[fam](hitTrace(el), el), `${el} (${fam})`).toBe(true);
    }
  });

  it('les 41 éléments jouent sans erreur et ont chacun une trace de nœuds unique', () => {
    const seen = new Map<string, BallElement>();
    for (const el of HIT_ELEMENTS) {
      for (const crit of [false, true]) expect(() => hitTrace(el, crit), el).not.toThrow();
      const t = hitTrace(el);
      expect(t.length, el).toBeGreaterThan(0);
      const key = t.map((n) => `${n.kind}:${n.type}:${Math.round(n.freq)}`).join(' ');
      expect(seen.get(key), `${el} sonne comme ${seen.get(key) ?? ''}`).toBeUndefined();
      seen.set(key, el);
    }
    expect(seen.size).toBe(41);
  });

  it('les 41 block:hit passent par le bus sans WebAudio sans rien loguer', () => {
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
    expect(count(() => sfx.lightningChain('prism'))).toBeGreaterThan(0);
    expect(count(() => sfx.ballSplit(true))).toBeGreaterThan(count(() => sfx.ballSplit(false)));
    expect(count(() => sfx.playerHealed(true))).toBeGreaterThan(count(() => sfx.playerHealed(false)));
  });
});

// ---------------------------------------------------------------------------------------
// Hybrides, Divine, vente / forge / upgrade
// ---------------------------------------------------------------------------------------

/** pics des enveloppes de gain (rampes exponentielles au-dessus du plancher) */
const peaks = (log: ParamCall[]): number[] => log.filter(([m, v]) => m === 'exp' && v > 0.001).map(([, v]) => v);
/** instants de départ des enveloppes (setValueAtTime au plancher) */
const starts = (log: ParamCall[]): number[] => log.filter(([m, v]) => m === 'set' && v <= 0.0001).map(([, , t]) => t);

describe('hybrides : parents superposés + signature', () => {
  it('parents = recipe de config/balls.json, signature et carillon propres à chaque hybride', () => {
    const recipes = new Map(ballsConfig.defs.map((d) => [d.id, (d as { recipe?: string[] }).recipe]));
    const layers = new Set<string>();
    const chimes = new Set<number>();
    for (const el of HYBRID_ELEMENTS) {
      const v = HIT_VOICES[el];
      expect(v.parents, el).toEqual(recipes.get(el));
      for (const p of v.parents ?? []) expect(HIT_VOICES[p].family, `${el} ← ${p}`).not.toMatch(/hybrid|divine/);
      layers.add(v.layer);
      chimes.add(v.chimeHz ?? 0);
    }
    expect(layers.size).toBe(13);
    expect(chimes.size).toBe(13);
  });

  it('seconde voix parente à −6 dB et décalée de 12 ms, première voix intacte', () => {
    for (const el of HYBRID_ELEMENTS) {
      const [a, b] = HIT_VOICES[el].parents ?? ['stone', 'stone'];
      const la: ParamCall[] = [];
      const lb: ParamCall[] = [];
      const lh: ParamCall[] = [];
      hitTrace(a, false, la);
      hitTrace(b, false, lb);
      hitTrace(el, false, lh);
      const pa = peaks(la);
      const pb = peaks(lb);
      const ph = peaks(lh);
      // préfixe = voix A inchangée, puis voix B atténuée
      expect(ph.slice(0, pa.length), el).toEqual(pa);
      ph.slice(pa.length, pa.length + pb.length).forEach((v, i) => expect(v, `${el} ${b}#${i}`).toBeCloseTo((pb[i] ?? 0) * HYBRID_SECOND_GAIN, 6));
      const sa = starts(la).length;
      const sb = starts(lb);
      starts(lh).slice(sa, sa + sb.length).forEach((t, i) => expect(t, `${el} départ ${b}#${i}`).toBeCloseTo((sb[i] ?? 0) + HYBRID_SECOND_DELAY_S, 6));
      // la signature ajoute au moins une enveloppe au-delà des deux parents
      expect(ph.length, el).toBeGreaterThan(pa.length + pb.length);
    }
    expect(20 * Math.log10(HYBRID_SECOND_GAIN)).toBeCloseTo(-6, 6);
  });
});

describe('Divine : accord + chœur, priorité haute', () => {
  it('accord sinus purs (×1, ×1,5, ×2) et chœur de 3 sinus identiques avec vibrato', () => {
    const t = hitTrace('divine');
    const fs = sines(t);
    const f0 = HIT_VOICES.divine.hz;
    for (const r of [1, 1.5, 2]) expect(fs.some((f) => Math.abs(f - f0 * r) < 0.01), `×${r}`).toBe(true);
    // chœur : 3 sinus à la même fréquence (détunés par detune) + LFO de vibrato (< 20 Hz)
    expect(fs.filter((f) => Math.abs(f - f0 * 2) < 0.01).length).toBeGreaterThanOrEqual(4);
    expect(fs.filter((f) => f < 20).length).toBeGreaterThanOrEqual(3);
    expect(t.some((n) => n.type !== 'sine' && n.kind === 'osc')).toBe(false);
  });

  it('la Divine est en priorité 2, tous les autres hits en 1 ; elle passe quand les hits ordinaires sont refusés', () => {
    for (const el of HIT_ELEMENTS) expect(hitPriority(el), el).toBe(el === 'divine' ? 2 : 1);
    const m = createMixer();
    let admitted = 0;
    for (let i = 0; i < 20; i++) if (m.admit(hitPriority('jackpot'), 0, 0)) admitted++;
    expect(admitted).toBeLessThan(12);
    expect(m.admit(hitPriority('jackpot'), 1, 0)).toBe(false);
    expect(m.admit(hitPriority('divine'), 1, 0)).toBe(true);
  });
});

describe('nouveaux événements', () => {
  const P2 = { x: 1, y: 1 };
  const NEW_EVENTS: GameEvent[] = [
    ...HIT_ELEMENTS.slice(27).map((el): GameEvent => ({ type: 'block:hit', blockId: 1, ballId: 1, pos: P2, damage: 1, combo: 1, element: el, hpLeft: 1, crit: true })),
    { type: 'shop:sold', element: 'fire', tier: 3, coins: 32 },
    { type: 'shop:forged', result: 'steam', parents: ['fire', 'ice'], cost: 40, pos: P2 },
    { type: 'shop:forged', result: 'divine', parents: ['steam', 'hammer'], cost: 150, pos: P2 },
    { type: 'shop:upgraded', element: 'steam', tier: 2, cost: 60 },
    ...(['divine', 'steam', 'supernova', 'missile', 'cluster'] as const).map((element): GameEvent => ({ type: 'block:explode', pos: P2, radius: 1.5, damage: 1, element })),
    { type: 'lightning:chain', from: P2, to: P2, damage: 1500, element: 'divine' },
    { type: 'lightning:chain', from: P2, to: P2, damage: 1, element: 'laser' },
  ];

  it('aucun AudioContext ni nœud avant unlock(), même avec un WebAudio disponible', () => {
    let contexts = 0;
    class FakeCtx {
      constructor() {
        contexts++;
      }
    }
    vi.stubGlobal('window', { AudioContext: FakeCtx });
    const err = vi.spyOn(console, 'error');
    try {
      const bus = createEventBus();
      const audio = createAudio(bus, { sfx: 0.8, music: 0.5, musicTrack: 'neon' });
      for (const e of [...EVENTS, ...NEW_EVENTS]) bus.emit(e);
      expect(contexts).toBe(0);
      expect(audio.debug.engine.nodesCreated).toBe(0);
      expect(audio.unlocked).toBe(false);
      expect(err).not.toHaveBeenCalled();
      audio.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passent par le bus sans WebAudio sans rien loguer', () => {
    const err = vi.spyOn(console, 'error');
    const bus = createEventBus();
    const audio = createAudio(bus, { sfx: 0.8, music: 0.5, musicTrack: 'neon' });
    audio.unlock();
    for (const e of NEW_EVENTS) bus.emit(e);
    expect(audio.debug.engine.nodesCreated).toBe(0);
    expect(err).not.toHaveBeenCalled();
    audio.dispose();
  });

  it('variantes source → recette', () => {
    expect(explodeKindFrom('divine', 1.5, false)).toBe('divine');
    expect(explodeKindFrom('steam', 1.2, false)).toBe('steam');
    expect(explodeKindFrom('supernova', 2, false)).toBe('supernova');
    expect(explodeKindFrom('missile', 1, false)).toBe('missile');
    expect(explodeKindFrom('cluster', 0.8, false)).toBe('missile');
    expect(chainKindFrom('divine', null)).toBe('divine');
    expect(chainKindFrom(undefined, 'divine')).toBe('arc'); // le Jugement exige le champ core
    expect(chainKindFrom('laser', null)).toBe('laser');
    expect(chainKindFrom(undefined, 'laser')).toBe('laser');
    expect(chainKindFrom(undefined, 'prism')).toBe('prism');
    expect(chainKindFrom('lightning', 'prism')).toBe('arc');
  });

  it('chaque recette crée des nœuds ; supernova > nova, forge Divine > forge hybride', () => {
    const trace: Traced[] = [];
    const sfx = createSfx(fakeEngine(trace));
    const count = (f: () => void): number => {
      const n = trace.length;
      f();
      return trace.length - n;
    };
    const nova = count(() => sfx.blockExplode('nova'));
    expect(count(() => sfx.blockExplode('supernova'))).toBeGreaterThan(nova);
    for (const k of ['divine', 'steam', 'missile'] as const) expect(count(() => sfx.blockExplode(k)), k).toBeGreaterThan(0);
    expect(count(() => sfx.lightningChain('divine'))).toBeGreaterThan(count(() => sfx.lightningChain('arc')));
    expect(count(() => sfx.lightningChain('laser'))).toBeGreaterThan(0);
    // vente : 3 dings (sinus) descendants
    const before = trace.length;
    sfx.shopSold();
    const dings = trace.slice(before).filter((n) => n.kind === 'osc' && n.type === 'sine' && n.freq > 1500 && n.freq < 3000).map((n) => n.freq);
    expect(dings).toHaveLength(3);
    expect(dings[0]! > dings[1]! && dings[1]! > dings[2]!).toBe(true);
    const forged = HYBRID_ELEMENTS.map((el) => count(() => sfx.shopForged(el)));
    for (const n of forged) expect(n).toBeGreaterThan(0);
    expect(count(() => sfx.shopForged('divine'))).toBeGreaterThan(Math.max(...forged));
    expect(count(() => sfx.shopUpgraded(2))).toBeGreaterThan(0);
    expect(count(() => sfx.shopUpgraded(3))).toBeGreaterThan(0);
  });
});
