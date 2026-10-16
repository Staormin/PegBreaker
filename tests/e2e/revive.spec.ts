// tests/e2e/revive.spec.ts — propriétaire : qa-tester. Seconde chance (F4) de bout en bout, via le DOM.
// URL sans seed forcée (`/?fresh=1` + sim.restart(seed)) : main.ts ne crédite la méta (stats.runs) que pour ces runs.
//  1. run 1 : mort → « Revanche ? » → gratuit → aiming, hp = ceil(maxHp/2), rangées du bas vides → seconde mort
//     → bouton désactivé → Abandonner → run:over une seule fois → stats.runs = 1.
//  2. cas payant : profil avec 1 run et 100 ◆ → revive → solde débité de economy.revive.cost.
import { expect, test, type Page } from '@playwright/test';
import { FUN_SHOTS, installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

const SAVE_KEY = 'pegbreaker.save.v1';

async function counts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const c = (window as unknown as QaWindow).__pegbreaker.eventCounts;
    return { lost: c['run:lost'] ?? 0, revived: c['run:revived'] ?? 0, over: c['run:over'] ?? 0 };
  });
}

async function dieOnce(page: Page): Promise<void> {
  const r = await play(page, { stopOnPhases: ['gameover'], maxRealMs: 100_000 });
  expect(r.state.phase, `mort atteinte (arrêt : ${r.stopReason})`).toBe('gameover');
  await expect(page.locator('#ui[data-screen="revive"]')).toBeVisible({ timeout: 3000 });
}

test('seconde chance gratuite en run 1, puis seconde mort et abandon', async ({ page }) => {
  test.setTimeout(200_000);
  const errors = watchErrors(page);
  await page.goto('/?fresh=1');
  await waitReady(page);
  await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.restart('rev-1'));
  await page.evaluate(() => {
    const w = window as unknown as QaWindow & { __screens: string[] };
    w.__screens = [];
    w.__pegbreaker.bus.onAny((e) => {
      if (e.type === 'ui:screen') w.__screens.push(e.screen);
    });
  });
  await installBot(page, { bot: 'naive', seed: 'rev-1', onLost: 'none' });
  await setSpeed(page, 8);
  await dieOnce(page);
  await expect.poll(() => counts(page), { timeout: 3000 }).toEqual({ lost: 1, revived: 0, over: 0 });
  const btn = page.locator('[data-action="revive"]');
  await expect(btn).toBeEnabled();
  await expect(btn.locator('.revive-cost')).toHaveText('Gratuit');
  await expect(page.locator('.revive-countdown')).toContainText('Abandon dans');
  await page.screenshot({ path: `${FUN_SHOTS}/04-ecran-revanche.png` });
  const before = await page.evaluate(() => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    return { frags: api.meta.data.meta.fragments, maxHp: api.sim.state.maxHp, wave: api.sim.state.wave };
  });

  await btn.click();
  const after = await page.evaluate(() => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    const s = api.sim.state;
    const rows = api.sim.config.blocks.board.rows;
    const clear = api.sim.config.economy.revive.clearRows;
    return {
      phase: s.phase,
      hp: s.hp,
      maxHp: s.maxHp,
      revivesUsed: s.revivesUsed,
      frags: api.meta.data.meta.fragments,
      lowBlocks: s.blocks.filter((b) => b.row >= rows - 1 - clear).map((b) => `${b.kind}@${b.col},${b.row}`),
      screen: document.getElementById('ui')?.dataset.screen,
    };
  });
  test.info().annotations.push({ type: 'après revanche', description: JSON.stringify({ before, after }) });
  expect(after.phase).toBe('aiming');
  expect(after.hp).toBe(Math.ceil(after.maxHp / 2));
  expect(after.revivesUsed).toBe(1);
  expect(after.lowBlocks, '3 rangées du bas vides').toEqual([]);
  expect(after.frags, 'gratuit : aucun ◆ débité').toBe(before.frags);
  await expect.poll(() => page.evaluate(() => document.getElementById('ui')?.dataset.screen)).toBe('game');
  await expect.poll(() => counts(page), { timeout: 3000 }).toEqual({ lost: 1, revived: 1, over: 0 });

  // seconde mort : la revanche n'est plus proposée
  await dieOnce(page);
  await expect(btn).toBeDisabled();
  await expect(page.locator('.revive-offer')).toHaveText('Seconde chance déjà utilisée');
  await expect.poll(() => counts(page), { timeout: 3000 }).toEqual({ lost: 2, revived: 1, over: 0 });
  await page.locator('[data-action="give-up"]').click();
  await expect(page.locator('.screen-gameover')).toHaveClass(/visible/);
  await page.waitForTimeout(500);
  await expect.poll(() => counts(page), { timeout: 3000 }).toEqual({ lost: 2, revived: 1, over: 1 });
  const screens = await page.evaluate(() => (window as unknown as QaWindow & { __screens: string[] }).__screens.slice());
  // UiScreen contient 'revive' depuis le lot 1 ; ui/index.ts annonce encore 'gameover' (voir F4-01 du rapport)
  test.info().annotations.push({ type: 'ui:screen', description: JSON.stringify(screens) });
  const runs = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.meta.data.stats.runs);
  expect(runs).toBe(1);
  const pageErrors = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice());
  expect(pageErrors).toEqual([]);
  expect(errors).toEqual([]);
});

test('seconde chance payante : solde débité du coût', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto('/?fresh=1');
  await waitReady(page);
  // profil : une run déjà jouée (plus de gratuité) et 100 ◆ crédités
  await page.evaluate((k) => {
    const d = JSON.parse(JSON.stringify((window as unknown as QaWindow).__pegbreaker.meta.data)) as {
      stats: { runs: number };
      meta: { fragments: number };
      currentRun: unknown;
    };
    d.stats.runs = 1;
    d.meta.fragments = 100;
    d.currentRun = null;
    localStorage.setItem(k, JSON.stringify(d));
  }, SAVE_KEY);
  await page.goto('/?fresh=1');
  await waitReady(page);
  const cost = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.config.economy.revive.cost);
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.meta.data.meta.fragments)).toBe(100);
  await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.restart('rev-paid'));
  await installBot(page, { bot: 'naive', seed: 'rev-paid', onLost: 'none' });
  await setSpeed(page, 8);
  await dieOnce(page);
  const btn = page.locator('[data-action="revive"]');
  await expect(btn).toBeEnabled();
  await expect(btn.locator('.revive-cost')).toHaveText(`${cost} ◆`);
  const f0 = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.meta.data.meta.fragments);
  await btn.click();
  const res = await page.evaluate((k) => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    const saved = JSON.parse(localStorage.getItem(k) ?? '{}') as { meta?: { fragments?: number } };
    return { phase: api.sim.state.phase, frags: api.meta.data.meta.fragments, savedFrags: saved.meta?.fragments ?? null };
  }, SAVE_KEY);
  test.info().annotations.push({ type: 'revanche payante', description: JSON.stringify({ cost, f0, ...res }) });
  expect(res.phase).toBe('aiming');
  expect(f0 - res.frags, `débit = economy.revive.cost (${cost})`).toBe(cost);
  expect(res.savedFrags, 'débit persisté').toBe(100 - cost);
  const pageErrors = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice());
  expect(pageErrors).toEqual([]);
  expect(errors).toEqual([]);
});
