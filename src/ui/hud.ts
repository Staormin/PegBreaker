// ui/hud.ts — HUD superposé au canvas : PV, vague, pièces, fragments, volée, dégâts du tir,
// bouton Rappel, indice d'onboarding. `update` est appelé chaque frame mais ne touche le DOM
// que si une valeur affichée a changé (valeurs mises en cache).
// Lot 1 : record « Record V<n> » dans la pastille de vague (F5), bande sous la barre du haut
// (badges Quotidien / Défi + bandeau contrat, F2/F6), jauge « rafale ⟷ éventail » sous le
// point de lancement pendant la visée (F1).
import type { EventBus } from '../core/events';
import type { BallElement, BallTier, GameConfig, Renderer, RunState, Sim, VolleyBall } from '../core/types';
import { createContractBanner } from './contract';
import { modChip, type ModView } from './dailyInfo';
import { coinIcon, el, fmt } from './dom';
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
  /** pour situer le bord haut du plateau (bande HUD du compteur de dégâts) */
  renderer?: Renderer | null;
  /** bouton ◆ (le Puits) et ⚙ (réglages), visibles en phase 'aiming' ; null = absents */
  onWell?: (() => void) | null;
  onSettings?: (() => void) | null;
  /** run du défi quotidien : badge « Quotidien » */
  isDaily?: boolean;
  /** F8 : mutateurs du quotidien, affichés en pastilles dans le badge (titre au survol / aria-label) */
  dailyMods?: readonly ModView[];
  /** mode défi (?goal=N) : badge « Défi : battre P<N> » ; null = absent */
  challengeGoal?: number | null;
  /** meilleure vague AVANT la run (null ou 0 = pas de record affiché) */
  bestWave?: () => number | null;
  /** appelé une seule fois par run quand la vague dépasse le record */
  onNewRecord?: (wave: number) => void;
  /** la jauge d'éventail n'apparaît que sur l'écran de jeu */
  isGameScreen?: () => boolean;
}

export interface Hud {
  readonly el: HTMLElement;
  update(state: Readonly<RunState>): void;
  /** gros pop du compteur + icône « ↻ ×combo » pendant 2 s (indice du premier palier) */
  comboHint(combo: number): void;
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
  const waveBox = el('div', 'hud-wave');
  const waveNum = el('span', 'num hud-wave-num', 'V1');
  waveNum.setAttribute('aria-label', 'Vague');
  const recordEl = el('span', 'hud-record');
  recordEl.hidden = true;
  waveBox.append(waveNum, recordEl);
  const right = el('div', 'hud-right');
  const coinBox = el('div', 'hud-stat hud-coins');
  const coinVal = el('span', 'num', '0');
  coinBox.append(coinIcon(), coinVal);
  coinBox.setAttribute('aria-label', 'Pièces');
  const fragBox = el('button', 'hud-stat hud-frags');
  fragBox.type = 'button';
  const fragVal = el('span', 'num', '0');
  const fragIco = el('span', 'ico-frag', '◆');
  fragIco.setAttribute('aria-hidden', 'true');
  fragBox.append(fragIco, fragVal);
  fragBox.setAttribute('aria-label', 'Fragments de la run — ouvrir le Puits');
  fragBox.disabled = true;
  fragBox.addEventListener('click', () => {
    if (fragBox.disabled || !deps.onWell) return;
    bus.emit({ type: 'ui:click' });
    deps.onWell();
  });
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
  });
  // clavier (Entrée / Espace sur le bouton focalisé)
  recall.addEventListener('click', (e) => {
    if (e.detail !== 0) return; // les clics pointeur sont déjà traités au pointerdown
    bus.emit({ type: 'ui:click' });
    sim.recall();
  });

  // --- indice one-shot du premier palier de combo (« ↻ ×N », sans phrase) --
  const comboHint = el('div', 'hud-combo-hint');
  comboHint.setAttribute('aria-hidden', 'true');

  // --- ⚙ réglages (même emplacement que Rappel, mais en phase 'aiming') ----
  const gear = el('button', 'hud-gear', '⚙');
  gear.type = 'button';
  gear.setAttribute('aria-label', 'Réglages');
  gear.addEventListener('click', () => {
    if (!deps.onSettings) return;
    bus.emit({ type: 'ui:click' });
    deps.onSettings();
  });

  // --- bande sous la barre du haut : badges + contrat --------------------
  const band = el('div', 'hud-band');
  if (deps.isDaily) {
    const badge = el('div', 'hud-badge hud-daily');
    badge.append(el('span', 'hd-label', '📅 Quotidien'));
    const mods = deps.dailyMods ?? [];
    for (const m of mods) badge.append(modChip(m, 'mod-chip hud-mod'));
    if (mods.length) {
      const names = mods.map((m) => m.name).join(', ');
      badge.setAttribute('aria-label', `Quotidien, mutateurs : ${names}`);
    }
    band.append(badge);
  }
  const goal = deps.challengeGoal ?? null;
  if (goal !== null) {
    const badge = el('div', 'hud-badge hud-challenge');
    badge.append(el('span', 'hb-long', `Défi : battre P${goal}`), el('span', 'hb-short', `Défi P${goal}`));
    badge.setAttribute('aria-label', `Défi : battre la profondeur ${goal}`);
    badge.title = `Défi : battre la profondeur ${goal}`;
    band.append(badge);
  }
  const contract = createContractBanner(config, bus, () => layout());
  band.append(contract.el);

  // --- jauge d'éventail (visée seulement) --------------------------------
  const spreadBox = el('div', 'hud-spread');
  spreadBox.setAttribute('role', 'img');
  const spreadTrack = el('span', 'hs-track');
  const spreadFill = el('span', 'hs-fill');
  const spreadKnob = el('span', 'hs-knob');
  spreadTrack.append(spreadFill, spreadKnob);
  spreadTrack.setAttribute('aria-hidden', 'true');
  spreadBox.append(el('span', 'hs-label hs-min', 'rafale'), spreadTrack, el('span', 'hs-label hs-max', 'éventail'));

  frame.append(top, band, shot, comboHint, spreadBox, volleyBox, recall, gear);
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
  let menuVisible = false;
  let comboHintTimer = 0;
  let shotHideAt = 0;
  let shotLingering = false;
  let cRecord = '';
  let recordToastDone = false;
  let cSpread = -1;
  let spreadVisible = false;
  let cLaunchX = NaN;
  let cLaunchY = NaN;
  let frameW = 0;

  function setVisible(e: HTMLElement, v: boolean): void {
    e.classList.toggle('on', v);
  }

  function renderHp(hp: number, maxHp: number, prevMax: number): void {
    hpBox.setAttribute('aria-label', `PV ${hp} sur ${maxHp}`);
    if (maxHp <= MAX_HEARTS && maxHp === prevMax && hpBox.children.length === maxHp) {
      // même nombre de cœurs : on ne bascule que l'état plein/vide
      for (let i = 0; i < maxHp; i++) {
        const h = hpBox.children[i] as HTMLElement;
        const full = i < hp;
          h.classList.toggle('full', full);
      }
      return;
    }
    hpBox.textContent = '';
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
    }
    fitVolley(counts);
  }

  /** une seule rangée : les groupes qui dépassent sont résumés en « +k » (jamais sur le plateau) */
  function fitVolley(counts: number[]): void {
    const box = volleyBox.getBoundingClientRect();
    if (box.width < 1) return;
    const pills = volleyBox.children;
    const fits = (): boolean => {
      const last = volleyBox.lastElementChild;
      return !last || last.getBoundingClientRect().right <= box.right + 0.5;
    };
    if (fits()) return;
    const more = el('div', 'pill pill-more');
    let hidden = 0;
    volleyBox.append(more);
    while (pills.length > 2 && !fits()) {
      const victim = pills[pills.length - 2] as HTMLElement;
      hidden += counts[pills.length - 2] ?? 1;
      victim.remove();
      more.textContent = `+${hidden}`;
      more.setAttribute('aria-label', `${hidden} balles de plus`);
    }
  }

  // --- événements -------------------------------------------------------
  bus.on('volley:start', () => {
    shot.dataset.level = '0';
    shotLingering = false;
  });
  bus.on('combo:milestone', (e) => {
    const cur = Number(shot.dataset.level ?? '0');
    if (e.level > cur) shot.dataset.level = String(e.level);
  });
  bus.on('volley:end', (e) => {
    shotLingering = true;
    shotHideAt = performance.now() + SHOT_LINGER_MS;
    if (e.shotDamage !== cShot) {
      cShot = e.shotDamage;
      shotVal.textContent = fmt(e.shotDamage);
    }
  });
  bus.on('volley:fusion', () => {
    volleyDirty = true;
  });

  // --- cadre calé sur le canvas ------------------------------------------
  /** place le compteur de dégâts dans la bande au-dessus du plateau, sinon à la place de V<wave> */
  function layoutShot(frameW: number, frameH: number, frameTop: number): void {
    // taille plafonnée : 28 px à 360 de large, 34 px dès 540
    let cap = Math.min(34, Math.max(22, 28 + (frameW - 360) / 30));
    const tb = top.getBoundingClientRect();
    const barBottom = tb.bottom - frameTop;
    let boardTop = frameH * 0.1;
    const bt = deps.renderer?.boardToScreen({ x: 0, y: 0 }).y;
    if (bt !== undefined && Number.isFinite(bt) && bt > 0) boardTop = bt;
    const bandH = boardTop - barBottom;
    // bande : badges + contrat, hauteur ≤ 28 px, sans toucher le plateau
    const h = Math.max(18, Math.min(28, bandH - 4));
    band.style.top = `${barBottom + Math.max(1, (bandH - h) / 2)}px`;
    frame.style.setProperty('--band-h', `${h}px`);
    // le contrat occupe la bande : le compteur de dégâts passe dans la barre (à la place de V<n>)
    const inBar = bandH < cap + 4 || contract.busy;
    if (inBar) {
      // pas la place : remplace temporairement V<wave> dans la barre du haut
      cap = Math.min(cap, Math.max(20, tb.height - 4));
      const wb = waveBox.getBoundingClientRect();
      shot.style.top = `${wb.top - frameTop + wb.height / 2 - cap / 2}px`;
    } else {
      shot.style.top = `${barBottom + (bandH - cap) / 2}px`;
    }
    shot.style.setProperty('--shot-size', `${cap}px`);
    frame.classList.toggle('shot-in-bar', inBar);
  }

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
    frameW = r.width;
    frame.classList.toggle('compact', r.width < 480);
    layoutShot(r.width, r.height, r.top);
    cLaunchX = NaN; // la jauge d'éventail se recale
    volleyDirty = true; // la largeur disponible a pu changer

  }

  function update(s: Readonly<RunState>): void {
    if (s.hp !== cHp || s.maxHp !== cMaxHp) {
      renderHp(s.hp, s.maxHp, cMaxHp);
      cHp = s.hp;
      cMaxHp = s.maxHp;
    }
    if (s.wave !== cWave) {
      cWave = s.wave;
      waveNum.textContent = `V${s.wave}`;
    }
    updateRecord(s.wave);
    contract.update(s);
    updateSpread(s);
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
      if (wantShot) layout(); // le renderer a pu changer de mise en page depuis
      setVisible(shot, wantShot);
      frame.classList.toggle('shot-on', wantShot);
    }
    if (firing !== recallVisible) {
      recallVisible = firing;
      setVisible(recall, firing);
    }
    const menus = s.phase === 'aiming';
    const gearOn = (menus || firing) && !!deps.onSettings;
    if (gearOn !== gear.classList.contains('on')) setVisible(gear, gearOn);
    if (firing !== frame.classList.contains('firing')) {
      frame.classList.toggle('firing', firing);
      volleyDirty = true; // la place disponible pour la volée change (⚙ à côté de ⏩)
    }
    if (menus !== menuVisible) {
      menuVisible = menus;
      fragBox.disabled = !(menus && deps.onWell);
      fragBox.classList.toggle('on', menus && !!deps.onWell);
    }
  }

  /** « Record V7 » / « = record » / « RECORD ! » (+ toast une fois par run) */
  function updateRecord(wave: number): void {
    const best = deps.bestWave?.() ?? null;
    let txt = '';
    let st = '';
    if (best !== null && best > 0) {
      if (wave > best) {
        txt = 'RECORD !';
        st = 'beyond';
      } else if (wave === best) {
        txt = '= record';
        st = 'equal';
      } else {
        txt = `Record V${best}`;
        st = 'below';
      }
    }
    const key = `${st}|${txt}`;
    if (key !== cRecord) {
      cRecord = key;
      recordEl.hidden = txt === '';
      recordEl.textContent = txt;
      recordEl.dataset.state = st;
      if (txt) recordEl.setAttribute('aria-label', st === 'below' ? `Record : vague ${best ?? 0}` : txt);
    }
    if (st === 'beyond' && !recordToastDone) {
      recordToastDone = true;
      deps.onNewRecord?.(wave);
    }
  }

  /** jauge rafale ⟷ éventail sous le point de lancement, pendant la visée seulement */
  function updateSpread(s: Readonly<RunState>): void {
    const want = s.phase === 'aiming' && s.aimDir !== null && (deps.isGameScreen?.() ?? true);
    if (want !== spreadVisible) {
      spreadVisible = want;
      setVisible(spreadBox, want);
    }
    if (!want) return;
    const lp = s.launchPos;
    if (lp.x !== cLaunchX || lp.y !== cLaunchY) {
      cLaunchX = lp.x;
      cLaunchY = lp.y;
      const p = deps.renderer?.boardToScreen(lp);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        const half = spreadBox.offsetWidth / 2 || 84;
        const x = Math.max(half + 4, Math.min((frameW || half * 2 + 8) - half - 4, p.x));
        spreadBox.style.left = `${x}px`;
        spreadBox.style.top = `${p.y + 10}px`;
      }
    }
    const v = Number.isFinite(s.aimSpread) ? Math.max(0, Math.min(1, s.aimSpread)) : 0;
    if (v !== cSpread) {
      cSpread = v;
      spreadBox.style.setProperty('--sp', String(v));
      spreadBox.dataset.mode = v === 0 ? 'burst' : 'fan';
      spreadBox.setAttribute('aria-label', `Ouverture de la volée : ${Math.round(v * 100)} %`);
    }
  }

  function showComboHint(combo: number): void {
    comboHint.textContent = `↻ ×${combo}`;
    // sous le bandeau contrat s'il occupe la bande, sinon sous le compteur de dégâts
    comboHint.style.top = contract.busy
      ? `calc(${band.style.top || '44px'} + var(--band-h) + 6px)`
      : `calc(${shot.style.top || '0px'} + var(--shot-size, 28px) + 6px)`;
    setVisible(comboHint, true);
    clearTimeout(comboHintTimer);
    comboHintTimer = window.setTimeout(() => setVisible(comboHint, false), 2000);
  }

  function reset(): void {
    cHp = cMaxHp = cWave = cCoins = cFrags = cVolleyLen = cShot = -1;
    volleyDirty = true;
    shotLingering = false;
    shot.dataset.level = '0';
    cRecord = '';
    recordToastDone = false;
    contract.reset();
  }

  return { el: frame, update, layout, reset, comboHint: showComboHint };
}
