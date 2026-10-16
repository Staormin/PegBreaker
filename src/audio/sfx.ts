// audio/sfx.ts — propriétaire : audio-dev.
// Recettes de SFX synthétisées (oscillateurs, bruit filtré, enveloppes). Chaque appel crée ses
// nœuds, planifie stop(), et les laisse au ramasse-miettes : aucun nœud persistant par son.
// Les recettes sont inertes (no-op) si le contexte n'est pas prêt.
import type { BallElement, BlockKind, DropKind } from '../core/types';
import type { Engine } from './engine';

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
  blockExplode(): void;
  blockFrozen(): void;
  blockBreached(): void;
  lightningChain(): void;
  ballSplit(): void;
  comboMilestone(level: 1 | 2 | 3): void;
  dropCollected(kind: DropKind): void;
  /** spread 0..1 : le whoosh s'ouvre (filtre) et s'élargit (stéréo alternée) */
  volleyStart(count: number, spread?: number): void;
  volleyEnd(bestCombo: number): void;
  volleyFusion(): void;
  playerDamaged(): void;
  playerHealed(): void;
  /** source 'boss' : fanfare plus riche */
  rewardOffered(source?: 'wave' | 'boss'): void;
  rewardChosen(fuse: boolean): void;
  rewardSkipped(): void;
  shopOpened(): void;
  shopBought(): void;
  shopRerolled(): void;
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
    envelope(g.gain, t, o.gain, o.attack ?? 0.003, o.dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
    e.trackVoice(osc);
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
    envelope(g.gain, t, o.gain, o.attack ?? 0.002, o.dur);
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
      switch (element) {
        case 'fire':
          // grave et soufflé : bruit passe-bas qui s'ouvre lentement + corps grave
          noise({ filter: 'lowpass', f0: vary(700), f1: 180, q: 0.8, dur: 0.11, gain: 0.22, at: t, attack: 0.012 });
          tone({ type: 'sine', f0: vary(150), f1: 85, dur: 0.09, gain: 0.18, at: t });
          break;
        case 'lightning':
          // crépitement : trois éclats aigus irréguliers
          for (let i = 0; i < 3; i++) {
            const dt = i * (0.009 + Math.random() * 0.01);
            noise({ filter: 'highpass', f0: vary(3200, 0.2), q: 1, dur: 0.012, gain: 0.16, at: t + dt });
          }
          click(t, 0.05, 2400);
          break;
        case 'ice':
          // cristallin : deux sinus aigus non harmoniques + grain très aigu
          tone({ type: 'sine', f0: vary(2637), dur: 0.12, gain: 0.07, at: t });
          tone({ type: 'sine', f0: vary(3951), dur: 0.08, gain: 0.04, at: t + 0.005 });
          noise({ filter: 'bandpass', f0: 6000, q: 4, dur: 0.02, gain: 0.08, at: t });
          break;
        case 'ghost':
          // éthéré : deux sinus détunés, attaque douce, pas de transitoire
          tone({ type: 'sine', f0: vary(660), f1: 720, dur: 0.18, gain: 0.07, at: t, attack: 0.03 });
          tone({ type: 'sine', f0: vary(667), f1: 600, dur: 0.18, gain: 0.05, at: t, attack: 0.04 });
          break;
        case 'lead':
          // sourd : bruit très filtré + sub, pas de clic
          noise({ filter: 'lowpass', f0: 320, q: 1, dur: 0.06, gain: 0.28, at: t });
          tone({ type: 'sine', f0: vary(72), dur: 0.08, gain: 0.25, at: t });
          break;
        case 'split':
          // double clic
          noise({ filter: 'bandpass', f0: vary(1800), q: 2, dur: 0.025, gain: 0.14, at: t });
          click(t, 0.07);
          noise({ filter: 'bandpass', f0: vary(2200), q: 2, dur: 0.025, gain: 0.12, at: t + 0.035 });
          click(t + 0.035, 0.06, 1200);
          break;
        case 'stone':
        default:
          // neutre : recette de base (passe-bande 1 200 Hz Q 2, 40 ms + clic square 2 ms)
          noise({ filter: 'bandpass', f0: vary(1200), q: 2, dur: 0.04, gain: 0.18, at: t });
          click(t, 0.06);
          break;
      }
      if (crit) tone({ type: 'sine', f0: vary(1568), dur: 0.09, gain: 0.08, at: t + 0.01 });
    },

    blockDestroyed(kind, width) {
      const t = now();
      const big = Math.min(1.6, 1 + (width - 1) * 0.15);
      noise({ filter: 'lowpass', f0: vary(400), f1: 80, q: 1, dur: 0.12 * big, gain: 0.3, at: t });
      tone({ type: 'sine', f0: vary(90), dur: 0.08 * big, gain: 0.3, at: t });
      if (kind === 'heart') tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.15, gain: 0.08, at: t + 0.03 });
    },

    blockExplode() {
      const t = now();
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

    lightningChain() {
      const t = now();
      tone({ type: 'sawtooth', f0: vary(1800, 0.1), f1: 300, dur: 0.07, gain: 0.06, at: t });
      noise({ filter: 'highpass', f0: 2500, q: 0.7, dur: 0.03, gain: 0.12, at: t });
    },

    ballSplit() {
      const t = now();
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

    playerHealed() {
      const t = now();
      tone({ type: 'triangle', f0: 330, f1: 495, dur: 0.2, gain: 0.1, at: t, attack: 0.02 });
      tone({ type: 'sine', f0: 990, dur: 0.18, gain: 0.04, at: t + 0.08 });
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
