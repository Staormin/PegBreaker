// audio/engine.ts — propriétaire : audio-dev.
// Contexte WebAudio paresseux, déverrouillage (iOS/Chrome), graphe master, bruit partagé,
// fabriques de nœuds instrumentées (compteur pour la QA). RIEN n'est créé avant unlock().
//
// Graphe :
//   voix SFX ─► sfxGain ─┐
//                        ├─► bus ─► comp (−12 dB, 4:1) ─► limiter (−3 dB, 20:1) ─► safety (soft-clip) ─► destination
//   musique ─► musicGain ┘                                         └─► analyser (dev : mesure du pic)

export interface EngineStats {
  /** nœuds WebAudio créés depuis unlock (toutes catégories) */
  nodesCreated: number;
  /** voix SFX encore en lecture */
  voicesActive: number;
  /** pic absolu mesuré par l'analyser (après limiteur, avant soft-clip) depuis le dernier reset */
  peak: number;
  /** échantillons ≥ 0,99 vus par l'analyser */
  clipSamples: number;
}

export interface Engine {
  readonly ctx: AudioContext | null;
  /** contexte prêt à jouer (créé, déverrouillé, état 'running') */
  readonly running: boolean;
  readonly sfxOut: AudioNode | null;
  readonly musicOut: AudioNode | null;
  readonly noise: AudioBuffer | null;
  readonly stats: EngineStats;
  /** crée le contexte au besoin et tente de le reprendre ; idempotent */
  unlock(onState: () => void): void;
  setSfxGain(v: number): void;
  setMusicGain(v: number, fadeS?: number): void;
  /** fabriques instrumentées — renvoient null si le contexte n'est pas prêt */
  osc(type: OscillatorType, freq: number): OscillatorNode | null;
  gain(v: number): GainNode | null;
  filter(type: BiquadFilterType, freq: number, q: number): BiquadFilterNode | null;
  noiseSrc(): AudioBufferSourceNode | null;
  shaper(curve: Float32Array<ArrayBuffer>): WaveShaperNode | null;
  delay(maxS: number): DelayNode | null;
  /** panoramique stéréo ; null si le contexte n'est pas prêt ou si StereoPannerNode est absent */
  panner(pan: number): StereoPannerNode | null;
  /** marque une voix active jusqu'à `endNode.onended` */
  trackVoice(endNode: AudioScheduledSourceNode): void;
  resetPeak(): void;
  /** échantillonne l'analyser (appelé périodiquement en dev) */
  samplePeak(): void;
}

type AudioCtor = typeof AudioContext;

function findAudioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/** courbe de sécurité : linéaire jusqu'à 0,7, puis tanh qui plafonne à 0,98 */
function safetyCurve(): Float32Array<ArrayBuffer> {
  const n = 2048;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const knee = 0.7;
  const ceil = 0.98;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export function createEngine(opts: { measure: boolean }): Engine {
  let ctx: AudioContext | null = null;
  let sfxGain: GainNode | null = null;
  let musicGain: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let scope: Float32Array<ArrayBuffer> | null = null;
  let noise: AudioBuffer | null = null;
  let sfxLevel = 0.8;
  let musicLevel = 0.5;
  const stats: EngineStats = { nodesCreated: 0, voicesActive: 0, peak: 0, clipSamples: 0 };

  const count = <T>(n: T): T => {
    stats.nodesCreated++;
    return n;
  };

  function build(c: AudioContext): void {
    const bus = count(c.createGain());
    bus.gain.value = 0.8;
    const comp = count(c.createDynamicsCompressor());
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    const limiter = count(c.createDynamicsCompressor());
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    const safety = count(c.createWaveShaper());
    safety.curve = safetyCurve();
    safety.oversample = 'none';

    sfxGain = count(c.createGain());
    sfxGain.gain.value = sfxLevel;
    musicGain = count(c.createGain());
    musicGain.gain.value = musicLevel;

    sfxGain.connect(bus);
    musicGain.connect(bus);
    bus.connect(comp);
    comp.connect(limiter);
    limiter.connect(safety);
    safety.connect(c.destination);

    if (opts.measure) {
      analyser = count(c.createAnalyser());
      analyser.fftSize = 2048;
      scope = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      limiter.connect(analyser);
    }

    // bruit blanc 1 s, généré une fois
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const ready = (): AudioContext | null => (ctx && ctx.state === 'running' ? ctx : null);

  const engine: Engine = {
    get ctx() {
      return ctx;
    },
    get running() {
      return ready() !== null;
    },
    get sfxOut() {
      return sfxGain;
    },
    get musicOut() {
      return musicGain;
    },
    get noise() {
      return noise;
    },
    stats,

    unlock(onState) {
      try {
        if (!ctx) {
          const Ctor = findAudioCtor();
          if (!Ctor) return;
          ctx = new Ctor({ latencyHint: 'interactive' });
          build(ctx);
          ctx.onstatechange = onState;
        }
        const c = ctx;
        if (c.state !== 'running') {
          // resume() peut rejeter (pas de geste) : on avale silencieusement, un prochain unlock réessaiera
          void c.resume().then(onState, () => undefined);
        }
        // buffer silencieux (déverrouillage iOS)
        const b = c.createBuffer(1, 1, 22050);
        const s = count(c.createBufferSource());
        s.buffer = b;
        s.connect(c.destination);
        s.start(0);
        onState();
      } catch {
        // contexte indisponible (headless, politique) : audio inerte
      }
    },

    setSfxGain(v) {
      sfxLevel = clamp01(v);
      if (ctx && sfxGain) {
        sfxGain.gain.cancelScheduledValues(ctx.currentTime);
        sfxGain.gain.setValueAtTime(sfxLevel, ctx.currentTime);
      }
    },
    setMusicGain(v, fadeS = 0) {
      musicLevel = clamp01(v);
      if (ctx && musicGain) {
        const t = ctx.currentTime;
        const g = musicGain.gain;
        g.cancelScheduledValues(t);
        if (fadeS > 0) {
          g.setValueAtTime(g.value, t);
          g.linearRampToValueAtTime(musicLevel, t + fadeS);
        } else g.setValueAtTime(musicLevel, t);
      }
    },

    osc(type, freq) {
      const c = ready();
      if (!c) return null;
      const o = count(c.createOscillator());
      o.type = type;
      o.frequency.value = freq;
      return o;
    },
    gain(v) {
      const c = ready();
      if (!c) return null;
      const g = count(c.createGain());
      g.gain.value = v;
      return g;
    },
    filter(type, freq, q) {
      const c = ready();
      if (!c) return null;
      const f = count(c.createBiquadFilter());
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    },
    noiseSrc() {
      const c = ready();
      if (!c || !noise) return null;
      const s = count(c.createBufferSource());
      s.buffer = noise;
      return s;
    },
    shaper(curve) {
      const c = ready();
      if (!c) return null;
      const w = count(c.createWaveShaper());
      w.curve = curve;
      return w;
    },
    delay(maxS) {
      const c = ready();
      if (!c) return null;
      return count(c.createDelay(maxS));
    },
    panner(pan) {
      const c = ready();
      if (!c || typeof c.createStereoPanner !== 'function') return null;
      const p = count(c.createStereoPanner());
      p.pan.value = Math.max(-1, Math.min(1, pan));
      return p;
    },
    trackVoice(n) {
      stats.voicesActive++;
      n.onended = () => {
        stats.voicesActive--;
      };
    },
    resetPeak() {
      stats.peak = 0;
      stats.clipSamples = 0;
    },
    samplePeak() {
      if (!analyser || !scope || !ready()) return;
      analyser.getFloatTimeDomainData(scope);
      let p = stats.peak;
      for (let i = 0; i < scope.length; i++) {
        const a = Math.abs(scope[i] ?? 0);
        if (a > p) p = a;
        if (a >= 0.99) stats.clipSamples++;
      }
      stats.peak = p;
    },
  };
  return engine;
}
