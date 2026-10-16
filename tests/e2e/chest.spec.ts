// tests/e2e/chest.spec.ts — propriétaire : qa-tester. Coffre de boss (F9), via le DOM.
// Seed qa-2 + bot greedy (vitesse 8), profil où toutes les épiques sont débloquées : premier boss tué en vague 5.
// Coffre : 3 cartes face cachée dont une épique (garantie si une épique débloquée n'est pas possédée), 2 révélations
// max, la 3e se verrouille ; « Prendre » → reward:chosen.
import { expect, test } from '@playwright/test';
import { FUN_SHOTS, installBot, openGame, play, setSpeed, waitReady, type QaWindow } from './bots';

const SEED = 'qa-2';

test('coffre de boss : 2 cartes révélées, la 3e verrouillée, Prendre → reward:chosen', async ({ page }) => {
  test.setTimeout(150_000);
  // profil avec toutes les épiques débloquées : sur un profil vierge la seule épique (safetynet) est souvent
  // prise avant le premier boss (qa-2 : possédée au coffre), et la garantie ne peut alors pas s'appliquer
  await page.goto('/?fresh=1&qa=1');
  await waitReady(page);
  await page.evaluate((k) => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    const d = JSON.parse(JSON.stringify(api.meta.data)) as { meta: { unlockedRelics: string[] }; currentRun: unknown };
    const epics = api.sim.config.relics.defs.filter((x) => x.rarity === 'epic').map((x) => x.id);
    d.meta.unlockedRelics = [...new Set([...api.meta.getModifiers().unlockedRelics, ...epics])];
    d.currentRun = null;
    localStorage.setItem(k, JSON.stringify(d));
  }, 'pegbreaker.save.v1');
  const { consoleErrors } = await openGame(page, SEED);
  await page.evaluate(() => {
    const w = window as unknown as QaWindow & { __offers: { source: string; n: number }[]; __chosen: unknown[] };
    w.__offers = [];
    w.__chosen = [];
    w.__pegbreaker.bus.onAny((e) => {
      if (e.type === 'reward:offered') w.__offers.push({ source: e.source, n: e.options.length });
      if (e.type === 'reward:chosen') w.__chosen.push(e.option);
    });
  });
  await installBot(page, { bot: 'greedy', seed: SEED, onLost: 'reviveIfAffordable' });
  await setSpeed(page, 8);
  const r = await play(page, { stopOnBossReward: true, maxRealMs: 120_000 });
  expect(r.stopReason, `coffre atteint (vague ${r.state.wave}, profondeur ${r.state.depth})`).toBe('boss-reward');
  await setSpeed(page, 1);

  const screen = page.locator('.screen-reward');
  await expect(screen).toHaveClass(/visible/);
  await expect(screen).toHaveAttribute('data-source', 'boss');
  const cards = page.locator('.chest-card');
  const n = await cards.count();
  expect(n, 'cartes du coffre').toBe(3);
  await expect(page.locator('.chest-card[data-revealed]')).toHaveCount(0);
  await expect(page.locator('[data-action="skip-reward"]')).toBeHidden();
  const offer = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as QaWindow).__pegbreaker.sim.state.rewardOffer)) as unknown[]);
  const offers = await page.evaluate(() => (window as unknown as QaWindow & { __offers: { source: string; n: number }[] }).__offers.slice());
  expect(offers[offers.length - 1]?.source, 'reward:offered.source').toBe('boss');
  // épique garantie si une épique débloquée (et compatible) n'est pas encore possédée (aa89b87)
  const epic = await page.evaluate(() => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    const s = api.sim.state;
    const defs = api.sim.config.relics.defs;
    const unlocked = api.meta.getModifiers().unlockedRelics;
    const els = new Set(s.volley.map((v) => v.element));
    const eligible = defs
      .filter((d) => d.rarity === 'epic' && (unlocked.length === 0 || unlocked.includes(d.id)) && !s.relics.includes(d.id) && (!d.requiresElement || els.has(d.requiresElement)))
      .map((d) => d.id);
    const rar = (s.rewardOffer ?? []).map((o) => (o.kind === 'relic' ? `${o.relicId}:${defs.find((d) => d.id === o.relicId)?.rarity ?? '?'}` : o.kind));
    return { eligible, offer: rar, owned: s.relics.slice(), unlocked };
  });
  test.info().annotations.push({ type: 'coffre épique', description: JSON.stringify(epic) });
  expect(epic.eligible.length, 'au moins une épique débloquée non possédée').toBeGreaterThan(0);
  expect(epic.offer.filter((x) => x.endsWith(':epic')).length, 'une carte épique dans le coffre').toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${FUN_SHOTS}/09-coffre-ferme.png` });

  const reveal = page.locator('[data-action="reveal"]');
  await reveal.nth(0).click();
  await expect(cards.nth(0)).toHaveAttribute('data-revealed', 'true');
  await expect(page.locator('[data-action="take"]').nth(0)).toBeVisible();
  await reveal.nth(1).click();
  await expect(cards.nth(1)).toHaveAttribute('data-revealed', 'true');
  // 2 révélations atteintes : la 3e carte est verrouillée et ne se retourne plus
  await expect(cards.nth(2)).toHaveAttribute('data-locked', 'true');
  await expect(reveal.nth(2)).toBeDisabled();
  await reveal.nth(2).click({ force: true });
  await expect(cards.nth(2)).not.toHaveAttribute('data-revealed', 'true');
  await expect(page.locator('[data-action="take"]').nth(2)).toBeHidden();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${FUN_SHOTS}/10-coffre-revele.png` });

  const chosenBefore = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.eventCounts['reward:chosen'] ?? 0);
  await page.locator('[data-action="take"]').nth(1).click();
  await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase !== 'reward');
  await expect.poll(() => page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.eventCounts['reward:chosen'] ?? 0)).toBe(chosenBefore + 1);
  const chosen = await page.evaluate(() => {
    const c = (window as unknown as QaWindow & { __chosen: unknown[] }).__chosen;
    return JSON.parse(JSON.stringify(c[c.length - 1])) as unknown;
  });
  test.info().annotations.push({ type: 'coffre', description: JSON.stringify({ wave: r.state.wave, depth: r.state.depth, offer, chosen }) });
  expect(chosen, 'option prise = carte 2 du coffre').toEqual(offer[1]);
  await expect(screen).not.toHaveClass(/visible/);
  const rs = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.rewardSource ?? null);
  expect(rs, 'rewardSource effacé après le choix').toBeNull();
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
