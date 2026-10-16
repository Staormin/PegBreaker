// tests/e2e/persistence.spec.ts — propriétaire : qa-tester. Jalon 3 : sauvegarde, reprise, méta, réglages.
// Chaque test a son propre contexte (localStorage vierge). Les URL sans `?seed=` sont indispensables :
// main.ts ne sauvegarde jamais une run à seed forcée et n'appelle pas meta.onRunEnd pour elle.
import { expect, test, type Page } from '@playwright/test';
import { SHOTS_DIR, installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

const SAVE_KEY = 'pegbreaker.save.v1';
const BACKUP_KEY = 'pegbreaker.save.backup';

interface RunView {
  seed: string;
  depth: number;
  hp: number;
  maxHp: number;
  wave: number;
  coins: number;
  phase: string;
  volley: string[];
  blocks: string[];
}

async function runView(page: Page): Promise<RunView> {
  return page.evaluate(() => {
    const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
    return {
      seed: s.seed,
      depth: s.depth,
      hp: s.hp,
      maxHp: s.maxHp,
      wave: s.wave,
      coins: s.coins,
      phase: s.phase,
      volley: s.volley.map((v) => `${v.element}${v.tier}`),
      blocks: s.blocks.map((b) => `${b.id}:${b.kind}@${b.col},${b.row}w${b.width} ${b.hp}/${b.maxHp}${b.frozen ? '*' : ''}`).sort(),
    };
  });
}

async function phaseIs(page: Page, p: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction((x) => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === x, p, { timeout });
}

async function screenIs(page: Page, id: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.getElementById('ui')?.dataset.screen), { timeout: 3000 }).toBe(id);
}

test('(a) reprise : 3 tirs, rechargement, état identique', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await page.goto('/');
  await waitReady(page);
  await installBot(page, { bot: 'greedy', seed: 'persist-a' });
  await setSpeed(page, 4);
  const r = await play(page, { shots: 3, maxRealMs: 30_000 });
  expect(r.shots).toBeGreaterThanOrEqual(3);
  await setSpeed(page, 1);
  await page.waitForFunction(() => ['aiming', 'reward', 'shop'].includes((window as unknown as QaWindow).__pegbreaker.sim.state.phase));
  await page.waitForTimeout(300); // sauvegarde au changement de phase (frame suivante)
  const before = await runView(page);
  const saved = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
  expect(saved, 'sauvegarde écrite').not.toBeNull();
  await page.reload();
  await waitReady(page);
  const after = await runView(page);
  expect(after.depth).toBeGreaterThanOrEqual(3);
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('(b)(c) fin de run → stats et fragments ; achat au Puits via le DOM → maxHp +1', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto('/?fresh=1');
  await waitReady(page);
  await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.restart('persist-b'));
  await installBot(page, { bot: 'greedy', seed: 'persist-b' });
  await setSpeed(page, 8);
  const r = await play(page, { maxRealMs: 110_000 });
  expect(r.stopReason).toBe('gameover');
  // toasts : vérifiés tout de suite (ils disparaissent après 3 s)
  const toastCount = await page.locator('.toast').count();
  const meta1 = await page.evaluate(() => {
    const m = (window as unknown as QaWindow).__pegbreaker.meta.data;
    return { runs: m.stats.runs, fragments: m.meta.fragments, achievements: [...m.achievements], bestWave: m.stats.bestWave };
  });
  test.info().annotations.push({ type: 'méta après run', description: JSON.stringify({ ...meta1, toastCount, wave: r.state.wave }) });
  expect(meta1.runs).toBe(1);
  expect(meta1.fragments).toBeGreaterThan(0);
  expect(meta1.bestWave).toBe(r.state.wave);
  if (meta1.achievements.length > 0) expect(toastCount, `toasts pour ${meta1.achievements.join(',')}`).toBeGreaterThan(0);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${SHOTS_DIR}/10-fin-de-run-meta.png` });

  // (c) crédit de fragments si besoin (via le localStorage, page rechargée aussitôt)
  const hpCost = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.config.meta.nodes.find((n) => n.id === 'hp')!.costs[0]!);
  const credited = meta1.fragments < hpCost;
  if (credited) {
    await page.evaluate((k) => {
      const d = JSON.parse(localStorage.getItem(k) as string) as { meta: { fragments: number } };
      d.meta.fragments += 200;
      localStorage.setItem(k, JSON.stringify(d));
    }, SAVE_KEY);
  }
  await page.goto('/?fresh=1');
  await waitReady(page);
  const maxHp0 = (await runView(page)).maxHp;
  await page.locator('.hud-frags').click();
  await screenIs(page, 'meta');
  const tab = page.locator('.screen-meta .tab', { hasText: 'Fondations' });
  if (await tab.isVisible()) await tab.click();
  const buy = page.locator('.screen-meta [data-node-id="hp"] [data-action="buy-node"]');
  await expect(buy).toBeEnabled();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS_DIR}/11-puits-desktop.png` });
  await buy.click();
  const lvl = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.meta.data.meta.nodes['hp'] ?? 0);
  expect(lvl).toBe(1);
  await page.goto('/?fresh=1');
  await waitReady(page);
  const maxHp1 = (await runView(page)).maxHp;
  test.info().annotations.push({ type: 'puits', description: JSON.stringify({ hpCost, credited, maxHp0, maxHp1 }) });
  expect(maxHp1).toBe(maxHp0 + 1);
  expect(errors).toEqual([]);
});

test('(d) sauvegarde corrompue : le jeu charge, backup créé, 0 erreur console', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await waitReady(page, false);
  await page.evaluate((k) => localStorage.setItem(k, 'xxx'), SAVE_KEY);
  await page.reload();
  await waitReady(page);
  const st = await page.evaluate((keys) => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    return {
      phase: api.sim.state.phase,
      backup: localStorage.getItem(keys[1]!),
      save: localStorage.getItem(keys[0]!),
      runs: api.meta.data.stats.runs,
      errors: api.errors.slice(),
    };
  }, [SAVE_KEY, BACKUP_KEY]);
  expect(st.phase).toBe('aiming');
  expect(st.backup, 'clé pegbreaker.save.backup').toBe('xxx');
  expect(st.runs).toBe(0);
  expect(st.errors).toEqual([]);
  expect(errors).toEqual([]);
});

test('(e) réglages : secousses et SFX coupés via le DOM, persistants, aucun SFX joué après unlock', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await page.goto('/');
  await waitReady(page);
  await page.locator('.hud-gear').click();
  await screenIs(page, 'settings');
  const shake = page.locator('[data-setting="shake"]');
  await expect(shake).toHaveClass(/\bon\b/);
  await shake.click();
  await expect(shake).not.toHaveClass(/\bon\b/);
  await page.locator('input[data-setting="sfx"]').fill('0');
  const s1 = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.meta.data.settings);
  expect(s1.shake).toBe(false);
  expect(s1.sfx).toBe(0);

  await page.reload();
  await waitReady(page); // le titre (si présent) est fermé par un clic = unlock audio
  const s2 = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.meta.data.settings);
  expect(s2.shake).toBe(false);
  expect(s2.sfx).toBe(0);
  await page.locator('.hud-gear').click();
  await screenIs(page, 'settings');
  await expect(page.locator('[data-setting="shake"]')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('input[data-setting="sfx"]')).toHaveValue('0');
  await page.locator('.screen-settings .btn-primary').click();
  await screenIs(page, 'game');

  // déverrouillage par un vrai geste (pointerdown sur le canvas), puis 3 tirs
  await page.mouse.click(270, 500);
  await installBot(page, { bot: 'greedy', seed: 'persist-e' });
  await setSpeed(page, 4);
  await play(page, { shots: 3, maxRealMs: 30_000 });
  const audio = await page.evaluate(() => {
    const a = (window as unknown as QaWindow).__pegbreaker.audio as unknown as {
      unlocked: boolean;
      debug: { contextState: string; mixer: { accepted: number; dropped: number }; engine: { nodesCreated: number } };
    };
    return { unlocked: a.unlocked, state: a.debug.contextState, accepted: a.debug.mixer.accepted, nodes: a.debug.engine.nodesCreated };
  });
  test.info().annotations.push({ type: 'audio sfx=0', description: JSON.stringify(audio) });
  expect(audio.unlocked, 'contexte audio déverrouillé').toBe(true);
  expect(audio.accepted, 'aucune voix SFX admise avec sfx = 0').toBe(0);
  expect(errors).toEqual([]);
});

test.describe('mobile 375×812', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  test('écran titre puis Puits', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await waitReady(page, false);
    // premier lancement : écran titre, ou (UI récente) logo d'onboarding par-dessus le plateau
    await expect
      .poll(() => page.evaluate(() => document.getElementById('ui')?.dataset.screen === 'title' || !!document.querySelector('.intro-logo.on')))
      .toBe(true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS_DIR}/12-premier-lancement-mobile.png` });
    await page.touchscreen.tap(187, 400);
    await screenIs(page, 'game');
    await page.locator('.hud-frags').tap();
    await screenIs(page, 'meta');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS_DIR}/13-puits-mobile-375x812.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'pas de scroll horizontal dans le Puits').toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
