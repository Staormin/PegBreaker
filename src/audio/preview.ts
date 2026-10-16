// audio/preview.ts — propriétaire : audio-dev. Page de dev : un bouton par recette.
// Les boutons émettent de vrais GameEvent sur un bus local : on teste le même chemin que le jeu
// (dispatch + limiteur + recettes). `npm run dev` puis /src/audio/preview.html
import { createEventBus } from '../core/events';
import type { BallElement, ContractDef, ContractState, GameEvent, RewardOption } from '../core/types';
import { HIT_ELEMENTS, HIT_VOICES } from './hits';
import { createAudio, type AudioSystemDev } from './index';
import { exportWav } from './render';
import { TRACK_IDS, TRACKS } from './tracks';

const P = { x: 4, y: 6 };
const N = { x: 0, y: -1 };
const ELEMENTS: readonly BallElement[] = HIT_ELEMENTS;
const FAMILY_ORDER = ['elemental', 'heavy', 'tricky', 'swarm', 'greed', 'arcane'] as const;
const FUSE: RewardOption = { kind: 'fuse', element: 'fire', tier: 2 };
const BALL: RewardOption = { kind: 'ball', element: 'ice', tier: 1 };
const COINS: RewardOption = { kind: 'coins', amount: 15 };
const CONTRACT_DEF: ContractDef = {
  id: 'combo10', kind: 'reachCombo', target: 10, text: 'Combo {n}', reward: COINS, minWave: 1, weight: 1,
};
const CONTRACT_BALL_DEF: ContractDef = { ...CONTRACT_DEF, id: 'oneshot4', kind: 'destroyInOneShot', target: 4, reward: BALL };
const CONTRACT: ContractState = { id: 'combo10', progress: 0, target: 10, status: 'active' };
const GOLDEN_ID = 99;

interface Entry {
  label: string;
  /** infobulle (identité du son) */
  title?: string;
  events: () => GameEvent[];
}

function hit(element: BallElement, crit = false): GameEvent {
  return { type: 'block:hit', blockId: 1, ballId: 1, pos: P, damage: 10, combo: 3, element, hpLeft: 20, crit };
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
  // grille des 27 sons de hit : une ligne par famille (le survol du bouton affiche l'identité)
  ...FAMILY_ORDER.map((fam) => ({
    title: `block:hit — ${fam}`,
    entries: ELEMENTS.filter((el) => HIT_VOICES[el].family === fam).map((el) => ({
      label: el,
      title: HIT_VOICES[el].note,
      events: (): GameEvent[] => [hit(el)],
    })),
  })),
  {
    title: 'block:hit critique',
    entries: [
      { label: 'stone crit', events: () => [hit('stone', true)] },
      { label: 'lucky crit', events: () => [hit('lucky', true)] },
    ],
  },
  {
    title: 'Blocs',
    entries: [
      { label: 'destroyed', events: () => [{ type: 'block:destroyed', blockId: 1, kind: 'normal', pos: P, width: 1, element: 'stone' }] },
      { label: 'destroyed heart', events: () => [{ type: 'block:destroyed', blockId: 1, kind: 'heart', pos: P, width: 1, element: 'stone' }] },
      { label: 'explode (feu 1,1)', events: () => [{ type: 'block:explode', pos: P, radius: 1.1, damage: 20 }] },
      { label: 'explode bombe (1,4)', events: () => [{ type: 'block:explode', pos: P, radius: 1.4, damage: 30 }] },
      { label: 'explode bombe III (2,2)', events: () => [{ type: 'block:explode', pos: P, radius: 2.2, damage: 60 }] },
      { label: 'explode nova (1,2)', events: () => [{ type: 'block:explode', pos: P, radius: 1.2, damage: 24 }] },
      {
        label: 'explode bloc explosif (1,2)',
        events: () => [
          { type: 'block:destroyed', blockId: 3, kind: 'explosive', pos: P, width: 1, element: 'stone' },
          { type: 'block:explode', pos: P, radius: 1.2, damage: 10 },
        ],
      },
      { label: 'frozen', events: () => [{ type: 'block:frozen', blockId: 1, pos: P }] },
      { label: 'breached', events: () => [{ type: 'block:breached', blockId: 1, kind: 'normal', damage: 1 }] },
      { label: 'lightning:chain', events: () => [hit('lightning'), { type: 'lightning:chain', from: P, to: P, damage: 5 }] },
      {
        label: 'prisme : rafale ×8 (1 son)',
        events: () => [
          { type: 'ball:launched', ballId: 7, element: 'prism', tier: 1, pos: P, golden: false },
          { type: 'ball:bounce', ballId: 7, pos: P, normal: N, surface: 'wall', combo: 2 },
          ...Array.from({ length: 8 }, (_, i): GameEvent => ({ type: 'lightning:chain', from: P, to: { x: i, y: P.y }, damage: 3 })),
        ],
      },
      { label: 'ball:split', events: () => [hit('split'), { type: 'ball:split', pos: P }] },
      { label: 'explode element:bomb', events: () => [{ type: 'block:explode', pos: P, radius: 1.1, damage: 30, element: 'bomb' }] },
      { label: 'chain element:prism', events: () => [{ type: 'lightning:chain', from: P, to: P, damage: 3, element: 'prism' }] },
      { label: 'split element:crystal', events: () => [{ type: 'ball:split', pos: P, element: 'crystal' }] },
      { label: 'ball:split cristal', events: () => [hit('crystal'), { type: 'ball:split', pos: P }] },
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
        events: (): GameEvent[] => [{ type: 'volley:start', count, from: P, dir: N, spread: 0 }],
      })),
      ...[0.5, 1].map((spread) => ({
        label: `volley:start ×15 spread ${spread}`,
        events: (): GameEvent[] => [{ type: 'volley:start', count: 15, from: P, dir: N, spread }],
      })),
      { label: 'volley:end', events: () => [{ type: 'volley:end', shotDamage: 300, bestCombo: 40 }] },
      {
        label: 'balle dorée : launch',
        events: () => [{ type: 'ball:launched', ballId: GOLDEN_ID, element: 'stone', tier: 1, pos: P, golden: true }],
      },
      {
        label: 'balle dorée : hit + rebond',
        events: () => [hit('stone'), { type: 'ball:bounce', ballId: GOLDEN_ID, pos: P, normal: N, surface: 'block', combo: 6 }],
      },
      { label: 'balle dorée : grounded', events: () => [{ type: 'ball:grounded', ballId: GOLDEN_ID, pos: P }] },
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
      { label: 'healed source:vampire', events: () => [{ type: 'player:healed', amount: 1, hpLeft: 3, source: 'vampire' }] },
      {
        label: 'player:healed vampire',
        events: () => [
          { type: 'block:destroyed', blockId: 4, kind: 'normal', pos: P, width: 1, element: 'vampire' },
          { type: 'player:healed', amount: 1, hpLeft: 3 },
        ],
      },
      { label: 'reward:offered', events: () => [{ type: 'reward:offered', options: [BALL, FUSE], source: 'wave' }] },
      { label: 'reward:offered boss', events: () => [{ type: 'reward:offered', options: [BALL, FUSE], source: 'boss' }] },
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
    title: 'Contrats',
    entries: [
      { label: 'contract:offered', events: () => [{ type: 'contract:offered', contract: CONTRACT, def: CONTRACT_DEF }] },
      ...[3, 7].map((progress) => ({
        label: `contract:progress ${progress}/10`,
        events: (): GameEvent[] => [{ type: 'contract:progress', progress, target: 10 }],
      })),
      { label: 'contract:completed coins', events: () => [{ type: 'contract:completed', def: CONTRACT_DEF, reward: COINS }] },
      { label: 'contract:completed balle', events: () => [{ type: 'contract:completed', def: CONTRACT_BALL_DEF, reward: BALL }] },
      { label: 'contract:failed', events: () => [{ type: 'contract:failed', def: CONTRACT_DEF }] },
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
      { label: 'run:lost', events: () => [{ type: 'run:lost', canRevive: true, wave: 3, depth: 10 }] },
      { label: 'run:revived', events: () => [{ type: 'run:revived', hpLeft: 2, revivesUsed: 1 }] },
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
      contractsCompleted: 2,
    },
    relics: [],
    volley: [],
    isDaily: false,
    dailyDate: null,
    score: 1000,
    revivesUsed: 1,
    contractsCompleted: 2,
  };
}

/** rafale réaliste : 30 balles lancées toutes les 60 ms, rebonds par dizaines par seconde */
function stress(emit: (e: GameEvent) => void, seconds: number): void {
  emit({ type: 'volley:start', count: 30, from: P, dir: N, spread: 0.6 });
  emit({ type: 'ball:launched', ballId: 0, element: 'stone', tier: 1, pos: P, golden: true });
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
  const audio = createAudio(bus, { sfx: 0.8, music: 0.5, musicTrack: 'neon' });
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

  const btn = (label: string, onClick: () => void, parent: HTMLElement, title?: string): void => {
    const b = document.createElement('button');
    b.textContent = label;
    if (title) b.title = title;
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
        en.title,
      );
    }
    root.appendChild(sec);
  }

  // --- Musique : piste, intensité, boss, fin de run, export WAV ------------------------
  const mus = document.createElement('section');
  const mt = document.createElement('h2');
  mt.textContent = 'Musique';
  mt.style.cssText = 'font-size:14px;margin:14px 0 4px;color:#9fb0d8';
  mus.appendChild(mt);
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Piste musicale');
  sel.style.cssText = 'margin:3px;padding:7px;background:#22304f;color:#e6ecff;border:1px solid #3a4c78;border-radius:6px;font:inherit';
  for (const id of TRACK_IDS) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = TRACKS[id].title;
    sel.appendChild(o);
  }
  sel.value = audio.musicTrack;
  sel.addEventListener('change', () => {
    audio.unlock();
    const id = TRACK_IDS.find((t) => t === sel.value);
    if (id) audio.setMusicTrack(id);
  });
  mus.appendChild(sel);
  let boss = false;
  const setWave = (w: number): void => {
    wave = Math.max(1, w);
    bus.emit({ type: 'rows:advanced', wave, newRow: true });
  };
  btn('Démarrer (run:started)', () => {
    boss = false;
    wave = 1;
    bus.emit({ type: 'run:started', seed: 'preview' });
  }, mus);
  btn('intensité +', () => setWave(wave + 1), mus);
  btn('intensité −', () => setWave(wave - 1), mus);
  btn('boss on/off', () => {
    boss = !boss;
    bus.emit(boss ? { type: 'boss:spawned', bossId: 'golem', blockId: 9 } : { type: 'boss:killed', bossId: 'golem', pos: P });
  }, mus);
  btn('lost', () => bus.emit({ type: 'run:lost', canRevive: true, wave, depth: 10 }), mus);
  btn('revived', () => bus.emit({ type: 'run:revived', hpLeft: 2, revivesUsed: 1 }), mus);
  btn('over', () => bus.emit({ type: 'run:over', summary: summary() }), mus);
  const exportBtn = document.createElement('a');
  btn('Exporter WAV 30 s', () => {
    const id = audio.musicTrack;
    exportBtn.textContent = `rendu ${id} en cours…`;
    void exportWav(id, 30, wave, boss).then(
      (blob) => {
        const url = URL.createObjectURL(blob);
        exportBtn.href = url;
        exportBtn.download = `pegbreaker-${id}-vague${wave}${boss ? '-boss' : ''}.wav`;
        exportBtn.textContent = `télécharger ${exportBtn.download} (normalisé −1 dBFS)`;
        exportBtn.click();
      },
      (err: unknown) => {
        exportBtn.textContent = `échec du rendu : ${String(err)}`;
      },
    );
  }, mus);
  exportBtn.style.cssText = 'display:block;margin:6px 3px;color:#9fd8b0';
  mus.appendChild(exportBtn);
  root.appendChild(mus);

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
      `contexte: ${d.contextState}  unlocked: ${audio.unlocked}  musique: ${audio.musicTrack} (${d.musicMode})  ` +
      `vague: ${d.musicWave}  boss: ${d.musicTension ? 'oui' : 'non'}\n` +
      `mesures planifiées: ${d.musicStats.barsPlanned}  notes en retard: ${d.musicStats.lateNotes}  ` +
      `recalages: ${d.musicStats.resyncs}  avance min: ${Number.isFinite(d.musicStats.minLeadMs) ? d.musicStats.minLeadMs.toFixed(0) : '—'} ms\n` +
      `nœuds créés: ${d.engine.nodesCreated}  voix actives: ${d.engine.voicesActive}  ` +
      `pic: ${d.engine.peak.toFixed(3)}  échantillons ≥0,99: ${d.engine.clipSamples}\n` +
      `limiteur: acceptés ${d.mixer.accepted}  ignorés ${d.mixer.dropped}  max/50 ms ${d.mixer.maxInWindow}\n` +
      `(cliquer n'importe où déverrouille l'audio)`;
  }, 200);

  return audio;
}
