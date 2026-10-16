// tests/e2e/share.spec.ts — propriétaire : qa-tester. Carte de score + défi par lien (F6).
// navigator.share absent, navigator.clipboard.writeText intercepté par un init script.
// 1. fin de run → [data-action=share] → lien ?seed=…&goal=<profondeur> copié + PNG téléchargé (> 20 ko)
// 2. le lien dans une nouvelle page → badge .hud-challenge, même seed, et .challenge-result cohérent en fin de run.
import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { FUN_SHOTS, installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

/** qa-1 : run naïve courte (vague 4, 29 tirs) */
const SEED = 'qa-1';

type ShareWindow = QaWindow & { __copied: string[] };

async function stubShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    try {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
      Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
    } catch {
      /* ignore */
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string): Promise<void> => {
          w.__copied.push(t);
          return Promise.resolve();
        },
      },
    });
  });
}

async function playToEnd(page: Page, seed: string): Promise<{ depth: number; wave: number }> {
  await installBot(page, { bot: 'naive', seed, onLost: 'giveUp' });
  await setSpeed(page, 8);
  const r = await play(page, { maxRealMs: 100_000 });
  expect(r.stopReason, 'run terminée').toBe('gameover');
  expect(r.runOverCount).toBe(1);
  await expect(page.locator('.screen-gameover')).toHaveClass(/visible/);
  return { depth: r.state.depth, wave: r.state.wave };
}

test('partage : lien de défi copié, PNG téléchargé, défi rejoué sur la même graine', async ({ context }) => {
  test.setTimeout(240_000);
  mkdirSync(FUN_SHOTS, { recursive: true });
  const page = await context.newPage();
  await stubShare(page);
  const errors = watchErrors(page);
  await page.goto(`/?seed=${SEED}`);
  await waitReady(page);
  expect(await page.locator('.hud-challenge').count(), 'pas de badge hors défi').toBe(0);
  const end1 = await playToEnd(page, SEED);

  const share = page.locator('[data-action="share"]');
  await expect(share).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), share.click()]);
  const tmp = await download.path();
  const size = statSync(tmp).size;
  copyFileSync(tmp, `${FUN_SHOTS}/05-carte-partage.png`);
  const copied = await page.evaluate(() => (window as unknown as ShareWindow).__copied.slice());
  await expect(page.locator('.share-msg')).toBeVisible();
  const msg = await page.locator('.share-msg').textContent();
  test.info().annotations.push({ type: 'partage', description: JSON.stringify({ end1, size, name: download.suggestedFilename(), copied, msg }) });
  expect(size, 'PNG > 20 ko').toBeGreaterThan(20_000);
  expect(download.suggestedFilename()).toBe(`pegbreaker-p${end1.depth}.png`);
  expect(copied.length, 'lien copié une fois').toBe(1);
  const link = new URL(copied[0] as string);
  expect(link.searchParams.get('seed')).toBe(SEED);
  expect(link.searchParams.get('goal')).toBe(String(end1.depth));
  await page.screenshot({ path: `${FUN_SHOTS}/06-fin-de-run-partage.png` });

  // --- le destinataire ouvre le lien -----------------------------------------
  const page2 = await context.newPage();
  const errors2 = watchErrors(page2);
  await page2.goto(link.pathname + link.search);
  await waitReady(page2);
  await expect(page2.locator('.hud-challenge')).toBeVisible();
  await expect(page2.locator('.hud-challenge')).toContainText(`P${end1.depth}`);
  expect(await page2.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.seed)).toBe(SEED);
  await page2.screenshot({ path: `${FUN_SHOTS}/07-defi-badge.png` });
  const end2 = await playToEnd(page2, SEED);
  const result = page2.locator('.challenge-result');
  await expect(result).toBeVisible();
  const expected = end2.depth > end1.depth ? 'won' : 'lost';
  await expect(result).toHaveAttribute('data-result', expected);
  const txt = (await result.textContent()) ?? '';
  test.info().annotations.push({ type: 'défi', description: JSON.stringify({ goal: end1.depth, end2, result: expected, txt }) });
  if (expected === 'lost') expect(txt).toContain(`P${end2.depth} / P${end1.depth}`);
  await expect(page2.locator('[data-action="replay-challenge"]')).toBeVisible();
  // déterminisme : même graine + même bot → même profondeur
  expect(end2.depth, 'défi rejoué à l\'identique').toBe(end1.depth);
  const meta2 = await page2.evaluate(() => {
    const m = (window as unknown as QaWindow).__pegbreaker.meta.data;
    return { runs: m.stats.runs, fragments: m.meta.fragments, bestWave: m.stats.bestWave };
  });
  const shownFrags = await page2.locator('.frag-gain .num').textContent();
  test.info().annotations.push({ type: 'méta après défi (voir F6-01)', description: JSON.stringify({ meta2, shownFrags }) });
  await page2.screenshot({ path: `${FUN_SHOTS}/08-defi-resultat.png` });

  for (const p of [page, page2]) expect(await p.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

// F6-01 : une run lancée depuis un lien de défi (?seed=X&goal=N) n'est jamais créditée à la méta (main.ts ignore
// run:over quand ?seed= est présent), alors que l'écran de fin affiche « +N ◆ » et « Nouveau record ».
// test.fail : passera au rouge (donc à retirer) quand le bug sera corrigé.
test('BUG F6-01 connu : la run de défi crédite fragments et stats', async ({ page }) => {
  test.fail();
  test.setTimeout(120_000);
  await page.goto('/?seed=qa-1&goal=10');
  await waitReady(page);
  await playToEnd(page, 'qa-1');
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const d = (window as unknown as QaWindow).__pegbreaker.meta.data;
    return { runs: d.stats.runs, fragments: d.meta.fragments };
  });
  const shown = Number(((await page.locator('.frag-gain .num').textContent()) ?? '0').replace(/\D/g, ''));
  test.info().annotations.push({ type: 'F6-01', description: JSON.stringify({ ...m, shown }) });
  expect(shown, 'fragments affichés').toBeGreaterThan(0);
  expect(m.runs, 'run comptée').toBe(1);
  expect(m.fragments, 'fragments crédités = affichés').toBe(shown);
});
