// tests/e2e/daily.spec.ts — propriétaire : qa-tester. Quotidien muté + série (F8).
// `?daily=1` (sans qa=1 : la run est créditée) : badge .hud-daily avec 2 mutateurs = meta.dailyMods(), seed du jour stable
// sur deux chargements ; fin de run → daily[today] avec mods et streak 1 ; puis 3 jours consécutifs simulés dans
// localStorage → série 4 et fragments × 1,3 (bonus de série sur les ◆ de la run, hors succès).
import { expect, test, type Page } from '@playwright/test';
import { FUN_SHOTS, installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

const SAVE_KEY = 'pegbreaker.save.v1';

type DailyWindow = QaWindow & { __over: { fragmentsEarned: number; isDaily: boolean; dailyDate: string | null } | null; __achFrags: number };

function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** branche les écouteurs (résumé de run:over, ◆ de succès) puis joue la run quotidienne jusqu'à l'abandon */
async function playDaily(page: Page, tag: string): Promise<{ earned: number; achFrags: number; fragsBefore: number; fragsAfter: number; wave: number }> {
  const fragsBefore = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.meta.data.meta.fragments);
  await page.evaluate(() => {
    const w = window as unknown as DailyWindow;
    w.__over = null;
    w.__achFrags = 0;
    const defs = w.__pegbreaker.sim.config.meta.achievements;
    w.__pegbreaker.bus.onAny((e) => {
      if (e.type === 'run:over') w.__over = { fragmentsEarned: e.summary.stats.fragmentsEarned, isDaily: e.summary.isDaily, dailyDate: e.summary.dailyDate };
      if (e.type === 'achievement:unlocked') w.__achFrags += defs.find((a) => a.id === e.achievementId)?.rewardFragments ?? 0;
    });
  });
  await installBot(page, { bot: 'naive', seed: `daily-${tag}`, onLost: 'giveUp' });
  await setSpeed(page, 8);
  const r = await play(page, { maxRealMs: 120_000 });
  expect(r.stopReason, 'run quotidienne terminée').toBe('gameover');
  await expect(page.locator('.screen-gameover')).toHaveClass(/visible/);
  await page.waitForTimeout(300);
  const o = await page.evaluate(() => {
    const w = window as unknown as DailyWindow;
    return { over: w.__over, achFrags: w.__achFrags, frags: w.__pegbreaker.meta.data.meta.fragments };
  });
  expect(o.over?.isDaily, 'résumé isDaily').toBe(true);
  return { earned: o.over?.fragmentsEarned ?? -1, achFrags: o.achFrags, fragsBefore, fragsAfter: o.frags, wave: r.state.wave };
}

test('quotidien : 2 mutateurs du jour, seed stable, résultat enregistré, série 4 → ×1,3', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('/?daily=1');
  await waitReady(page);
  const info = await page.evaluate(() => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    return { today: api.meta.todayKey(), mods: api.meta.dailyMods(), seed: api.meta.dailySeed(), simSeed: api.sim.state.seed, isDaily: api.sim.state.seed };
  });
  expect(info.mods.length, '2 mutateurs du jour').toBe(2);
  expect(new Set(info.mods).size).toBe(2);
  expect(info.simSeed, 'seed de la run = seed du jour').toBe(info.seed);
  const chips = page.locator('.hud-daily .hud-mod[data-mod]');
  await expect(page.locator('.hud-daily')).toBeVisible();
  await expect(chips).toHaveCount(2);
  const shown = await chips.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.mod));
  expect(shown, 'badge = meta.dailyMods()').toEqual(info.mods);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${FUN_SHOTS}/11-quotidien-mutateurs.png` });

  // même seed au second chargement
  await page.reload();
  await waitReady(page);
  const seed2 = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.seed);
  expect(seed2).toBe(info.seed);

  // run 1 du jour : streak 1, multiplicateur ×1
  const run1 = await playDaily(page, 'a');
  const d1 = await page.evaluate((t) => JSON.parse(JSON.stringify((window as unknown as QaWindow).__pegbreaker.meta.data.daily[t] ?? null)) as Record<string, unknown> | null, info.today);
  test.info().annotations.push({ type: 'quotidien run 1', description: JSON.stringify({ info, run1, d1 }) });
  expect(d1, 'daily[today] enregistré').not.toBeNull();
  expect(d1!['mods']).toEqual(info.mods);
  expect(d1!['streak']).toBe(1);
  expect(run1.fragsAfter - run1.fragsBefore, '◆ crédités = run × 1 + succès').toBe(Math.round(run1.earned * 1) + run1.achFrags);
  await expect(page.locator('.daily-streak-end')).toHaveAttribute('data-streak', '1');

  // 3 jours consécutifs avant aujourd'hui → série 4
  const prev = [previousDay(info.today)];
  prev.push(previousDay(prev[0] as string));
  prev.push(previousDay(prev[1] as string));
  await page.evaluate(
    ({ k, days }) => {
      const d = JSON.parse(localStorage.getItem(k) as string) as { daily: Record<string, unknown>; currentRun: unknown };
      days.forEach((day, i) => {
        d.daily[day] = { depth: 20 + i, score: 1000 + i, completedAt: `${day}T12:00:00.000Z`, mods: [], streak: 3 - i };
      });
      d.currentRun = null;
      localStorage.setItem(k, JSON.stringify(d));
    },
    { k: SAVE_KEY, days: prev },
  );
  await page.goto('/?daily=1');
  await waitReady(page);
  const streakNow = await page.evaluate(() => {
    const m = (window as unknown as QaWindow).__pegbreaker.meta;
    return { streak: m.dailyStreak(), mult: m.dailyStreakMultiplier(m.dailyStreak()) };
  });
  expect(streakNow).toEqual({ streak: 4, mult: 1.3 });
  const run2 = await playDaily(page, 'b');
  const d2 = await page.evaluate((t) => JSON.parse(JSON.stringify((window as unknown as QaWindow).__pegbreaker.meta.data.daily[t] ?? null)) as Record<string, unknown> | null, info.today);
  test.info().annotations.push({ type: 'quotidien série 4', description: JSON.stringify({ prev, run2, d2 }) });
  expect(d2!['streak']).toBe(4);
  expect(run2.fragsAfter - run2.fragsBefore, '◆ crédités = round(run × 1,3) + succès').toBe(Math.round(run2.earned * 1.3) + run2.achFrags);
  await expect(page.locator('.daily-streak-end')).toHaveAttribute('data-streak', '4');
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${FUN_SHOTS}/12-quotidien-fin-serie.png` });

  // écran du quotidien : série et calendrier
  await page.locator('[data-action="daily"]').click();
  await expect(page.locator('#ui[data-screen="daily"]')).toBeVisible();
  await expect(page.locator('.daily-streak')).toHaveAttribute('data-streak', '4');
  const played = await page.locator('.cal-day[data-state="played"]').count();
  expect(played, 'au moins 4 jours joués au calendrier').toBeGreaterThanOrEqual(4);
  await expect(page.locator('.daily-mod[data-mod]')).toHaveCount(2);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${FUN_SHOTS}/13-quotidien-serie-calendrier.png` });

  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});
