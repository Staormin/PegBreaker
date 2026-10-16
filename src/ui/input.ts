// ui/input.ts — drag-to-aim (souris + tactile) et clavier desktop.
// Visée DIRECTE : la balle part vers le point touché (dir = point plateau − launchPos).
// Seul endroit de ui/ qui manipule des pixels (coordonnées CSS relatives au canvas).
import type { AudioSystem, Renderer, Sim, Vec2 } from '../core/types';

/** distance minimale de drag (px CSS) pour qu'un relâchement tire */
const DRAG_THRESHOLD_PX = 12;
/** pas angulaire des flèches (degrés) ; Maj = pas fin */
const KEY_STEP_DEG = 2;
const KEY_STEP_FINE_DEG = 0.5;

export interface InputDeps {
  canvas: HTMLCanvasElement;
  sim: Sim;
  renderer: Renderer;
  audio: AudioSystem | null;
  /** l'input de jeu n'est actif que si l'écran courant est 'game' */
  isGameScreen: () => boolean;
  /** notifié au début / à la fin d'un geste de visée (masque l'indice d'onboarding) */
  onDragChange?: (dragging: boolean) => void;
}

export interface Input {
  readonly dragging: boolean;
  dispose(): void;
}

export function createInput(deps: InputDeps): Input {
  const { canvas, sim, renderer, isGameScreen } = deps;
  const minDeg = sim.config.blocks.board.minAimAngleDeg;

  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let moved = 0;
  // rect mis en cache au début du geste (pas de getBoundingClientRect par pointermove)
  let rectLeft = 0;
  let rectTop = 0;
  // angle de visée clavier persistant (degrés, 90 = vertical, >90 = vers la gauche)
  let keyAngle = 90;
  const dir: Vec2 = { x: 0, y: -1 };

  canvas.style.touchAction = 'none';

  function setDragging(v: boolean): void {
    deps.onDragChange?.(v);
  }

  /** calcule dir (réutilisé, pas d'allocation) depuis des coords client */
  function computeDir(clientX: number, clientY: number): Vec2 {
    const b = renderer.screenToBoard(clientX - rectLeft, clientY - rectTop);
    const lp = sim.state.launchPos;
    dir.x = b.x - lp.x;
    dir.y = b.y - lp.y;
    return dir;
  }

  /** copie défensive : la sim peut conserver la référence ; on réutilise `dir` côté UI */
  function aimCopy(d: Vec2): void {
    sim.aim({ x: d.x, y: d.y });
  }

  function syncKeyAngle(d: Vec2): void {
    if (d.y >= 0 || (d.x === 0 && d.y === 0)) return;
    const deg = (Math.atan2(-d.y, d.x) * 180) / Math.PI;
    keyAngle = Math.min(180 - minDeg, Math.max(minDeg, deg));
  }

  function onPointerDown(e: PointerEvent): void {
    if (pointerId !== -1) return; // un seul doigt à la fois
    if (!isGameScreen() || sim.state.phase !== 'aiming') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    rectLeft = r.left;
    rectTop = r.top;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    moved = 0;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture indisponible (pointeur synthétique) : on continue sans */
    }
    const d = computeDir(e.clientX, e.clientY);
    if (d.y < 0) aimCopy(d);
    setDragging(true);
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const m = Math.hypot(dx, dy);
    if (m > moved) moved = m;
    if (sim.state.phase !== 'aiming') return;
    aimCopy(computeDir(e.clientX, e.clientY));
  }

  function end(e: PointerEvent, cancelled: boolean): void {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    pointerId = -1;
    try {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragging(false);
    if (sim.state.phase !== 'aiming') return;
    const d = computeDir(e.clientX, e.clientY);
    const m = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (m > moved) moved = m;
    if (!cancelled && moved > DRAG_THRESHOLD_PX && d.y < 0) {
      aimCopy(d);
      syncKeyAngle(d);
      sim.fire();
    } else {
      sim.cancelAim();
    }
  }

  const onPointerUp = (e: PointerEvent): void => end(e, false);
  const onPointerCancel = (e: PointerEvent): void => end(e, true);
  const onContextMenu = (e: Event): void => e.preventDefault();

  function aimFromKeyAngle(): void {
    const a = (keyAngle * Math.PI) / 180;
    dir.x = Math.cos(a);
    dir.y = -Math.sin(a);
    aimCopy(dir);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!isGameScreen()) return;
    const t = e.target;
    if (t instanceof HTMLButtonElement || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    const phase = sim.state.phase;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (phase !== 'aiming') return;
      // reprend l'angle courant de la sim si la souris a visé entre-temps
      const cur = sim.state.aimDir;
      if (cur) syncKeyAngle(cur);
      const step = e.shiftKey ? KEY_STEP_FINE_DEG : KEY_STEP_DEG;
      keyAngle += e.key === 'ArrowLeft' ? step : -step;
      keyAngle = Math.min(180 - minDeg, Math.max(minDeg, keyAngle));
      aimFromKeyAngle();
    } else if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      deps.audio?.unlock();
      if (phase === 'aiming') {
        if (!sim.state.aimDir) aimFromKeyAngle();
        sim.fire();
      } else if (phase === 'firing') {
        sim.recall();
      }
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  return {
    get dragging() {
      return pointerId !== -1;
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
