// audio/sfx.ts — propriétaire : audio-dev.
// Recettes de SFX synthétisées (oscillateurs, bruit filtré, enveloppes). Chaque appel crée ses
// nœuds, planifie stop(), et les laisse au ramasse-miettes : aucun nœud persistant par son.
// Les recettes sont inertes (no-op) si le contexte n'est pas prêt.
import type { BallElement, BallTier, BlockKind, DropKind } from '../core/types';
import type { Engine } from './engine';
import { FAMILY_HIT, HIT_VOICES, HYBRID_SECOND_DELAY_S, HYBRID_SECOND_GAIN, type ChainKind, type ExplodeKind, type HitVoice } from './hits';

const FLOOR = 0.0001;
/** demi-tons max pour le pitch des rebonds */
export const COMBO_PITCH_CAP = 24;

/** ±3 % de pitch pour casser l'effet mitraillette */
function vary(f: number, amount = 0.03): number {
  return f * (1 + (Math.random() * 2 - 1) * amount);
}

/** fréquence d'un rebond bloc/peg : un demi-ton par combo, plafonné */
export function bounceFreq(combo: number): number {
  const c = Math.max(0, Math.min(COMBO_PITCH_CAP, Math.floor(combo)));
  return 220 * Math.pow(2, c / 12);
}

interface ToneOpts {
  type: OscillatorType;
  f0: number;
  /** fréquence d'arrivée (rampe exponentielle sur sweep ou dur) */
  f1?: number;
  sweep?: number;
  dur: number;
  gain: number;
  at?: number;
  attack?: number;
  detune?: number;
  dest?: AudioNode | null;
  /** maintien au niveau crête après l'attaque (s), avant la décroissance */
  hold?: number;
  /** vibrato : LFO sinus dédié sur la fréquence */
  vibrato?: { hz: number; cents: number };
}

interface NoiseOpts {
  filter: BiquadFilterType;
  f0: number;
  f1?: number;
  q: number;
  dur: number;
  gain: number;
  at?: number;
  attack?: number;
  dest?: AudioNode | null;
  /** panoramique stéréo −1..1 (StereoPannerNode dédié à la voix, ignoré si absent) */
  pan?: number;
}

export interface Sfx {
  bounceWall(): void;
  bounceBlock(combo: number, peg: boolean): void;
  blockHit(element: BallElement, crit: boolean): void;
  blockDestroyed(kind: BlockKind, width: number): void;
  /** 'bomb' : plus grave et long ; 'nova' : court et scintillant ; 'divine' : nova dorée (souffle + accord) ;
   *  'steam' : souffle de vapeur ; 'supernova' : plus grand que nova ; 'missile' : explosion sèche */
  blockExplode(kind?: ExplodeKind): void;
  blockFrozen(): void;
  blockBreached(): void;
  /** 'prism' : balayage scintillant ; 'laser' : zap tenu 120 ms ; 'divine' : Jugement (tonnerre + accord) */
  lightningChain(kind?: ChainKind): void;
  /** crystal : éclats cristallins au lieu du « pop » de scission */
  ballSplit(crystal?: boolean): void;
  comboMilestone(level: 1 | 2 | 3): void;
  dropCollected(kind: DropKind): void;
  /** spread 0..1 : le whoosh s'ouvre (filtre) et s'élargit (stéréo alternée) */
  volleyStart(count: number, spread?: number): void;
  volleyEnd(bestCombo: number): void;
  volleyFusion(): void;
  playerDamaged(): void;
  /** vampire : couche grave « battement » en plus */
  playerHealed(vampire?: boolean): void;
  /** source 'boss' : fanfare plus riche */
  rewardOffered(source?: 'wave' | 'boss'): void;
  rewardChosen(fuse: boolean): void;
  rewardSkipped(): void;
  shopOpened(): void;
  shopBought(): void;
  shopRerolled(): void;
  /** vente : pièces qui tombent (3 dings descendants) */
  shopSold(): void;
  /** forge : marteau sur enclume (impact + résonance 600 ms) puis carillon de la couleur du résultat */
  shopForged(result: BallElement): void;
  /** upgrade d'hybride : montée de 2 notes + ting */
  shopUpgraded(tier: BallTier): void;
  waveCleared(): void;
  bossSpawned(): void;
  bossKilled(): void;
  runOver(): void;
  /** mort (avant seconde chance) : accord mineur tenu 1,2 s */
  runLost(): void;
  /** seconde chance : sweep montant + accord majeur */
  runRevived(): void;
  /** contrat proposé : deux notes douces */
  contractOffered(): void;
  /** progression de contrat : tic discret */
  contractProgress(ratio: number): void;
  /** contrat rempli : carillon ascendant + « cha-ching » si récompense en pièces */
  contractCompleted(coins: boolean): void;
  /** contrat raté : note sourde descendante */
  contractFailed(): void;
  /** lancement de la balle dorée : « ting » cristallin */
  goldenLaunch(): void;
  /** impact de la balle dorée : ping doré (en plus du son de bloc) */
  goldenPing(combo: number): void;
  achievement(): void;
  uiClick(): void;
}

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return c;
}

export function createSfx(e: Engine): Sfx {
  let distCurve: Float32Array<ArrayBuffer> | null = null;
  /** facteur de gain appliqué à tone/noise (seconde voix parente d'une hybride : −6 dB) */
  let level = 1;

  const now = (): number => (e.ctx ? e.ctx.currentTime + 0.004 : 0);

  function envelope(g: AudioParam, t: number, peak: number, attack: number, dur: number): void {
    g.setValueAtTime(FLOOR, t);
    g.exponentialRampToValueAtTime(Math.max(FLOOR * 2, peak), t + Math.max(0.001, attack));
    g.exponentialRampToValueAtTime(FLOOR, t + dur);
  }

  function tone(o: ToneOpts): void {
    const osc = e.osc(o.type, o.f0);
    const g = e.gain(FLOOR);
    const dest = o.dest === undefined ? e.sfxOut : o.dest;
    if (!osc || !g || !dest) return;
    const t = o.at ?? now();
    if (o.detune) osc.detune.value = o.detune;
    if (o.f1 !== undefined) {
      osc.frequency.setValueAtTime(o.f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.sweep ?? o.dur));
    }
    const peak = o.gain * level;
    if (o.hold !== undefined && o.hold > 0) {
      const a = Math.max(0.001, o.attack ?? 0.003);
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.exponentialRampToValueAtTime(Math.max(FLOOR * 2, peak), t + a);
      g.gain.setValueAtTime(Math.max(FLOOR * 2, peak), t + Math.min(o.dur * 0.9, a + o.hold));
      g.gain.exponentialRampToValueAtTime(FLOOR, t + o.dur);
    } else envelope(g.gain, t, peak, o.attack ?? 0.003, o.dur);
    if (o.vibrato) {
      const lfo = e.osc('sine', o.vibrato.hz);
      const depth = e.gain(o.f0 * (Math.pow(2, o.vibrato.cents / 1200) - 1));
      if (lfo && depth) {
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + o.dur + 0.02);
      }
    }
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
    e.trackVoice(osc);
  }

  /** chœur : 3 sinus détunés (−9, 0, +9 cents) avec vibrato 5,5 Hz, attaque douce */
  function choir(f: number, t: number, dur: number, gain: number, attack = 0.04): void {
    for (const det of [-9, 0, 9]) {
      tone({ type: 'sine', f0: f, detune: det, dur, gain: gain / 3, at: t, attack, hold: dur * 0.5, vibrato: { hz: 5.5 + det / 30, cents: 12 } });
    }
  }

  function noise(o: NoiseOpts): void {
    const src = e.noiseSrc();
    const f = e.filter(o.filter, o.f0, o.q);
    const g = e.gain(FLOOR);
    const dest = o.dest === undefined ? e.sfxOut : o.dest;
    if (!src || !f || !g || !dest) return;
    const t = o.at ?? now();
    if (o.f1 !== undefined) {
      f.frequency.setValueAtTime(o.f0, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + o.dur);
    }
    envelope(g.gain, t, o.gain * level, o.attack ?? 0.002, o.dur);
    src.connect(f);
    f.connect(g);
    const p = o.pan ? e.panner(o.pan) : null;
    if (p) {
      g.connect(p);
      p.connect(dest);
    } else g.connect(dest);
    // départ aléatoire dans le buffer d'1 s : deux bruits successifs ne sont jamais identiques
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.dur + 0.02);
    e.trackVoice(src);
  }

  const click = (t: number, gain: number, freq = 1000): void =>
    tone({ type: 'square', f0: freq, dur: 0.002, gain, at: t, attack: 0.0005 });

  const notes = (freqs: readonly number[], step: number, dur: number, gain: number, type: OscillatorType = 'triangle'): void => {
    const t = now();
    freqs.forEach((f, i) => tone({ type, f0: f, dur, gain, at: t + i * step, attack: 0.004 }));
  };

  /** voix de block:hit d'un élément à l'instant t (récursive pour les hybrides) */
  function voice(element: BallElement, t: number): void {
    const v = HIT_VOICES[element];
    const fam = FAMILY_HIT[v.family];
    switch (v.family) {
      case 'elemental':
        if (v.mode === 'crackle') {
          // crépitant : trois éclats passe-haut irréguliers + clic aigu
          for (let i = 0; i < 3; i++) {
            const dt = i * (0.009 + Math.random() * 0.01);
            noise({ filter: 'highpass', f0: vary(v.filterHz, 0.2), q: 1, dur: 0.012, gain: 0.16, at: t + dt });
          }
          click(t, 0.05, v.hz);
        } else {
          // soufflé : passe-bas qui se referme lentement + corps grave
          noise({ filter: 'lowpass', f0: vary(v.filterHz), f1: v.filterHz * 0.26, q: 0.8, dur: fam.dur, gain: 0.22, at: t, attack: 0.012 });
          tone({ type: 'sine', f0: vary(v.hz), f1: v.hz * 0.57, dur: fam.dur * 0.8, gain: 0.18, at: t });
        }
        if (v.layer === 'chime') {
          tone({ type: 'sine', f0: vary(v.hz), dur: 0.12, gain: 0.07, at: t });
          tone({ type: 'sine', f0: vary(v.hz * 1.498), dur: 0.08, gain: 0.04, at: t + 0.005 });
        } else if (v.layer === 'bubble') {
          tone({ type: 'sine', f0: vary(500), f1: 900, dur: 0.03, gain: 0.07, at: t + 0.03 });
          tone({ type: 'sine', f0: vary(700), f1: 1300, dur: 0.025, gain: 0.06, at: t + 0.058 });
        } else if (v.layer === 'trail') {
          noise({ filter: 'bandpass', f0: 800, f1: 4200, q: 2, dur: 0.07, gain: 0.08, at: t + 0.01, attack: 0.02 });
        }
        break;

      case 'heavy': {
        // sourd et gros : sub + bruit très étouffé, aucun clic
        const long = v.layer === 'boom' ? 1.9 : 1;
        const at = v.layer === 'fuse' ? t + 0.02 : t;
        if (v.layer === 'fuse') noise({ filter: 'highpass', f0: 5000, q: 0.7, dur: 0.02, gain: 0.06, at: t });
        noise({ filter: 'lowpass', f0: v.filterHz, q: 1, dur: 0.06 * long, gain: 0.28, at });
        tone({ type: 'sine', f0: vary(v.hz), f1: v.hz * 0.8, dur: fam.dur * long, gain: 0.27, at });
        if (v.layer === 'boom') tone({ type: 'triangle', f0: v.hz * 2, f1: v.hz * 1.5, dur: 0.12, gain: 0.12, at });
        else if (v.layer === 'buzz') {
          const lp = e.filter('lowpass', 600, 1);
          if (lp && e.sfxOut) {
            lp.connect(e.sfxOut);
            tone({ type: 'sawtooth', f0: vary(v.hz * 2), f1: v.hz * 1.6, dur: 0.06, gain: 0.1, at, dest: lp });
          }
        }
        break;
      }

      case 'tricky': {
        // deux sinus détunés, attaque douce, brefs
        const [p0 = 1, p1 = 1.012] = fam.partials;
        const f = vary(v.hz);
        const dur = fam.dur;
        let r0 = 1.09; // divergence par défaut (ghost)
        let r1 = 0.91;
        let attack = 0.025;
        if (v.layer === 'zip') {
          r0 = r1 = 0.5;
          attack = 0.003;
        } else if (v.layer === 'glide') {
          r0 = r1 = 1.12;
          attack = 0.012;
        } else if (v.layer === 'swing') {
          r0 = r1 = 1.26;
          attack = 0.01;
        }
        const sweep = v.layer === 'zip' ? 0.05 : v.layer === 'swing' ? 0.05 : dur;
        tone({ type: 'sine', f0: f * p0, f1: f * p0 * r0, sweep, dur, gain: 0.07, at: t, attack });
        tone({ type: 'sine', f0: f * p1, f1: f * p1 * r1, sweep, dur, gain: 0.05, at: t, attack: attack * 1.3 });
        if (v.layer === 'swing') {
          // retour : redescend sous la note de départ
          tone({ type: 'sine', f0: f * 1.26, f1: f * 0.9, dur: 0.07, gain: 0.05, at: t + 0.06, attack: 0.008 });
        } else if (v.layer === 'repeat') {
          tone({ type: 'sine', f0: f * p0, dur: dur * 0.8, gain: 0.03, at: t + 0.07, attack });
          tone({ type: 'sine', f0: f * p1, dur: dur * 0.8, gain: 0.02, at: t + 0.07, attack });
        }
        break;
      }

      case 'swarm': {
        // double clic rapide
        const gap = v.layer === 'third' ? 0.018 : v.layer === 'stereo' ? 0.025 : 0.035;
        const second = v.layer === 'stereo' ? v.filterHz : v.filterHz * 1.22;
        const pan = v.layer === 'stereo' ? 0.6 : 0;
        noise({ filter: 'bandpass', f0: vary(v.filterHz), q: 2, dur: fam.dur, gain: 0.14, at: t, pan: -pan });
        click(t, 0.07, v.hz);
        noise({ filter: 'bandpass', f0: vary(second), q: 2, dur: fam.dur, gain: 0.12, at: t + gap, pan });
        click(t + gap, 0.06, v.hz * 1.2);
        if (v.layer === 'third') {
          noise({ filter: 'bandpass', f0: vary(v.filterHz * 1.4), q: 2, dur: fam.dur * 0.8, gain: 0.1, at: t + gap * 2 });
        }
        break;
      }

      case 'greed': {
        // « ding » métallique : fondamentale + partiel inharmonique + clic
        const [, ratio = 2.76] = fam.partials;
        let dest: AudioNode | null | undefined;
        if (v.filterHz > 0) {
          const lp = e.filter('lowpass', v.filterHz, 0.7);
          if (lp && e.sfxOut) {
            lp.connect(e.sfxOut);
            dest = lp;
          }
        }
        const f = vary(v.hz, 0.01);
        tone({ type: 'sine', f0: f, dur: fam.dur, gain: 0.09, at: t, attack: 0.001, dest });
        tone({ type: 'sine', f0: f * ratio, dur: fam.dur * 0.45, gain: 0.03, at: t, attack: 0.001, dest });
        click(t, 0.04, 3000);
        if (v.layer === 'sparkle') {
          tone({ type: 'sine', f0: f * 1.498, dur: 0.1, gain: 0.06, at: t + 0.045, attack: 0.001 });
        } else if (v.layer === 'hum') {
          tone({ type: 'triangle', f0: v.hz / 10, f1: v.hz / 9, dur: 0.09, gain: 0.12, at: t, attack: 0.008 });
        } else if (v.layer === 'warm') {
          tone({ type: 'sine', f0: v.hz / 4, dur: 0.12, gain: 0.1, at: t, attack: 0.01 });
        }
        break;
      }

      case 'hybrid': {
        // les deux voix parentes : la première pleine, la seconde à −6 dB et +12 ms, puis la signature
        const [a, b] = v.parents ?? ['stone', 'stone'];
        voice(a, t);
        const prev = level;
        level = prev * HYBRID_SECOND_GAIN;
        try {
          voice(b, t + HYBRID_SECOND_DELAY_S);
        } finally {
          level = prev;
        }
        signature(v, t);
        break;
      }

      case 'divine': {
        // accord pur (fondamentale + quinte + octave) puis chœur bref
        const [p0 = 1, p1 = 1.5, p2 = 2] = fam.partials;
        const f = v.hz;
        tone({ type: 'sine', f0: f * p0, dur: fam.dur, gain: 0.08, at: t, attack: 0.004 });
        tone({ type: 'sine', f0: f * p1, dur: fam.dur * 0.9, gain: 0.06, at: t, attack: 0.004 });
        tone({ type: 'sine', f0: f * p2, dur: fam.dur * 0.8, gain: 0.05, at: t, attack: 0.004 });
        choir(f * p2, t + 0.02, 0.28, 0.07, 0.03);
        break;
      }

      case 'arcane':
      default: {
        if (v.layer === 'neutral') {
          // stone : recette de base (passe-bande 1 200 Hz Q 2, 40 ms + clic square 2 ms)
          noise({ filter: 'bandpass', f0: vary(v.filterHz), q: 2, dur: 0.04, gain: 0.18, at: t });
          click(t, 0.06);
          break;
        }
        // cristallin filtré : triangle dans un passe-bande résonant
        const bp = e.filter(fam.filter === 'none' ? 'bandpass' : fam.filter, v.filterHz, v.layer === 'suck' ? 1.5 : 6);
        if (!bp || !e.sfxOut) break;
        bp.connect(e.sfxOut);
        const f = vary(v.hz, 0.015);
        const dur = v.layer === 'ring' ? 0.25 : fam.dur;
        if (v.layer === 'suck') {
          bp.frequency.setValueAtTime(v.filterHz, t);
          bp.frequency.exponentialRampToValueAtTime(v.filterHz * 0.4, t + dur);
        }
        tone({ type: 'triangle', f0: f, f1: v.layer === 'suck' ? f * 0.5 : undefined, dur, gain: 0.22, at: t, attack: 0.002, dest: bp });
        tone({ type: 'sine', f0: f * 2, dur: dur * 0.4, gain: v.layer === 'ring' ? 0.04 : 0.02, at: t, attack: 0.001 });
        if (v.layer === 'fifth') tone({ type: 'triangle', f0: f * 1.498, dur: dur * 0.8, gain: 0.18, at: t + 0.012, attack: 0.002, dest: bp });
        else if (v.layer === 'burst') noise({ filter: 'highpass', f0: 6000, q: 0.7, dur: 0.03, gain: 0.08, at: t });
        else if (v.layer === 'grain') noise({ filter: 'bandpass', f0: vary(2500), q: 0.8, dur: 0.05, gain: 0.1, at: t });
        break;
      }
    }
  }

  /** signature propre d'une hybride (jouée après ses deux voix parentes) */
  function signature(v: HitVoice, t: number): void {
    switch (v.layer) {
      case 'vent': // steam : jet de vapeur qui siffle
        noise({ filter: 'highpass', f0: v.filterHz, f1: v.filterHz * 0.48, q: 0.7, dur: 0.11, gain: 0.09, at: t + 0.02, attack: 0.02 });
        break;
      case 'pew': // laser
        tone({ type: 'sine', f0: v.hz, f1: v.hz * 0.4, dur: 0.045, gain: 0.07, at: t + 0.015, attack: 0.002 });
        break;
      case 'scatter': // cluster : trois mini-pops éparpillés
        [1, 1.19, 0.89].forEach((r, i) =>
          tone({ type: 'sine', f0: vary(v.hz * r), f1: v.hz * r * 0.4, dur: 0.015, gain: 0.07, at: t + 0.03 + i * 0.02, attack: 0.001 }),
        );
        break;
      case 'phase': // wraith : battement grave spectral
        tone({ type: 'sine', f0: v.hz, dur: 0.14, gain: 0.06, at: t + 0.01, attack: 0.04 });
        tone({ type: 'sine', f0: v.hz + 3, dur: 0.14, gain: 0.06, at: t + 0.01, attack: 0.05 });
        break;
      case 'drip': // abyss : goutte dans le vide
        tone({ type: 'sine', f0: v.hz, f1: v.hz * 0.25, dur: 0.04, gain: 0.07, at: t + 0.05, attack: 0.001 });
        tone({ type: 'sine', f0: 80, dur: 0.1, gain: 0.12, at: t + 0.05, attack: 0.01 });
        break;
      case 'payout': // jackpot : trois dings montants
        [1, 1.189, 1.498].forEach((r, i) => tone({ type: 'sine', f0: v.hz * r, dur: 0.06, gain: 0.05, at: t + 0.03 + i * 0.025, attack: 0.001 }));
        break;
      case 'rumble': // quake : grondement
        noise({ filter: 'lowpass', f0: v.filterHz, q: 1, dur: 0.22, gain: 0.25, at: t, attack: 0.02 });
        tone({ type: 'sine', f0: v.hz, dur: 0.2, gain: 0.25, at: t, attack: 0.01 });
        break;
      case 'lock': // missile : double bip de verrouillage
        tone({ type: 'square', f0: v.hz, dur: 0.012, gain: 0.03, at: t + 0.03, attack: 0.001 });
        tone({ type: 'square', f0: v.hz, dur: 0.012, gain: 0.03, at: t + 0.06, attack: 0.001 });
        break;
      case 'flare': // supernova : souffle qui monte + éclat
        noise({ filter: 'highpass', f0: v.filterHz, f1: v.filterHz * 5, q: 0.7, dur: 0.08, gain: 0.06, at: t + 0.015, attack: 0.03 });
        tone({ type: 'triangle', f0: v.hz, dur: 0.12, gain: 0.04, at: t + 0.04, attack: 0.002 });
        break;
      case 'rot': { // plague : bourdon de scie grave étouffé
        const lp = e.filter('lowpass', v.filterHz, 1);
        if (!lp || !e.sfxOut) break;
        lp.connect(e.sfxOut);
        tone({ type: 'sawtooth', f0: v.hz, detune: -15, dur: 0.08, gain: 0.08, at: t + 0.02, attack: 0.008, dest: lp });
        tone({ type: 'sawtooth', f0: v.hz, detune: 15, dur: 0.08, gain: 0.08, at: t + 0.02, attack: 0.008, dest: lp });
        break;
      }
      case 'harmony': // choir : tierce majeure douce
        tone({ type: 'triangle', f0: v.hz, dur: 0.12, gain: 0.05, at: t + 0.02, attack: 0.02 });
        tone({ type: 'triangle', f0: v.hz * 1.26, dur: 0.12, gain: 0.05, at: t + 0.02, attack: 0.02 });
        break;
      case 'whirl': // orbit : doppler
        noise({ filter: 'bandpass', f0: v.filterHz, f1: v.filterHz * 4, q: 3, dur: 0.075, gain: 0.08, at: t, attack: 0.02 });
        noise({ filter: 'bandpass', f0: v.filterHz * 4, f1: v.filterHz, q: 3, dur: 0.075, gain: 0.08, at: t + 0.075, attack: 0.005 });
        break;
      case 'anvil': // hammer : tintement d'enclume inharmonique + sub
        tone({ type: 'sine', f0: v.hz, dur: 0.12, gain: 0.06, at: t, attack: 0.001 });
        tone({ type: 'sine', f0: v.hz * 2.488, dur: 0.08, gain: 0.03, at: t, attack: 0.001 });
        tone({ type: 'sine', f0: v.hz * 3.68, dur: 0.05, gain: 0.02, at: t, attack: 0.001 });
        tone({ type: 'sine', f0: 55, dur: 0.08, gain: 0.12, at: t, attack: 0.003 });
        break;
      default:
        break;
    }
  }

  return {
    bounceWall() {
      tone({ type: 'sine', f0: vary(180), f1: 120, sweep: 0.04, dur: 0.05, gain: 0.15 });
    },
    bounceBlock(combo, peg) {
      const f = vary(bounceFreq(combo));
      tone({ type: 'triangle', f0: f, dur: 0.06, gain: 0.2 });
      // peg : petit harmonique « tink » en plus
      if (peg) tone({ type: 'sine', f0: f * 3, dur: 0.03, gain: 0.05 });
    },

    blockHit(element, crit) {
      const t = now();
      voice(element, t);
      if (crit) tone({ type: 'sine', f0: vary(1568), dur: 0.09, gain: 0.08, at: t + 0.01 });
    },

    blockDestroyed(kind, width) {
      const t = now();
      const big = Math.min(1.6, 1 + (width - 1) * 0.15);
      noise({ filter: 'lowpass', f0: vary(400), f1: 80, q: 1, dur: 0.12 * big, gain: 0.3, at: t });
      tone({ type: 'sine', f0: vary(90), dur: 0.08 * big, gain: 0.3, at: t });
      if (kind === 'heart') tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.15, gain: 0.08, at: t + 0.03 });
    },

    blockExplode(kind = 'normal') {
      const t = now();
      if (kind === 'bomb') {
        // bombe : plus grave et plus long, en deux temps, sub qui retombe
        noise({ filter: 'lowpass', f0: 1400, f1: 40, q: 0.7, dur: 0.6, gain: 0.55, at: t });
        noise({ filter: 'lowpass', f0: 700, f1: 40, q: 0.7, dur: 0.45, gain: 0.3, at: t + 0.12 });
        tone({ type: 'sine', f0: 44, f1: 26, dur: 0.6, gain: 0.5, at: t });
        return;
      }
      if (kind === 'divine') {
        // nova dorée : souffle + accord majeur pur (do-mi-sol-do) + sub
        noise({ filter: 'lowpass', f0: 3000, f1: 200, q: 0.7, dur: 0.3, gain: 0.3, at: t });
        noise({ filter: 'highpass', f0: 5000, f1: 9000, q: 0.7, dur: 0.2, gain: 0.05, at: t + 0.02 });
        for (const f of [523.25, 659.3, 784.9, 1046.5]) tone({ type: 'sine', f0: f, dur: 0.35, gain: 0.04, at: t + 0.015, attack: 0.005 });
        tone({ type: 'sine', f0: 65.4, dur: 0.2, gain: 0.2, at: t, attack: 0.004 });
        return;
      }
      if (kind === 'steam') {
        // souffle de vapeur : bruit large qui s'assombrit, sifflement, « whoomp » grave
        noise({ filter: 'bandpass', f0: 2800, f1: 1200, q: 0.8, dur: 0.4, gain: 0.25, at: t, attack: 0.03 });
        noise({ filter: 'highpass', f0: 6000, q: 0.7, dur: 0.3, gain: 0.06, at: t + 0.02, attack: 0.05 });
        tone({ type: 'sine', f0: 90, f1: 60, dur: 0.15, gain: 0.15, at: t });
        return;
      }
      if (kind === 'supernova') {
        // plus grand que nova : souffle long, 6 partiels échelonnés, sub qui retombe
        noise({ filter: 'lowpass', f0: 4000, f1: 80, q: 0.7, dur: 0.5, gain: 0.45, at: t });
        noise({ filter: 'highpass', f0: 5000, f1: 10000, q: 0.7, dur: 0.3, gain: 0.07, at: t + 0.02 });
        [1760, 2217.5, 2637, 3520, 4434.9, 5274].forEach((f, i) =>
          tone({ type: 'sine', f0: vary(f, 0.01), dur: 0.4, gain: 0.04, at: t + 0.02 + i * 0.02, attack: 0.002 }),
        );
        tone({ type: 'sine', f0: 48, f1: 30, dur: 0.45, gain: 0.4, at: t });
        return;
      }
      if (kind === 'missile') {
        // explosion sèche : crack, corps court, sub bref, aucune queue
        noise({ filter: 'highpass', f0: 3000, q: 0.7, dur: 0.015, gain: 0.2, at: t, attack: 0.0005 });
        noise({ filter: 'lowpass', f0: 3000, f1: 100, q: 0.7, dur: 0.15, gain: 0.45, at: t });
        tone({ type: 'sine', f0: 70, f1: 40, dur: 0.12, gain: 0.4, at: t });
        return;
      }
      if (kind === 'nova') {
        // nova : souffle court + scintillement (4 partiels aigus échelonnés)
        noise({ filter: 'lowpass', f0: 3000, f1: 200, q: 0.7, dur: 0.2, gain: 0.3, at: t });
        noise({ filter: 'highpass', f0: 5000, f1: 9000, q: 0.7, dur: 0.18, gain: 0.06, at: t + 0.02 });
        [1760, 2217.5, 2637, 3520].forEach((f, i) =>
          tone({ type: 'sine', f0: vary(f, 0.01), dur: 0.25, gain: 0.045, at: t + 0.02 + i * 0.025, attack: 0.002 }),
        );
        return;
      }
      noise({ filter: 'lowpass', f0: 2000, f1: 60, q: 0.7, dur: 0.35, gain: 0.5, at: t });
      tone({ type: 'sine', f0: 50, f1: 38, dur: 0.3, gain: 0.45, at: t });
    },

    blockFrozen() {
      const t = now();
      noise({ filter: 'bandpass', f0: 8000, f1: 3000, q: 3, dur: 0.15, gain: 0.1, at: t });
      tone({ type: 'sine', f0: vary(2093), dur: 0.14, gain: 0.05, at: t + 0.01 });
      tone({ type: 'sine', f0: vary(3136), dur: 0.1, gain: 0.04, at: t + 0.04 });
    },

    blockBreached() {
      const t = now();
      tone({ type: 'sine', f0: 65, f1: 40, dur: 0.22, gain: 0.45, at: t });
      noise({ filter: 'bandpass', f0: 300, q: 1.5, dur: 0.1, gain: 0.25, at: t });
      tone({ type: 'triangle', f0: 330, f1: 165, dur: 0.2, gain: 0.14, at: t + 0.04 });
    },

    lightningChain(kind = 'arc') {
      const t = now();
      if (kind === 'divine') {
        // Jugement : coup de tonnerre grave (crack + roulement + sub), puis accord pur et chœur
        noise({ filter: 'highpass', f0: 2500, q: 0.7, dur: 0.04, gain: 0.2, at: t, attack: 0.001 });
        noise({ filter: 'lowpass', f0: 500, f1: 50, q: 0.7, dur: 0.9, gain: 0.5, at: t, attack: 0.005 });
        noise({ filter: 'lowpass', f0: 300, f1: 50, q: 0.7, dur: 0.6, gain: 0.25, at: t + 0.15, attack: 0.03 });
        tone({ type: 'sine', f0: 45, f1: 30, dur: 0.8, gain: 0.4, at: t, attack: 0.005 });
        const c = t + 0.35;
        for (const f of [261.6, 392.4, 523.25, 784.9]) tone({ type: 'sine', f0: f, dur: 0.7, gain: 0.05, at: c, attack: 0.02 });
        choir(523.25, c, 0.6, 0.06);
        return;
      }
      if (kind === 'laser') {
        // zap tenu 120 ms : scie + carré légèrement détunés, filtrés, vibrato rapide
        const lp = e.filter('lowpass', 3500, 1.5);
        if (!lp || !e.sfxOut) return;
        lp.connect(e.sfxOut);
        tone({ type: 'sawtooth', f0: vary(1800, 0.03), f1: 1500, dur: 0.12, hold: 0.09, gain: 0.05, at: t, attack: 0.003, dest: lp, vibrato: { hz: 40, cents: 30 } });
        tone({ type: 'square', f0: 1810, f1: 1510, dur: 0.12, hold: 0.09, gain: 0.025, at: t, attack: 0.003, dest: lp });
        return;
      }
      if (kind === 'prism') {
        // rayon de prisme : balayage montant + quinte, grain très aigu
        tone({ type: 'sine', f0: vary(1200, 0.05), f1: 2400, dur: 0.09, gain: 0.06, at: t, attack: 0.004 });
        tone({ type: 'triangle', f0: vary(1800, 0.05), f1: 3600, dur: 0.08, gain: 0.04, at: t + 0.01, attack: 0.004 });
        noise({ filter: 'highpass', f0: 6000, q: 0.7, dur: 0.05, gain: 0.05, at: t });
        return;
      }
      tone({ type: 'sawtooth', f0: vary(1800, 0.1), f1: 300, dur: 0.07, gain: 0.06, at: t });
      noise({ filter: 'highpass', f0: 2500, q: 0.7, dur: 0.03, gain: 0.12, at: t });
    },

    ballSplit(crystal = false) {
      const t = now();
      if (crystal) {
        // éclatement du cristal : éclats sinus aigus échelonnés + grésil
        noise({ filter: 'highpass', f0: 5000, q: 0.7, dur: 0.06, gain: 0.08, at: t });
        [3136, 4186, 3729, 5274].forEach((f, i) =>
          tone({ type: 'sine', f0: vary(f, 0.02), dur: 0.12, gain: 0.04, at: t + i * (0.012 + Math.random() * 0.01), attack: 0.001 }),
        );
        return;
      }
      tone({ type: 'sine', f0: vary(900), f1: 1300, dur: 0.07, gain: 0.08, at: t });
      tone({ type: 'sine', f0: vary(900), f1: 650, dur: 0.07, gain: 0.08, at: t });
    },

    comboMilestone(level) {
      // arpège majeur (La majeur : la, do#, mi)
      const base = [880, 1108.7, 1318.5];
      if (level === 1) notes(base, 0.05, 0.08, 0.12);
      else if (level === 2) notes([...base, 1760], 0.05, 0.09, 0.13);
      else {
        notes([...base, 1760], 0.04, 0.08, 0.1);
        const t = now() + 0.16;
        for (const f of [440, 554.4, 659.3, 880]) tone({ type: 'triangle', f0: f, dur: 0.3, gain: 0.07, at: t, attack: 0.01 });
        tone({ type: 'sine', f0: 400, f1: 2400, dur: 0.3, gain: 0.05, at: t });
      }
    },

    dropCollected(kind) {
      const t = now();
      if (kind === 'coin') {
        tone({ type: 'sine', f0: vary(1320, 0.01), dur: 0.06, gain: 0.1, at: t });
        tone({ type: 'sine', f0: vary(1760, 0.01), dur: 0.06, gain: 0.1, at: t + 0.06 });
      } else if (kind === 'ball') {
        tone({ type: 'sine', f0: 400, f1: 900, dur: 0.12, gain: 0.12, at: t });
      } else if (kind === 'fragment') {
        for (const [i, f] of [1318.5, 1661.2, 1975.5].entries()) {
          tone({ type: 'sine', f0: f, dur: 0.25, gain: 0.05, at: t + i * 0.015 });
        }
      } else {
        tone({ type: 'triangle', f0: 440, dur: 0.1, gain: 0.1, at: t });
        tone({ type: 'triangle', f0: 554.4, dur: 0.14, gain: 0.1, at: t + 0.08 });
      }
    },

    volleyStart(count, spread = 0) {
      // whoosh qui s'étire avec la taille de la volée et s'ouvre avec l'éventail
      const sp = Math.max(0, Math.min(1, spread));
      const dur = Math.min(0.45, 0.12 + Math.max(0, count) * 0.01);
      const q = 1.2 - 0.7 * sp; // bande plus large
      const f1 = 2600 + 3400 * sp; // filtre plus ouvert
      if (sp < 0.05) {
        noise({ filter: 'bandpass', f0: 400, f1, q, dur, gain: 0.16, attack: dur * 0.4 });
        return;
      }
      // couches alternées gauche/droite, écart stéréo proportionnel au spread
      const t = now();
      const layers = 1 + Math.round(sp * 3); // 2..4
      for (let i = 0; i < layers; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        noise({
          filter: 'bandpass',
          f0: vary(400 + 120 * i, 0.08),
          f1: vary(f1, 0.08),
          q,
          dur,
          gain: 0.16 / Math.sqrt(layers) + 0.02 * sp,
          attack: dur * 0.4,
          at: t + i * 0.018 * sp,
          pan: side * sp * 0.9,
        });
      }
    },

    volleyEnd(bestCombo) {
      const t = now();
      tone({ type: 'sine', f0: 440, f1: 330, dur: 0.12, gain: 0.06, at: t });
      if (bestCombo >= 20) tone({ type: 'triangle', f0: 659.3, dur: 0.14, gain: 0.05, at: t + 0.06 });
    },

    volleyFusion() {
      const t = now();
      tone({ type: 'sine', f0: 300, f1: 1200, dur: 0.2, gain: 0.14, at: t });
      noise({ filter: 'highpass', f0: 2000, q: 0.7, dur: 0.04, gain: 0.08, at: t });
      tone({ type: 'sine', f0: 1600, f1: 400, dur: 0.035, gain: 0.18, at: t + 0.2 });
    },

    playerDamaged() {
      const t = now();
      const sh = e.shaper((distCurve ??= distortionCurve(40)));
      const lp = e.filter('lowpass', 1800, 0.7);
      if (!sh || !lp || !e.sfxOut) return;
      sh.connect(lp);
      lp.connect(e.sfxOut);
      tone({ type: 'sawtooth', f0: 110, dur: 0.25, gain: 0.25, at: t, detune: -12, dest: sh });
      tone({ type: 'sawtooth', f0: 110, dur: 0.25, gain: 0.25, at: t, detune: 14, dest: sh });
    },

    playerHealed(vampire = false) {
      const t = now();
      tone({ type: 'triangle', f0: 330, f1: 495, dur: 0.2, gain: 0.1, at: t, attack: 0.02 });
      tone({ type: 'sine', f0: 990, dur: 0.18, gain: 0.04, at: t + 0.08 });
      if (vampire) {
        // battement grave (deux pulsations) : la vie aspirée
        tone({ type: 'sine', f0: 98, dur: 0.07, gain: 0.14, at: t, attack: 0.008 });
        tone({ type: 'sine', f0: 92, dur: 0.09, gain: 0.11, at: t + 0.13, attack: 0.008 });
      }
    },

    rewardOffered(source = 'wave') {
      if (source !== 'boss') {
        notes([659.3, 880, 1108.7], 0.09, 0.16, 0.09);
        return;
      }
      // fanfare de boss : appel cuivré (scie filtrée) en 4 notes, accord tenu la majeur + quinte, scintillement
      const t = now();
      const lp = e.filter('lowpass', 1800, 0.9);
      if (!lp || !e.sfxOut) return;
      lp.connect(e.sfxOut);
      const call = [440, 554.4, 659.3, 880];
      call.forEach((f, i) => {
        const at = t + i * 0.1;
        tone({ type: 'sawtooth', f0: f, dur: i === 3 ? 0.55 : 0.11, gain: 0.06, at, attack: 0.01, detune: -6, dest: lp });
        tone({ type: 'sawtooth', f0: f, dur: i === 3 ? 0.55 : 0.11, gain: 0.05, at, attack: 0.01, detune: 7, dest: lp });
      });
      const held = t + 0.3;
      for (const f of [220, 440, 554.4, 659.3, 1318.5]) tone({ type: 'triangle', f0: f, dur: 0.6, gain: 0.05, at: held, attack: 0.02 });
      tone({ type: 'sine', f0: 110, dur: 0.5, gain: 0.12, at: held, attack: 0.01 });
      [1760, 2217.5, 2637].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 0.2, gain: 0.03, at: held + 0.08 + i * 0.05 }));
    },

    rewardChosen(fuse) {
      const t = now();
      if (fuse) {
        // fusion : deux voix qui convergent vers la même note, puis pop + carillon
        tone({ type: 'sine', f0: 300, f1: 660, dur: 0.24, gain: 0.1, at: t });
        tone({ type: 'sine', f0: 1320, f1: 660, dur: 0.24, gain: 0.08, at: t });
        tone({ type: 'sine', f0: 1600, f1: 500, dur: 0.035, gain: 0.16, at: t + 0.24 });
        tone({ type: 'triangle', f0: 1320, dur: 0.15, gain: 0.07, at: t + 0.26 });
      } else {
        tone({ type: 'triangle', f0: 880, dur: 0.08, gain: 0.1, at: t });
        tone({ type: 'triangle', f0: 1318.5, dur: 0.14, gain: 0.1, at: t + 0.07 });
      }
    },

    rewardSkipped() {
      notes([659.3, 523.3], 0.07, 0.1, 0.07);
    },

    shopOpened() {
      // clochette de porte
      const t = now();
      tone({ type: 'sine', f0: 1318.5, dur: 0.3, gain: 0.08, at: t });
      tone({ type: 'sine', f0: 987.8, dur: 0.35, gain: 0.08, at: t + 0.09 });
    },

    shopBought() {
      const t = now();
      noise({ filter: 'bandpass', f0: 3000, q: 3, dur: 0.02, gain: 0.1, at: t });
      tone({ type: 'sine', f0: 1568, dur: 0.07, gain: 0.1, at: t + 0.02 });
      tone({ type: 'sine', f0: 2093, dur: 0.12, gain: 0.1, at: t + 0.08 });
    },

    shopRerolled() {
      const t = now();
      for (let i = 0; i < 3; i++) noise({ filter: 'bandpass', f0: vary(2500, 0.15), q: 3, dur: 0.02, gain: 0.1, at: t + i * 0.04 });
    },

    shopSold() {
      // pièces qui tombent : 3 dings descendants, écarts qui raccourcissent (rebonds), clink aigu
      const t = now();
      [2637, 2349.3, 1975.5].forEach((f, i) => {
        const at = t + [0, 0.09, 0.15][i]!;
        const g = 0.09 - i * 0.015;
        tone({ type: 'sine', f0: vary(f, 0.01), dur: 0.12, gain: g, at, attack: 0.001 });
        tone({ type: 'sine', f0: f * 2.76, dur: 0.05, gain: g * 0.3, at, attack: 0.001 });
        noise({ filter: 'highpass', f0: 6000, q: 0.7, dur: 0.008, gain: 0.05, at });
      });
    },

    shopForged(result) {
      const t = now();
      const v = HIT_VOICES[result];
      const divine = v.family === 'divine';
      // marteau sur enclume : impact (claquement + thump) puis résonance métallique inharmonique 600 ms
      noise({ filter: 'bandpass', f0: 2500, q: 1.5, dur: 0.03, gain: 0.3, at: t, attack: 0.0005 });
      noise({ filter: 'lowpass', f0: 600, q: 0.7, dur: 0.06, gain: 0.2, at: t });
      tone({ type: 'sine', f0: 180, f1: 90, dur: 0.08, gain: 0.3, at: t });
      [
        [987.8, 0.6, 0.07],
        [2463, 0.45, 0.04],
        [4012, 0.3, 0.025],
        [5480, 0.2, 0.015],
      ].forEach(([f = 0, d = 0, g = 0]) => tone({ type: 'sine', f0: f, dur: d, gain: g, at: t, attack: 0.001 }));
      // carillon de la couleur du résultat
      const root = v.chimeHz ?? 880;
      const c = t + 0.3;
      if (!divine) {
        [1, 1.26, 1.498, 2].forEach((r, i) => {
          tone({ type: 'sine', f0: root * r, dur: 0.5, gain: 0.06, at: c + i * 0.07, attack: 0.002 });
          tone({ type: 'triangle', f0: root * r * 2, dur: 0.2, gain: 0.015, at: c + i * 0.07, attack: 0.002 });
        });
        return;
      }
      // Divine : carillon plus riche (5 notes, octave, dixième, douzième), sub, chœur tenu 1,2 s, scintillement
      [1, 1.498, 2, 2.52, 3].forEach((r, i) => {
        tone({ type: 'sine', f0: root * r, dur: 0.8, gain: 0.055, at: c + i * 0.06, attack: 0.002 });
        tone({ type: 'sine', f0: root * r * 2, dur: 0.25, gain: 0.012, at: c + i * 0.06, attack: 0.002 });
      });
      tone({ type: 'sine', f0: root / 2, dur: 1.2, gain: 0.08, at: c, attack: 0.05, hold: 0.6 });
      choir(root, c + 0.05, 1.2, 0.12, 0.15);
      choir(root * 1.498, c + 0.05, 1.2, 0.06, 0.2);
      noise({ filter: 'highpass', f0: 7000, f1: 11000, q: 0.7, dur: 0.6, gain: 0.03, at: c + 0.1, attack: 0.2 });
    },

    shopUpgraded(tier) {
      // montée de 2 notes (plus haut au rang III) + ting
      const t = now();
      const [a, b] = tier >= 3 ? [1046.5, 1396.9] : [784, 1046.5];
      tone({ type: 'triangle', f0: a, dur: 0.1, gain: 0.1, at: t, attack: 0.004 });
      tone({ type: 'triangle', f0: b, dur: 0.14, gain: 0.1, at: t + 0.08, attack: 0.004 });
      tone({ type: 'sine', f0: 3951, dur: 0.22, gain: 0.05, at: t + 0.17, attack: 0.001 });
      tone({ type: 'sine', f0: 5919.9, dur: 0.12, gain: 0.02, at: t + 0.17, attack: 0.001 });
    },

    waveCleared() {
      // fanfare courte montante (la majeur), dernière note tenue avec sa quinte
      const t = now();
      const seq = [440, 554.4, 659.3];
      seq.forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.09, gain: 0.04, at: t + i * 0.08 }));
      tone({ type: 'triangle', f0: 880, dur: 0.32, gain: 0.1, at: t + 0.24, attack: 0.01 });
      tone({ type: 'triangle', f0: 1318.5, dur: 0.32, gain: 0.06, at: t + 0.24, attack: 0.01 });
    },

    bossSpawned() {
      // nappe menaçante : seconde mineure grave, filtre qui respire, sub
      const t = now();
      const lp = e.filter('lowpass', 200, 4);
      const g = e.gain(FLOOR);
      const a = e.osc('sawtooth', 55);
      const b = e.osc('sawtooth', 58.27);
      if (!lp || !g || !a || !b || !e.sfxOut) return;
      lp.frequency.setValueAtTime(180, t);
      lp.frequency.exponentialRampToValueAtTime(900, t + 0.8);
      lp.frequency.exponentialRampToValueAtTime(150, t + 1.8);
      g.gain.setValueAtTime(FLOOR, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.4);
      g.gain.setValueAtTime(0.22, t + 1.2);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 1.9);
      a.connect(lp);
      b.connect(lp);
      lp.connect(g);
      g.connect(e.sfxOut);
      a.start(t);
      b.start(t);
      a.stop(t + 1.95);
      b.stop(t + 1.95);
      e.trackVoice(a);
      tone({ type: 'sine', f0: 41, dur: 1.6, gain: 0.3, at: t, attack: 0.3 });
    },

    bossKilled() {
      // explosion longue en deux temps + sub qui retombe
      const t = now();
      noise({ filter: 'lowpass', f0: 3000, f1: 40, q: 0.7, dur: 1.4, gain: 0.55, at: t });
      noise({ filter: 'lowpass', f0: 1500, f1: 50, q: 0.7, dur: 0.9, gain: 0.35, at: t + 0.18 });
      tone({ type: 'sine', f0: 60, f1: 28, dur: 1.1, gain: 0.45, at: t });
      tone({ type: 'triangle', f0: 880, f1: 1760, dur: 0.5, gain: 0.05, at: t + 0.5, attack: 0.05 });
    },

    runOver() {
      // descente chromatique de 4 notes, 600 ms
      notes([440, 415.3, 392, 370], 0.15, 0.2, 0.1);
    },

    runLost() {
      // la mineur grave (la, do, mi + basse), tenu 1,2 s, filtre qui se referme
      const t = now();
      const lp = e.filter('lowpass', 1400, 0.7);
      if (!lp || !e.sfxOut) return;
      lp.frequency.setValueAtTime(1400, t);
      lp.frequency.exponentialRampToValueAtTime(350, t + 1.2);
      lp.connect(e.sfxOut);
      for (const [i, f] of [110, 220, 261.6, 329.6].entries()) {
        tone({ type: i === 0 ? 'sine' : 'triangle', f0: f, dur: 1.2, gain: i === 0 ? 0.14 : 0.07, at: t, attack: 0.04, detune: (i - 1.5) * 4, dest: lp });
      }
    },

    runRevived() {
      // sweep montant puis la majeur lumineux
      const t = now();
      tone({ type: 'sine', f0: 200, f1: 1600, sweep: 0.35, dur: 0.38, gain: 0.1, at: t, attack: 0.05 });
      noise({ filter: 'bandpass', f0: 500, f1: 5000, q: 1, dur: 0.35, gain: 0.06, at: t, attack: 0.2 });
      const c = t + 0.34;
      for (const f of [220, 440, 554.4, 659.3, 880]) tone({ type: 'triangle', f0: f, dur: 0.6, gain: 0.06, at: c, attack: 0.01 });
      tone({ type: 'sine', f0: 1760, dur: 0.4, gain: 0.03, at: c + 0.05 });
    },

    contractOffered() {
      // « nouvelle mission » : quarte montante douce
      const t = now();
      tone({ type: 'sine', f0: 659.3, dur: 0.18, gain: 0.08, at: t, attack: 0.02 });
      tone({ type: 'sine', f0: 880, dur: 0.26, gain: 0.08, at: t + 0.13, attack: 0.02 });
      tone({ type: 'triangle', f0: 1760, dur: 0.2, gain: 0.015, at: t + 0.13, attack: 0.03 });
    },

    contractProgress(ratio) {
      // tic discret, légèrement plus aigu à mesure que le contrat avance
      const r = Math.max(0, Math.min(1, ratio));
      tone({ type: 'sine', f0: 1400 * Math.pow(2, (r * 7) / 12), dur: 0.025, gain: 0.04, attack: 0.001 });
    },

    contractCompleted(coins) {
      // carillon ascendant (mi, sol#, si) puis « cha-ching » si pièces
      const t = now();
      [1318.5, 1661.2, 1975.5].forEach((f, i) => {
        tone({ type: 'sine', f0: f, dur: 0.22, gain: 0.08, at: t + i * 0.08 });
        tone({ type: 'sine', f0: f * 2, dur: 0.1, gain: 0.015, at: t + i * 0.08 });
      });
      if (coins) {
        const c = t + 0.3;
        noise({ filter: 'highpass', f0: 4000, q: 0.8, dur: 0.05, gain: 0.1, at: c }); // « cha »
        noise({ filter: 'bandpass', f0: 6000, q: 3, dur: 0.12, gain: 0.07, at: c + 0.07 });
        tone({ type: 'sine', f0: 2637, dur: 0.25, gain: 0.07, at: c + 0.07 }); // « ching »
        tone({ type: 'sine', f0: 3520, dur: 0.2, gain: 0.04, at: c + 0.075 });
      }
    },

    contractFailed() {
      // note sourde descendante, courte
      const t = now();
      const lp = e.filter('lowpass', 700, 0.7);
      if (!lp || !e.sfxOut) return;
      lp.connect(e.sfxOut);
      tone({ type: 'triangle', f0: 220, f1: 155, dur: 0.24, gain: 0.14, at: t, attack: 0.01, dest: lp });
      tone({ type: 'sine', f0: 110, f1: 78, dur: 0.22, gain: 0.08, at: t, attack: 0.01 });
    },

    goldenLaunch() {
      // « ting » cristallin : partiels inharmoniques aigus, attaque nette, queue courte
      const t = now();
      tone({ type: 'sine', f0: 2637, dur: 0.3, gain: 0.08, at: t, attack: 0.001 });
      tone({ type: 'sine', f0: 3951, dur: 0.2, gain: 0.04, at: t, attack: 0.001 });
      tone({ type: 'sine', f0: 6643, dur: 0.1, gain: 0.015, at: t, attack: 0.001 });
      noise({ filter: 'highpass', f0: 7000, q: 0.7, dur: 0.015, gain: 0.05, at: t });
    },

    goldenPing(combo) {
      // ping doré : cloche aiguë qui suit (doucement) le combo
      const t = now() + 0.005;
      const f = 1975.5 * Math.pow(2, Math.min(12, Math.max(0, combo)) / 24);
      tone({ type: 'sine', f0: vary(f, 0.01), dur: 0.16, gain: 0.06, at: t, attack: 0.001 });
      tone({ type: 'sine', f0: f * 2.76, dur: 0.07, gain: 0.02, at: t, attack: 0.001 });
    },

    achievement() {
      notes([1318.5, 1568, 1975.5, 2637], 0.05, 0.12, 0.05, 'sine');
    },

    uiClick() {
      tone({ type: 'square', f0: 800, dur: 0.015, gain: 0.1, attack: 0.001 });
    },
  };
}
