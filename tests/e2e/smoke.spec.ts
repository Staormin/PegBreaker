// tests/e2e/smoke.spec.ts — propriétaire : qa-tester.
// Intégration de bout en bout avec le VRAI input : drag souris sur le canvas, drag tactile,
// clics DOM sur les écrans récompense / boutique / fin de run. Captures dans docs/qa/j1-shots/.
import { expect, test, type Page } from '@playwright/test';
import type { Vec2 } from '../../src/core/types';
import { SHOTS_DIR, boardToClient, configureBot, installBot, lowestBlockTarget, openGame, play, setSpeed, type QaWindow } from './bots';

const SHOTS = SHOTS_DIR;

async function phase(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase);
}

async function uiScreen(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.getElementById('ui')?.dataset.screen);
}

/** direction attendue (normalisée) du lanceur vers la cible plateau */
function expectedDir(launch: { x: number; y: number }, target: { x: number; y: number }): { x: number; y: number } {
  const dx = target.x - launch.x;
  const dy = target.y - launch.y;
  const l = Math.hypot(dx, dy);
  return { x: dx / l, y: dy / l };
}

async function aimDir(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const d = (window as unknown as QaWindow).__pegbreaker.sim.state.aimDir;
    return d ? { x: d.x, y: d.y } : null;
  });
}

test.describe('smoke J1', () => {
  test('desktop : souris, HUD, rappel, récompense, boutique, game over et rejouer via le DOM', async ({ page }) => {
    test.setTimeout(150_000);
    const { consoleErrors } = await openGame(page, 'qa-smoke');
    await page.waitForTimeout(400);
    expect(await phase(page)).toBe('aiming');
    await expect.poll(() => uiScreen(page), { timeout: 2000 }).toBe('game');
    await page.screenshot({ path: `${SHOTS}/01-debut.png` });

    // --- tir 1 : drag souris vers le bloc le plus bas ------------------------
    const { target, launch } = await lowestBlockTarget(page);
    const [tc, start] = (await boardToClient(page, [target, { x: 3.5, y: 8 }])) as [Vec2, Vec2];
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + tc.x) / 2, (start.y + tc.y) / 2, { steps: 4 });
    await page.mouse.move(tc.x, tc.y, { steps: 4 });
    await page.mouse.up();
    expect(await phase(page)).toBe('firing');
    const d = await aimDir(page);
    const e = expectedDir(launch, target);
    expect(d, 'aimDir après relâchement').not.toBeNull();
    expect(d!.x * e.x + d!.y * e.y, 'la visée suit le point relâché (cos)').toBeGreaterThan(0.995);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/02-volee-en-vol.png` });
    await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming', null, { timeout: 20_000 });

    const s1 = await page.evaluate(() => {
      const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
      return { shots: s.stats.shots, wave: s.wave, coins: s.coins, volley: s.volley.length, dmg: s.currentShotDamage, destroyed: s.stats.blocksDestroyed };
    });
    expect(s1.shots).toBe(1);
    // HUD synchronisé avec l'état
    await expect(page.locator('.hud-wave')).toHaveText(`V${s1.wave}`);
    await expect(page.locator('.hud-coins .num')).toHaveText(String(s1.coins));
    expect(Number.isInteger(s1.dmg), 'dégâts du tir entiers').toBe(true);
    const shotTxt = (await page.locator('.hud-shot .num').textContent()) ?? '';
    expect(shotTxt.replace(/\D/g, ''), 'HUD : dégâts du tir').toBe(String(s1.dmg));
    const pills = await page.locator('.hud-volley').evaluate((el) => el.textContent ?? '');
    expect(pills.length, 'volée affichée dans le HUD').toBeGreaterThan(0);
    test.info().annotations.push({ type: 'tir1', description: JSON.stringify(s1) });

    // --- tir 2 : souris + bouton Rappel pendant la volée --------------------
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 40, start.y - 200, { steps: 6 });
    await page.mouse.up();
    expect(await phase(page)).toBe('firing');
    const recall = page.locator('.hud-recall');
    await expect(recall).toHaveClass(/\bon\b/);
    await recall.click();
    const rs = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.recallSpeed);
    expect(rs, 'Rappel accélère la volée').toBeGreaterThan(1);
    await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming', null, { timeout: 20_000 });

    // --- avance rapide jusqu'à la récompense ; choix au DOM ------------------
    await installBot(page, { bot: 'greedy', seed: 'qa-smoke', handleChoices: false });
    await setSpeed(page, 8);
    let r = await play(page, { stopOnPhases: ['reward', 'shop', 'gameover'], maxRealMs: 60_000 });
    expect(r.state.phase, `récompense atteinte (arrêt : ${r.stopReason})`).toBe('reward');
    await expect(page.locator('.screen-reward')).toHaveClass(/visible/);
    const cards = page.locator('[data-reward-index]');
    await expect(cards).toHaveCount(3);
    await page.waitForTimeout(450); // cascade d'apparition
    await page.screenshot({ path: `${SHOTS}/03-recompense.png` });
    await cards.first().click();
    await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase !== 'reward');
    await expect(page.locator('.screen-reward')).not.toHaveClass(/visible/);
    expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.wave)).toBe(2);

    // --- vagues 2 et 3 : récompenses au DOM, puis boutique ---------------------
    let shopSeen = false;
    for (let guard = 0; guard < 6 && !shopSeen; guard++) {
      r = await play(page, { stopOnPhases: ['reward', 'shop', 'gameover'], maxRealMs: 60_000 });
      if (r.state.phase === 'reward') {
        await page.locator('[data-reward-index]').first().click();
        await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase !== 'reward');
      } else if (r.state.phase === 'shop') {
        shopSeen = true;
      } else break;
    }
    expect(shopSeen, `boutique atteinte (phase ${r.state.phase}, vague ${r.state.wave})`).toBe(true);
    expect(r.state.wave).toBe(3);
    await expect(page.locator('.screen-shop')).toHaveClass(/visible/);
    expect(await page.locator('[data-shop-index]').count()).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/04-boutique.png` });
    const buyable = page.locator('button[data-shop-index]:not([disabled])');
    if ((await buyable.count()) > 0) {
      const before = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.coins);
      await buyable.first().click();
      const after = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.coins);
      expect(after, 'achat débité').toBeLessThan(before);
      await expect(page.locator('.screen-shop .wallet .num')).toHaveText(String(after));
    }
    await page.locator('[data-action="leave-shop"]').click();
    await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming');
    expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.wave)).toBe(4);
    await expect.poll(() => uiScreen(page), { timeout: 2000 }).toBe('game');

    // --- jusqu'au game over (bot naïf, choix par la sim) ----------------------
    // lot 1 : la mort ouvre « Revanche ? » ; on abandonne au DOM
    await configureBot(page, { bot: 'naive', handleChoices: true, onLost: 'none' });
    r = await play(page, { stopOnPhases: ['gameover'], maxRealMs: 90_000 });
    expect(r.state.phase, `game over atteint (arrêt : ${r.stopReason})`).toBe('gameover');
    await expect(page.locator('#ui[data-screen="revive"]')).toBeVisible({ timeout: 3000 });
    expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.eventCounts['run:over'] ?? 0), 'pas de run:over avant la décision').toBe(0);
    await page.locator('[data-action="give-up"]').click();
    await expect(page.locator('.screen-gameover')).toHaveClass(/visible/);
    expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.eventCounts['run:over'] ?? 0)).toBe(1);
    await page.waitForTimeout(1300); // compteur de fragments
    await page.screenshot({ path: `${SHOTS}/05-fin-de-run.png` });
    const depthTxt = await page.locator('.screen-gameover .stat-val').first().textContent();
    expect(Number(depthTxt)).toBe(r.state.depth);

    await page.locator('[data-action="restart"]').click();
    await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming');
    const restarted = await page.evaluate(() => {
      const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
      return { wave: s.wave, shots: s.stats.shots, hp: s.hp, seed: s.seed };
    });
    expect(restarted.wave).toBe(1);
    expect(restarted.shots).toBe(0);
    expect(restarted.hp).toBeGreaterThan(0);
    await expect.poll(() => uiScreen(page), { timeout: 2000 }).toBe('game');
    await expect(page.locator('.screen-gameover')).not.toHaveClass(/visible/);

    const pageErrors = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice());
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test.describe('mobile 375×812 tactile', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

    test('tap ne tire pas, drag tactile tire, pas de scroll horizontal', async ({ page }) => {
      const { consoleErrors } = await openGame(page, 'qa-mobile');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/06-mobile-375x812.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'pas de scroll horizontal').toBeLessThanOrEqual(0);

      const { target, launch } = await lowestBlockTarget(page);
      const [tc, start] = (await boardToClient(page, [target, { x: 3.5, y: 8 }])) as [Vec2, Vec2];

      // un tap (< 12 px de déplacement) ne doit pas tirer
      await page.touchscreen.tap(start.x, start.y);
      await page.waitForTimeout(100);
      expect(await phase(page)).toBe('aiming');

      // drag tactile (Input.dispatchTouchEvent : page.touchscreen ne sait que taper)
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
      for (let i = 1; i <= 6; i++) {
        const k = i / 6;
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: start.x + (tc.x - start.x) * k, y: start.y + (tc.y - start.y) * k }],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'firing', null, { timeout: 2000 });
      const d = await aimDir(page);
      const e = expectedDir(launch, target);
      expect(d!.x * e.x + d!.y * e.y, 'la visée tactile suit le doigt (cos)').toBeGreaterThan(0.995);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/07-mobile-volee.png` });
      await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming', null, { timeout: 20_000 });
      const shots = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.stats.shots);
      expect(shots).toBe(1);
      await expect(page.locator('.hud-wave')).toHaveText('V1');
      expect(consoleErrors).toEqual([]);
    });
  });
});
