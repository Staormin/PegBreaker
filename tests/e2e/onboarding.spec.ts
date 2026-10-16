// tests/e2e/onboarding.spec.ts — propriétaire : qa-tester. Premier lancement (localStorage vide).
// Logo + geste fantôme visibles, jeu jouable sans rien fermer, onboarded → true au premier tir,
// indices one-shot (récompense, combo, fusion) montrés une seule fois ; temps avant la première
// récompense avec un joueur « humain simulé » (2 s de lecture puis un drag de 600 ms par tir).
import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import type { Vec2 } from '../../src/core/types';
import { FINAL_SHOTS, boardToClient, installBot, lowestBlockTarget, play, setSpeed, watchErrors, type QaWindow } from './bots';

type HintWindow = QaWindow & { __hints: { reward: number; combo: number; fuse: number; fuseOffers: number; milestones: number; offers: number } };

/** Compte les apparitions des indices one-shot (MutationObserver) et les occasions de les montrer. */
function hintProbe(): void {
  const w = window as unknown as HintWindow;
  const h = { reward: 0, combo: 0, fuse: 0, fuseOffers: 0, milestones: 0, offers: 0 };
  w.__hints = h;
  const root = document.getElementById('ui') as HTMLElement;
  const had = new WeakMap<Element, Set<string>>();
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.classList.contains('hint-ping')) h.reward++;
        });
      } else if (m.type === 'attributes' && m.target instanceof HTMLElement) {
        const t = m.target;
        const prev = had.get(t) ?? new Set<string>();
        const cur = new Set(Array.from(t.classList));
        if (t.classList.contains('hud-combo-hint') && cur.has('on') && !prev.has('on')) h.combo++;
        if (cur.has('hint-pulse') && !prev.has('hint-pulse')) h.fuse++;
        had.set(t, cur);
      }
    }
  });
  mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  w.__pegbreaker.bus.onAny((e) => {
    if (e.type === 'combo:milestone') h.milestones++;
    if (e.type === 'reward:offered') {
      h.offers++;
      if (e.options.some((o) => o.kind === 'fuse')) h.fuseOffers++;
    }
    if (e.type === 'shop:opened' && e.shop.items.some((i) => i.option.kind === 'fuse')) h.fuseOffers++;
  });
}

/** drag « humain » : 600 ms de geste en 20 pas, du lanceur vers la cible */
async function humanDrag(page: Page, from: Vec2, to: Vec2, durationMs = 600): Promise<void> {
  const n = 20;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    await page.waitForTimeout(durationMs / n);
  }
  await page.mouse.up();
}

test('premier lancement : logo + fantôme, jouable sans rien fermer, 1re récompense < 10 s (humain simulé)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as QaWindow).__pegbreaker?.sim);
  const onboarded0 = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.meta.data.onboarded);
  expect(onboarded0, 'profil vierge').toBe(false);
  await expect(page.locator('.intro-logo')).toHaveClass(/\bon\b/);
  await expect(page.locator('.ghost')).toHaveClass(/\bon\b/, { timeout: 3000 });
  // aucun écran modal ne bloque : l'écran courant est le jeu ou le logo non bloquant
  const screen = await page.evaluate(() => document.getElementById('ui')?.dataset.screen);
  expect(['game', 'title']).toContain(screen);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${FINAL_SHOTS}/01-premier-lancement.png` });

  // joueur humain simulé : 2 s de lecture puis drag de 600 ms vers le bloc le plus bas, jusqu'à la 1re récompense
  const shots: number[] = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming', null, { timeout: 20_000 });
    if (await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.firstRewardAt !== null)) break;
    await page.waitForTimeout(i === 0 ? 2000 - 700 : 2000); // la 1re « lecture » inclut les 700 ms déjà écoulées
    const { target } = await lowestBlockTarget(page);
    const [tc, start] = (await boardToClient(page, [target, { x: 3.5, y: 8.5 }])) as [Vec2, Vec2];
    await humanDrag(page, start, tc);
    const ph = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase);
    expect(ph, `tir ${i + 1} : le drag tire sans fermer aucun écran`).toBe('firing');
    shots.push(Math.round(await page.evaluate(() => performance.now())));
    await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.firstRewardAt !== null || (window as unknown as QaWindow).__pegbreaker.sim.state.phase !== 'firing', null, { timeout: 15_000 });
  }
  const first = await page.evaluate(() => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    return { firstRewardAt: api.firstRewardAt, onboarded: api.meta.data.onboarded, ghost: document.querySelector('.ghost')?.classList.contains('on') ?? false };
  });
  const out = { firstRewardMs: first.firstRewardAt === null ? null : Math.round(first.firstRewardAt), shotsFiredAtMs: shots, shotsNeeded: shots.length };
  writeFileSync('docs/qa/final-onboarding.json', JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'onboarding', description: JSON.stringify(out) });
  expect(first.onboarded, 'onboarded → true après le premier tir').toBe(true);
  expect(first.ghost, 'le fantôme disparaît après le premier tir').toBe(false);
  expect(first.firstRewardAt, 'première récompense obtenue').not.toBeNull();
  expect(first.firstRewardAt!, 'première récompense < 10 s (humain simulé)').toBeLessThan(10_000);
  expect(errors).toEqual([]);
});

test('indices one-shot : récompense, combo, fusion — une seule fois chacun', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('/?fresh=1');
  await page.waitForFunction(() => !!(window as unknown as QaWindow).__pegbreaker?.sim);
  await page.evaluate(hintProbe);
  await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.restart('hints-1'));
  await installBot(page, { bot: 'greedy', seed: 'hints-1' });
  await setSpeed(page, 6);
  // jusqu'à au moins 3 offres (récompenses/boutique) ou la fin de la run
  for (let i = 0; i < 30; i++) {
    await play(page, { shots: 3, maxRealMs: 15_000 });
    const h = await page.evaluate(() => (window as unknown as HintWindow).__hints);
    const st = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase);
    if ((h.offers >= 3 && h.fuseOffers >= 2 && h.milestones >= 3) || st === 'gameover') break;
  }
  const h = await page.evaluate(() => (window as unknown as HintWindow).__hints);
  // rechargement : les indices sont mémorisés (localStorage 'pegbreaker.hints') et ne reviennent pas
  const stored = await page.evaluate(() => localStorage.getItem('pegbreaker.hints'));
  test.info().annotations.push({ type: 'hints', description: JSON.stringify({ ...h, stored }) });
  writeFileSync('docs/qa/final-hints.json', JSON.stringify({ ...h, stored }, null, 2) + '\n');
  expect(h.offers, 'au moins 2 écrans de récompense').toBeGreaterThanOrEqual(2);
  expect(h.reward, 'indice récompense montré une fois').toBe(1);
  expect(h.milestones, 'au moins 2 paliers de combo').toBeGreaterThanOrEqual(2);
  expect(h.combo, 'indice combo montré une fois').toBe(1);
  if (h.fuseOffers > 0) expect(h.fuse, `indice fusion une fois (${h.fuseOffers} offres de fusion)`).toBe(1);
  else expect(h.fuse).toBe(0);
  expect(errors).toEqual([]);
});
