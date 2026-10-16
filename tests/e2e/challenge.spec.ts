// tests/e2e/challenge.spec.ts — propriétaire : qa-tester. Défi par lien (F6) : crédit de la run et résultat.
// Règle d'équité (FUN.md, 2026-10-17) : un lien `?goal=` joue le pool standard (27 balles, toutes les reliques, sans méta),
// `?seed=X` seul joue le pool du joueur. La référence doit donc être une run de défi elle aussi : `goal=0&qa=1`.
// 1. run de référence `?seed=qa-1&goal=0&qa=1` (pool standard, non créditée) → profondeur D ;
// 2. lien `?seed=qa-1&goal=D` (crédité, F6-01 corrigé), même bot → même profondeur → égalité (data-result="tie") ;
// 3. `goal` = D − 1 → « won », `goal` = D + 50 → « lost » (même profil : stats.runs 2 puis 3).
import { expect, test, type Page } from '@playwright/test';
import { FUN_SHOTS, installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

const SEED = 'qa-1';

async function runTo(page: Page, url: string): Promise<{ depth: number; wave: number }> {
  await page.goto(url);
  await waitReady(page);
  await installBot(page, { bot: 'naive', seed: SEED, onLost: 'giveUp' });
  await setSpeed(page, 8);
  const r = await play(page, { maxRealMs: 100_000 });
  expect(r.stopReason).toBe('gameover');
  await expect(page.locator('.screen-gameover')).toHaveClass(/visible/);
  await page.waitForTimeout(300);
  return { depth: r.state.depth, wave: r.state.wave };
}

async function metaView(page: Page): Promise<{ runs: number; fragments: number; bestDepth: number }> {
  return page.evaluate(() => {
    const d = (window as unknown as QaWindow).__pegbreaker.meta.data;
    return { runs: d.stats.runs, fragments: d.meta.fragments, bestDepth: d.stats.bestDepth };
  });
}

test('défi : run créditée, égalité, victoire et défaite', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  const ref = await runTo(page, `/?seed=${SEED}&goal=0&qa=1`);
  const m0 = await metaView(page);
  expect(m0.runs, 'qa=1 : run non créditée').toBe(0);
  expect(m0.fragments).toBe(0);

  // égalité, run créditée
  const tie = await runTo(page, `/?seed=${SEED}&goal=${ref.depth}`);
  await expect(page.locator('.hud-challenge')).toContainText(`P${ref.depth}`);
  const m1 = await metaView(page);
  const shown = Number(((await page.locator('.frag-gain .num').textContent()) ?? '0').replace(/\D/g, ''));
  const result = page.locator('.challenge-result');
  await expect(result).toBeVisible();
  const tieTxt = (await result.textContent()) ?? '';
  test.info().annotations.push({ type: 'égalité', description: JSON.stringify({ ref, tie, m1, shown, tieTxt }) });
  expect(tie.depth, 'même graine, même bot → même profondeur').toBe(ref.depth);
  await expect(result).toHaveAttribute('data-result', 'tie');
  expect(tieTxt).toContain('Égalité');
  expect(m1.runs, 'run de défi comptée').toBe(1);
  expect(shown, '◆ affichés').toBeGreaterThan(0);
  expect(m1.fragments, '◆ crédités ≥ affichés (+ succès)').toBeGreaterThanOrEqual(shown);
  expect(m1.bestDepth).toBe(ref.depth);
  await page.screenshot({ path: `${FUN_SHOTS}/14-defi-egalite.png` });

  // victoire puis défaite
  await runTo(page, `/?seed=${SEED}&goal=${ref.depth - 1}`);
  await expect(page.locator('.challenge-result')).toHaveAttribute('data-result', 'won');
  await runTo(page, `/?seed=${SEED}&goal=${ref.depth + 50}`);
  await expect(page.locator('.challenge-result')).toHaveAttribute('data-result', 'lost');
  await expect(page.locator('.challenge-result')).toContainText(`P${ref.depth} / P${ref.depth + 50}`);
  const m3 = await metaView(page);
  expect(m3.runs).toBe(3);
  expect(m3.fragments).toBeGreaterThan(m1.fragments);
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});
