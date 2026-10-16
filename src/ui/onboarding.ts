// ui/onboarding.ts — premier lancement sans texte : logo qui se fond au premier geste,
// et « fantôme » de geste (main + ligne de visée) rejoué en boucle du point de lancement
// vers le bloc le plus bas. Tout est dans l'overlay (#ui), rien dans le canvas.
import type { EventBus } from '../core/events';
import type { Renderer, RunState, Vec2 } from '../core/types';
import { el } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** sans tir au bout de ce délai, le geste s'accentue */
const INSIST_MS = 8000;

export interface Onboarding {
  /** à appeler chaque frame ; `allowed` = écran de jeu, phase de visée, pas de drag en cours */
  update(state: Readonly<RunState>, allowed: boolean): void;
  /** recalcule les positions (resize) */
  relayout(): void;
  /** montre le logo (UI.show('title')) */
  showLogo(): void;
  readonly active: boolean;
}

export function createOnboarding(frame: HTMLElement, renderer: Renderer, bus: EventBus, firstLaunch: boolean): Onboarding {
  // --- logo ---------------------------------------------------------------
  const logo = el('div', 'intro-logo');
  logo.setAttribute('aria-hidden', 'true');
  logo.append(el('div', 'logo', 'PEGBREAKER'));
  frame.append(logo);
  let logoOn = false;
  function showLogo(): void {
    logoOn = true;
    logo.classList.add('on');
  }
  function hideLogo(): void {
    if (!logoOn) return;
    logoOn = false;
    logo.classList.remove('on');
  }
  window.addEventListener('pointerdown', hideLogo, true);
  window.addEventListener('keydown', hideLogo, true);
  if (firstLaunch) showLogo();

  // --- fantôme de geste ------------------------------------------------------
  const ghost = el('div', 'ghost');
  ghost.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ghost-svg');
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('class', 'ghost-line');
  line.setAttribute('pathLength', '1');
  const target = document.createElementNS(SVG_NS, 'circle');
  target.setAttribute('class', 'ghost-target');
  target.setAttribute('r', '14');
  svg.append(line, target);
  const hand = el('div', 'ghost-hand');
  // main stylisée : doigt pointé (SVG inline)
  const hsvg = document.createElementNS(SVG_NS, 'svg');
  hsvg.setAttribute('viewBox', '0 0 40 48');
  hsvg.setAttribute('width', '40');
  hsvg.setAttribute('height', '48');
  const touch = document.createElementNS(SVG_NS, 'circle');
  touch.setAttribute('class', 'ghost-touch');
  touch.setAttribute('cx', '13');
  touch.setAttribute('cy', '6');
  touch.setAttribute('r', '6');
  const fingers = document.createElementNS(SVG_NS, 'path');
  fingers.setAttribute(
    'd',
    'M9 6 a4 4 0 0 1 8 0 V20 a3.5 3.5 0 0 1 7 0 v2 a3.5 3.5 0 0 1 7 0 v2 a3.5 3.5 0 0 1 7 0 V34 c0 8 -6 13 -14 13 h-3 c-6 0 -9 -3 -12 -8 L2 30 a3.5 3.5 0 0 1 6 -4 l1 2 Z',
  );
  fingers.setAttribute('class', 'ghost-fingers');
  hsvg.append(touch, fingers);
  hand.append(hsvg);
  ghost.append(svg, hand);
  frame.append(ghost);

  let done = !firstLaunch;
  let visible = false;
  let shownSince = 0;
  let insist = false;
  let lastKey = '';
  const a: Vec2 = { x: 0, y: 0 };
  const b: Vec2 = { x: 0, y: 0 };
  let needLayout = true;

  bus.on('volley:start', () => {
    done = true;
    hideLogo();
    setVisible(false);
  });

  function setVisible(v: boolean): void {
    if (v === visible) return;
    visible = v;
    ghost.classList.toggle('on', v);
    if (v && shownSince === 0) shownSince = performance.now();
  }

  function lowestBlock(s: Readonly<RunState>): Vec2 | null {
    let best: Vec2 | null = null;
    let bestRow = -1;
    for (const bl of s.blocks) {
      if (bl.kind === 'peg') continue;
      // le plus bas ; à égalité, le plus proche du centre
      const cx = bl.col + bl.width / 2;
      if (bl.row > bestRow || (bl.row === bestRow && best && Math.abs(cx - s.launchPos.x) < Math.abs(best.x - s.launchPos.x))) {
        bestRow = bl.row;
        best = { x: cx, y: bl.row + 0.5 };
      }
    }
    return best;
  }

  function place(s: Readonly<RunState>): void {
    const t = lowestBlock(s) ?? { x: s.launchPos.x - 1.5, y: s.launchPos.y - 5 };
    const key = `${s.launchPos.x},${s.launchPos.y},${t.x},${t.y}`;
    if (key === lastKey && !needLayout) return;
    lastKey = key;
    needLayout = false;
    const p0 = renderer.boardToScreen(s.launchPos);
    a.x = p0.x;
    a.y = p0.y;
    const p1 = renderer.boardToScreen(t);
    b.x = p1.x;
    b.y = p1.y;
    line.setAttribute('x1', String(a.x));
    line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
    target.setAttribute('cx', String(b.x));
    target.setAttribute('cy', String(b.y));
    // la main suit le même trajet (le bout du doigt = point de contact)
    ghost.style.setProperty('--x0', `${a.x}px`);
    ghost.style.setProperty('--y0', `${a.y}px`);
    ghost.style.setProperty('--x1', `${b.x}px`);
    ghost.style.setProperty('--y1', `${b.y}px`);
  }

  function update(s: Readonly<RunState>, allowed: boolean): void {
    const want = !done && allowed && s.phase === 'aiming' && s.stats.shots === 0;
    if (want) place(s);
    setVisible(want);
    if (visible && !insist && performance.now() - shownSince > INSIST_MS) {
      insist = true;
      ghost.classList.add('insist');
    }
  }

  return {
    update,
    relayout() {
      needLayout = true;
    },
    showLogo,
    get active() {
      return !done;
    },
  };
}
