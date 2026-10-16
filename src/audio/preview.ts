// audio/preview.ts — propriétaire : audio-dev. Page de dev : un bouton par recette.
// Les boutons émettent de vrais GameEvent sur un bus local : on teste le même chemin que le jeu
// (dispatch + limiteur + recettes). `npm run dev` puis /src/audio/preview.html
import { createEventBus } from '../core/events';
import type { BallElement, GameEvent, RewardOption } from '../core/types';
import { createAudio, type AudioSystemDev } from './index';

const P = { x: 4, y: 6 };
const N = { x: 0, y: -1 };
const ELEMENTS: BallElement[] = ['stone', 'fire', 'lightning', 'ice', 'ghost', 'lead', 'split'];
const FUSE: RewardOption = { kind: 'fuse', element: 'fire', tier: 2 };
const BALL: RewardOption = { kind: 'ball', element: 'ice', tier: 1 };

interface Entry {
  label: string;
  events: () => GameEvent[];
}

function hit(element: BallElement, crit = false): GameEvent {
  return { type: 'block:hit', blockId: 1, pos: P, damage: 10, combo: 3, element, hpLeft: 20, crit };
}

const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: 'Rebonds',
    entries: [
      { label: 'mur', events: () => [{ type: 'ball:bounce', ballId: 1, pos: P, normal: N, surface: 'wall', combo: 0 }] },
      { label: 'peg', events: () => [{ type: 'ball:bounce', ballId: 1, pos: P, normal: N, surface: 'peg', combo: 4 }] },
      ...[0, 6, 12, 24, 160].map((c) => ({
        label: `bloc combo ${c}`,
        events: (): GameEvent[] => [{ type: 'ball:bounce', ballId: 1, pos: P, normal: N, surface: 'block', combo: c }],
      })),
    ],
  },
  {
    title: 'block:hit par élément',
    entries: [
      ...ELEMENTS.map((el) => ({ label: el, events: (): GameEvent[] => [hit(el)] })),
      { label: 'stone crit', events: () => [hit('stone', true)] },
    ],
  },
  {
    title: 'Blocs',
    entries: [
      { label: 'destroyed', events: () => [{ type: 'block:destroyed', blockId: 1, kind: 'normal', pos: P, width: 1, element: 'stone' }] },
      { label: 'destroyed heart', events: () => [{ type: 'block:destroyed', blockId: 1, kind: 'heart', pos: P, width: 1, element: 'stone' }] },
      { label: 'explode', events: () => [{ type: 'block:explode', pos: P, radius: 1.5, damage: 20 }] },
      { label: 'frozen', events: () => [{ type: 'block:frozen', blockId: 1, pos: P }] },
      { label: 'breached', events: () => [{ type: 'block:breached', blockId: 1, kind: 'normal', damage: 1 }] },
      { label: 'lightning:chain', events: () => [{ type: 'lightning:chain', from: P, to: P, damage: 5 }] },
      { label: 'ball:split', events: () => [{ type: 'ball:split', pos: P }] },
    ],
  },
  {
    title: 'Combo et volée',
    entries: [
      ...([1, 2, 3] as const).map((level) => ({
        label: `milestone ${level}`,
        events: (): GameEvent[] => [{ type: 'combo:milestone', combo: level * 10, pos: P, level }],
      })),
      ...[5, 15, 30].map((count) => ({
        label: `volley:start ×${count}`,
        events: (): GameEvent[] => [{ type: 'volley:start', count, from: P, dir: N }],
      })),
      { label: 'volley:end', events: () => [{ type: 'volley:end', shotDamage: 300, bestCombo: 40 }] },
      { label: 'volley:fusion', events: () => [{ type: 'volley:fusion', element: 'fire', tier: 2, index: 0, pos: P }] },
    ],
  },
  {
    title: 'Drops',
    entries: (['coin', 'ball', 'fragment', 'heart'] as const).map((kind) => ({
      label: kind,
      events: (): GameEvent[] => [{ type: 'drop:collected', dropId: 1, kind, pos: P, value: 1 }],
    })),
  },
  {
    title: 'Joueur, récompenses, boutique',
    entries: [
      { label: 'player:damaged', events: () => [{ type: 'player:damaged', amount: 1, hpLeft: 2 }] },
      { label: 'player:healed', events: () => [{ type: 'player:healed', amount: 1, hpLeft: 3 }] },
      { label: 'reward:offered', events: () => [{ type: 'reward:offered', options: [BALL, FUSE] }] },
      { label: 'reward:chosen', events: () => [{ type: 'reward:chosen', option: BALL }] },
      { label: 'reward:chosen fuse', events: () => [{ type: 'reward:chosen', option: FUSE }] },
      { label: 'reward:skipped', events: () => [{ type: 'reward:skipped' }] },
      { label: 'shop:opened', events: () => [{ type: 'shop:opened', shop: { items: [], rerollCost: 5, rerollsUsed: 0 } }] },
      { label: 'shop:bought', events: () => [{ type: 'shop:bought', item: { option: BALL, price: 10, sold: true } }] },
      { label: 'shop:rerolled', events: () => [{ type: 'shop:rerolled', cost: 5 }] },
      { label: 'achievement', events: () => [{ type: 'achievement:unlocked', achievementId: 'x' }] },
      { label: 'ui:click', events: () => [{ type: 'ui:click' }] },
    ],
  },
  {
    title: 'Vagues, boss, run (pilotent aussi la musique)',
    entries: [
      { label: 'run:started', events: () => [{ type: 'run:started', seed: 'preview' }] },
      { label: 'vague +3', events: () => [] },
      { label: 'wave:cleared', events: () => [{ type: 'wave:cleared', wave: 3 }] },
      { label: 'boss:spawned', events: () => [{ type: 'boss:spawned', bossId: 'golem', blockId: 9 }] },
      { label: 'boss:killed', events: () => [{ type: 'boss:killed', bossId: 'golem', pos: P }] },
      { label: 'run:over', events: () => [{ type: 'run:over', summary: summary() }] },
    ],
  },
];

function summary(): Extract<GameEvent, { type: 'run:over' }>['summary'] {
  return {
    seed: 'preview',
    depth: 10,
    wave: 3,
    stats: {
      shots: 10, blocksDestroyed: 30, bestCombo: 40, bestShotDamage: 500, totalDamage: 3000,
      coinsEarned: 50, fragmentsEarned: 5, fusions: 1, bossesKilled: 0, durationMs: 60000, perfectWaves: 0,
    },
    relics: [],
    volley: [],
    isDaily: false,
    dailyDate: null,
    score: 1000,
  };
}

/** rafale réaliste : 30 balles lancées toutes les 60 ms, rebonds par dizaines par seconde */
function stress(emit: (e: GameEvent) => void, seconds: number): void {
  emit({ type: 'volley:start', count: 30, from: P, dir: N });
  const start = performance.now();
  let combo = 0;
  const id = setInterval(() => {
    const el = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)] ?? 'stone';
    for (let i = 0; i < 8; i++) {
      const r = Math.random();
      combo = (combo + 1) % 160;
      if (r < 0.5) emit({ type: 'ball:bounce', ballId: i, pos: P, normal: N, surface: r < 0.15 ? 'wall' : 'block', combo });
      else if (r < 0.9) emit(hit(el, r > 0.85));
      else emit({ type: 'block:destroyed', blockId: i, kind: 'normal', pos: P, width: 1, element: el });
    }
    if (performance.now() - start > seconds * 1000) {
      clearInterval(id);
      emit({ type: 'volley:end', shotDamage: 900, bestCombo: combo });
    }
  }, 16);
}

export function mountAudioPreview(root: HTMLElement): AudioSystemDev {
  const bus = createEventBus();
  const audio = createAudio(bus, { sfx: 0.8, music: 0.5, shake: true, reduceMotion: false });
  let wave = 1;

  root.innerHTML = '';
  const h = document.createElement('h1');
  h.textContent = 'Pegbreaker — audio';
  h.style.fontSize = '20px';
  const status = document.createElement('pre');
  status.style.cssText = 'background:#141a2b;padding:8px;border-radius:6px;white-space:pre-wrap;font-size:12px';
  root.append(h, status);

  const unlockOnce = (): void => audio.unlock();
  root.addEventListener('pointerdown', unlockOnce, true);

  const btn = (label: string, onClick: () => void, parent: HTMLElement): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'margin:3px;padding:8px 10px;background:#22304f;color:#e6ecff;border:1px solid #3a4c78;border-radius:6px;cursor:pointer;font:inherit';
    b.addEventListener('click', () => {
      audio.unlock();
      onClick();
    });
    parent.appendChild(b);
  };

  const slider = (label: string, initial: number, set: (v: number) => void): void => {
    const l = document.createElement('label');
    l.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-right:16px';
    const i = document.createElement('input');
    i.type = 'range';
    i.min = '0';
    i.max = '1';
    i.step = '0.05';
    i.value = String(initial);
    i.addEventListener('input', () => set(Number(i.value)));
    l.append(label, i);
    root.appendChild(l);
  };
  slider('SFX', 0.8, (v) => audio.setSfxVolume(v));
  slider('Musique', 0.5, (v) => audio.setMusicVolume(v));

  const all: Entry[] = [];
  for (const g of GROUPS) {
    const sec = document.createElement('section');
    const t = document.createElement('h2');
    t.textContent = g.title;
    t.style.cssText = 'font-size:14px;margin:14px 0 4px;color:#9fb0d8';
    sec.appendChild(t);
    for (const en of g.entries) {
      all.push(en);
      btn(
        en.label,
        () => {
          if (en.label === 'vague +3') {
            wave += 3;
            bus.emit({ type: 'rows:advanced', wave, newRow: true });
          }
          for (const ev of en.events()) bus.emit(ev);
        },
        sec,
      );
    }
    root.appendChild(sec);
  }

  const tools = document.createElement('section');
  const tt = document.createElement('h2');
  tt.textContent = 'Outils';
  tt.style.cssText = 'font-size:14px;margin:14px 0 4px;color:#9fb0d8';
  tools.appendChild(tt);
  btn('Tout jouer en séquence', () => {
    const seq = all.filter((x) => !x.label.startsWith('run:') && x.label !== 'vague +3');
    seq.forEach((en, i) => setTimeout(() => en.events().forEach((ev) => bus.emit(ev)), i * 450));
  }, tools);
  btn('Rafale 30 balles (3 s)', () => stress((e) => bus.emit(e), 3), tools);
  btn('Reset pic', () => audio.debug.resetPeak(), tools);
  root.appendChild(tools);

  setInterval(() => {
    const d = audio.debug;
    status.textContent =
      `contexte: ${d.contextState}  unlocked: ${audio.unlocked}  musique: ${d.musicPlaying ? 'oui' : 'non'}  vague: ${wave}\n` +
      `nœuds créés: ${d.engine.nodesCreated}  voix actives: ${d.engine.voicesActive}  ` +
      `pic: ${d.engine.peak.toFixed(3)}  échantillons ≥0,99: ${d.engine.clipSamples}\n` +
      `limiteur: acceptés ${d.mixer.accepted}  ignorés ${d.mixer.dropped}  max/50 ms ${d.mixer.maxInWindow}\n` +
      `(cliquer n'importe où déverrouille l'audio)`;
  }, 200);

  return audio;
}
