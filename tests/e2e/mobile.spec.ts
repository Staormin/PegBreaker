// tests/e2e/mobile.spec.ts — propriétaire : qa-tester. Mise en page mobile (375×812 et 360×640, DPR 2, tactile).
import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import type { Vec2 } from '../../src/core/types';
import { FINAL_SHOTS, boardToClient, lowestBlockTarget, openGame, type QaWindow } from './bots';

interface Box {
  sel: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** rectangles visibles des éléments du HUD + rectangle du plateau (lignes 0..rows) */
async function layoutBoxes(page: Page): Promise<{ board: Box; hud: Box[]; buttons: Box[]; scroll: { w: number; h: number; vw: number; vh: number } }> {
  return page.evaluate(() => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    const { cols, rows } = api.sim.config.blocks.board;
    const c = (document.getElementById('game') as HTMLCanvasElement).getBoundingClientRect();
    const p0 = api.renderer.boardToScreen({ x: 0, y: 0 });
    const p1 = api.renderer.boardToScreen({ x: cols, y: rows });
    const board = { sel: 'plateau', x: c.left + p0.x, y: c.top + p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
    const vis = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const box = (sel: string, e: Element): { sel: string; x: number; y: number; w: number; h: number } => {
      const r = e.getBoundingClientRect();
      return { sel, x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const hud: ReturnType<typeof box>[] = [];
    for (const sel of ['.hud-hp', '.hud-wave', '.hud-coins', '.hud-frags', '.hud-volley', '.hud-gear', '.hud-recall']) {
      const e = document.querySelector(sel);
      if (e && vis(e)) hud.push(box(sel, e));
    }
    const buttons: ReturnType<typeof box>[] = [];
    document.querySelectorAll('#ui button').forEach((b) => {
      if (vis(b)) buttons.push(box(b.className || b.tagName, b));
    });
    return {
      board,
      hud,
      buttons,
      scroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, vw: window.innerWidth, vh: window.innerHeight },
    };
  });
}

const overlap = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

interface Measure {
  dpr: number;
  restOverlaps: { sel: string; px: number }[];
  firingOverlaps: { sel: string; px: number }[];
  small: string[];
  L: Awaited<ReturnType<typeof layoutBoxes>>;
  consoleErrors: string[];
}

/** charge, mesure au repos, tire au doigt (CDP), mesure pendant la volée ; captures optionnelles */
async function measure(page: Page, vp: { width: number; height: number }, shots: boolean): Promise<Measure> {
  const { consoleErrors } = await openGame(page, `mobile-${vp.width}`);
  await page.waitForTimeout(600);
  const L = await layoutBoxes(page);
  const dpr = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.renderer.dpr);
  if (shots) await page.screenshot({ path: `${FINAL_SHOTS}/0${vp.width === 375 ? 2 : 3}-mobile-${vp.width}x${vp.height}.png` });
  const { target } = await lowestBlockTarget(page);
  const [tc, start] = (await boardToClient(page, [target, { x: 3.5, y: 8.5 }])) as [Vec2, Vec2];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
  for (let i = 1; i <= 8; i++) {
    const k = i / 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (tc.x - start.x) * k, y: start.y + (tc.y - start.y) * k }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'firing', null, { timeout: 2000 });
  await page.waitForTimeout(400);
  const Lf = await layoutBoxes(page); // pendant la volée : bouton Rappel visible
  if (shots) await page.screenshot({ path: `${FINAL_SHOTS}/0${vp.width === 375 ? 4 : 5}-mobile-${vp.width}x${vp.height}-volee.png` });
  const ov = (hud: Box[]): { sel: string; px: number }[] =>
    hud.map((b) => ({ sel: b.sel, px: Math.round(overlap(b, L.board)) })).filter((o) => o.px > 0);
  const small = [...L.buttons, ...Lf.buttons].filter((b) => Math.min(b.w, b.h) < 48 - 0.5).map((b) => `${b.sel} ${Math.round(b.w)}×${Math.round(b.h)}`);
  const m = { dpr, restOverlaps: ov(L.hud), firingOverlaps: ov(Lf.hud), small, L, consoleErrors };
  if (shots) {
    writeFileSync(
      `docs/qa/final-mobile-${vp.width}x${vp.height}.json`,
      JSON.stringify({ viewport: vp, rendererDpr: dpr, board: L.board, hud: L.hud, hudFiring: Lf.hud, buttons: [...L.buttons, ...Lf.buttons], restOverlaps: m.restOverlaps, firingOverlaps: m.firingOverlaps, small, scroll: L.scroll }, null, 2) + '\n',
    );
  }
  return m;
}

for (const vp of [
  { width: 375, height: 812 },
  { width: 360, height: 640 },
]) {
  test.describe(`mobile ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

    test('HUD hors plateau au repos, pas de scroll, drag tactile, boutons ≥ 48 px, DPR ≤ 1,5', async ({ page }) => {
      test.setTimeout(60_000);
      const m = await measure(page, vp, true);
      test.info().annotations.push({ type: 'mobile', description: JSON.stringify({ dpr: m.dpr, rest: m.restOverlaps, firing: m.firingOverlaps, small: m.small, scroll: m.L.scroll }) });
      expect(m.restOverlaps, 'aucun élément du HUD ne recouvre le plateau (visée)').toEqual([]);
      expect(m.L.scroll.w, 'pas de scroll horizontal').toBeLessThanOrEqual(m.L.scroll.vw);
      expect(m.L.scroll.h, 'pas de scroll vertical').toBeLessThanOrEqual(m.L.scroll.vh);
      expect(m.L.board.x, 'plateau dans l’écran (gauche)').toBeGreaterThanOrEqual(-0.5);
      expect(m.L.board.x + m.L.board.w, 'plateau dans l’écran (droite)').toBeLessThanOrEqual(vp.width + 0.5);
      // bouton ◆ (Puits) hors de ce contrôle : bug connu J4-01, testé à part
      expect(m.small.filter((x) => !x.includes('hud-frags')), 'boutons visibles ≥ 48 px').toEqual([]);
      expect(m.dpr, 'renderer.dpr plafonné en DPR 2 mobile').toBeLessThanOrEqual(1.5);
      expect(m.consoleErrors).toEqual([]);
    });

    test('J4-01 corrigé : bouton ◆ du Puits ≥ 48 px', async ({ page }) => {
      const m = await measure(page, vp, false);
      expect(m.small.filter((x) => x.includes('hud-frags'))).toEqual([]);
    });

    test('HUD hors plateau pendant la volée (J4-02 corrigé : ⚙ à côté de ⏩)', async ({ page }) => {
      const m = await measure(page, vp, false);
      expect(m.firingOverlaps).toEqual([]);
    });
  });
}
