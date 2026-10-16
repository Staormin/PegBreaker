// ui/hud.ts — HUD superposé au canvas : PV, vague, pièces, fragments, volée, dégâts du tir,
// bouton Rappel, indice d'onboarding. `update` est appelé chaque frame mais ne touche le DOM
// que si une valeur affichée a changé (valeurs mises en cache).
import type { EventBus } from '../core/events';
import type { BallElement, BallTier, GameConfig, RunState, Sim, VolleyBall } from '../core/types';
import { coinIcon, el, fmt, retrigger } from './dom';
import { ballColor, ballName } from './options';

const MAX_HEARTS = 10;
/** délai d'affichage des dégâts du tir après volley:end (ms) */
const SHOT_LINGER_MS = 600;
const ELEMENT_INDEX: Record<BallElement, number> = { stone: 0, fire: 1, lightning: 2, ice: 3, ghost: 4, lead: 5, split: 6 };

export interface HudDeps {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  sim: Sim;
  bus: EventBus;
  config: GameConfig;
}

export interface Hud {
  readonly el: HTMLElement;
  update(state: Readonly<RunState>, showHint: boolean): void;
  /** recale le cadre du HUD sur le rectangle du canvas */
  layout(): void;
  reset(): void;
}

export function createHud(deps: HudDeps): Hud {
  const { root, canvas, sim, bus, config } = deps;

  const frame = el('div', 'hud');
  // --- haut -------------------------------------------------------------
  const top = el('div', 'hud-top');
  const hpBox = el('div', 'hud-hp');
  hpBox.setAttribute('role', 'img');
  const waveBox = el('div', 'hud-wave', 'V1');
  waveBox.setAttribute('aria-label', 'Vague');
  const right = el('div', 'hud-right');
  const coinBox = el('div', 'hud-stat hud-coins');
  const coinVal = el('span', 'num', '0');
  coinBox.append(coinIcon(), coinVal);
  coinBox.setAttribute('aria-label', 'Pièces');
  const fragBox = el('div', 'hud-stat hud-frags');
  const fragVal = el('span', 'num', '0');
  const fragIco = el('span', 'ico-frag', '◆');
  fragIco.setAttribute('aria-hidden', 'true');
  fragBox.append(fragIco, fragVal);
  fragBox.setAttribute('aria-label', 'Fragments');
  right.append(coinBox, fragBox);
  top.append(hpBox, waveBox, right);

  // --- dégâts du tir ----------------------------------------------------
  const shot = el('div', 'hud-shot');
  shot.setAttribute('aria-live', 'off');
  const shotVal = el('span', 'num', '0');
  shot.append(shotVal);

  // --- bas : volée ------------------------------------------------------
  const volleyBox = el('div', 'hud-volley');
  volleyBox.setAttribute('aria-label', 'Volée');

  // --- bouton Rappel (pointerdown : réactivité maximale) ---------------
  const recall = el('button', 'hud-recall', '⏩');
  recall.type = 'button';
  recall.setAttribute('aria-label', 'Rappel des balles');
  recall.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    bus.emit({ type: 'ui:click' });
    sim.recall();
    retrigger(recall, 'pop');
  });
  // clavier (Entrée / Espace sur le bouton focalisé)
  recall.addEventListener('click', (e) => {
    if (e.detail !== 0) return; // les clics pointeur sont déjà traités au pointerdown
    bus.emit({ type: 'ui:click' });
    sim.recall();
  });

  // --- indice d'onboarding (flèche bas → haut) ---------------------------
  const hint = el('div', 'hud-hint');
  hint.setAttribute('aria-hidden', 'true');
  hint.append(el('div', 'hint-arrow'), el('div', 'hint-dot'));

  frame.append(top, shot, volleyBox, recall, hint);
  root.append(frame);

  // --- cache des valeurs affichées --------------------------------------
  let cHp = -1;
  let cMaxHp = -1;
  let cWave = -1;
  let cCoins = -1;
  let cFrags = -1;
  let cVolleySig = 0;
  let volleyDirty = true;
  let cVolleyLen = -1;
  let cShot = -1;
  let shotVisible = false;
  let recallVisible = false;
  let hintVisible = false;
  let shotHideAt = 0;
  let shotLingering = false;
  let pendingPulse = -1; // clé (élément, rang) à faire pulser après fusion

  function setVisible(e: HTMLElement, v: boolean): void {
    e.classList.toggle('on', v);
  }

  function renderHp(hp: number, maxHp: number): void {
    hpBox.textContent = '';
    hpBox.setAttribute('aria-label', `PV ${hp} sur ${maxHp}`);
    if (maxHp <= MAX_HEARTS) {
      for (let i = 0; i < maxHp; i++) hpBox.append(el('span', i < hp ? 'heart full' : 'heart', '♥'));
    } else {
      hpBox.append(el('span', 'heart full', '♥'), el('span', 'num hp-num', `${hp}/${maxHp}`));
    }
  }

  function volleySignature(v: readonly VolleyBall[]): number {
    let h = 17;
    for (let i = 0; i < v.length; i++) {
      const b = v[i]!;
      h = (Math.imul(h, 31) + ELEMENT_INDEX[b.element] * 4 + b.tier) | 0;
    }
    return h;
  }

  function renderVolley(v: readonly VolleyBall[]): void {
    // regroupe par (élément, rang) dans l'ordre d'apparition — hors boucle chaude (seulement si la volée change)
    const keys: number[] = [];
    const counts: number[] = [];
    const items: { element: BallElement; tier: BallTier }[] = [];
    for (const b of v) {
      const k = ELEMENT_INDEX[b.element] * 4 + b.tier;
      const idx = keys.indexOf(k);
      if (idx === -1) {
        keys.push(k);
        counts.push(1);
        items.push({ element: b.element, tier: b.tier });
      } else counts[idx] = (counts[idx] ?? 0) + 1;
    }
    volleyBox.textContent = '';
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const n = counts[i] ?? 1;
      const pill = el('div', 'pill');
      pill.dataset.tier = String(it.tier);
      pill.dataset.element = it.element;
      pill.style.setProperty('--c', ballColor(config, it.element));
      pill.setAttribute('aria-label', `${ballName(config, it.element)} rang ${it.tier} ×${n}`);
      pill.title = `${ballName(config, it.element)} · rang ${it.tier}`;
      // rang écrit dans la balle (II / III) : le rang ne repose pas que sur les anneaux
      pill.append(el('span', 'ball', it.tier === 1 ? '' : it.tier === 2 ? 'II' : 'III'), el('span', 'num cnt', `×${n}`));
      volleyBox.append(pill);
      if (keys[i] === pendingPulse) retrigger(pill, 'pulse');
    }
    pendingPulse = -1;
  }

  // --- événements -------------------------------------------------------
  bus.on('volley:start', () => {
    shot.dataset.level = '0';
    shotLingering = false;
  });
  bus.on('combo:milestone', (e) => {
    const cur = Number(shot.dataset.level ?? '0');
    if (e.level > cur) shot.dataset.level = String(e.level);
    retrigger(shot, 'pop');
  });
  bus.on('volley:end', (e) => {
    shotLingering = true;
    shotHideAt = performance.now() + SHOT_LINGER_MS;
    if (e.shotDamage !== cShot) {
      cShot = e.shotDamage;
      shotVal.textContent = fmt(e.shotDamage);
    }
  });
  bus.on('volley:fusion', (e) => {
    pendingPulse = ELEMENT_INDEX[e.element] * 4 + e.tier;
    volleyDirty = true; // force le rendu pour appliquer la pulsation
  });
  bus.on('drop:collected', (e) => {
    if (e.kind === 'coin') retrigger(coinBox, 'pop');
    else if (e.kind === 'fragment') retrigger(fragBox, 'pop');
    else if (e.kind === 'heart') retrigger(hpBox, 'pop');
    else retrigger(volleyBox, 'pop');
  });
  bus.on('player:damaged', () => retrigger(hpBox, 'shake'));
  bus.on('player:healed', () => retrigger(hpBox, 'pop'));

  // --- cadre calé sur le canvas ------------------------------------------
  function layout(): void {
    const r = canvas.getBoundingClientRect();
    const p = root.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) {
      frame.style.left = '0px';
      frame.style.top = '0px';
      frame.style.width = `${p.width}px`;
      frame.style.height = `${p.height}px`;
      return;
    }
    frame.style.left = `${r.left - p.left}px`;
    frame.style.top = `${r.top - p.top}px`;
    frame.style.width = `${r.width}px`;
    frame.style.height = `${r.height}px`;
  }

  function update(s: Readonly<RunState>, showHint: boolean): void {
    if (s.hp !== cHp || s.maxHp !== cMaxHp) {
      cHp = s.hp;
      cMaxHp = s.maxHp;
      renderHp(s.hp, s.maxHp);
    }
    if (s.wave !== cWave) {
      cWave = s.wave;
      waveBox.textContent = `V${s.wave}`;
    }
    if (s.coins !== cCoins) {
      cCoins = s.coins;
      coinVal.textContent = fmt(s.coins);
    }
    const frags = s.stats.fragmentsEarned;
    if (frags !== cFrags) {
      cFrags = frags;
      fragVal.textContent = fmt(frags);
    }
    if (volleyDirty || s.volley.length !== cVolleyLen || volleySignature(s.volley) !== cVolleySig) {
      cVolleyLen = s.volley.length;
      cVolleySig = volleySignature(s.volley);
      volleyDirty = false;
      renderVolley(s.volley);
    }

    const firing = s.phase === 'firing';
    if (firing && s.currentShotDamage !== cShot) {
      cShot = s.currentShotDamage;
      shotVal.textContent = fmt(s.currentShotDamage);
    }
    const wantShot = (firing && s.currentShotDamage > 0) || (shotLingering && performance.now() < shotHideAt);
    if (!firing && shotLingering && performance.now() >= shotHideAt) shotLingering = false;
    if (wantShot !== shotVisible) {
      shotVisible = wantShot;
      setVisible(shot, wantShot);
    }
    if (firing !== recallVisible) {
      recallVisible = firing;
      setVisible(recall, firing);
    }
    if (showHint !== hintVisible) {
      hintVisible = showHint;
      setVisible(hint, showHint);
    }
  }

  function reset(): void {
    cHp = cMaxHp = cWave = cCoins = cFrags = cVolleyLen = cShot = -1;
    volleyDirty = true;
    shotLingering = false;
    shot.dataset.level = '0';
  }

  return { el: frame, update, layout, reset };
}
