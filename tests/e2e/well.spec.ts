// tests/e2e/well.spec.ts — propriétaire : qa-tester. Le Puits après les 20 nouvelles balles (docs/BALLS.md).
// Forge (docs/HYBRIDS.md, 2026-10-17) : balls.json contient aussi 13 hybrides + la Divine (familles 'hybrid' / 'divine',
// jamais débloquables au Puits) ; l'Arsenal garde ses 26 nœuds de balles de base, le codex est un onglet à part
// (`.pane-codex`, couvert par forge.spec.ts). On compare donc l'Arsenal aux seules balles de base.
// 1. Profil vierge (`?fresh=1`), fragments crédités par localStorage, Puits ouvert via le HUD (.hud-frags) :
//    26 nœuds de balles (23 `data-unlock="fragments"` + 3 `data-unlock="achievement"` : nova, comète, chance),
//    filtre par famille (`.well-filter[data-family]`, aria-pressed, second appui = retrait), nœud de succès affiché.
// 2. Achat de l'Aimant (nœud sans prérequis) via le DOM → unlockedElements, fragments débités, nœud « Max ».
// 3. Run `?seed=well-magnet&qa=1` (pool du joueur, non créditée), bot greedy vitesse 8 : l'aimant apparaît dans
//    une offre (reward:offered) sur les 3 premières vagues, sinon dans la boutique / un drop / la volée (tolérant) ;
//    aucune balle verrouillée n'est proposée ; pastille HUD `data-family` + aria-label ; fin de run : `.end-volley > .ev-chip`.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type { BallElement, RewardOption } from '../../src/core/types';
import { installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

const SAVE_KEY = 'pegbreaker.save.v1';
const SHOTS_DIR = 'docs/qa/balls-shots';

async function screenIs(page: Page, screen: string): Promise<void> {
  await expect(page.locator(`#ui[data-screen="${screen}"]`)).toBeVisible();
}

type WellWindow = QaWindow & {
  __seen: { offers: string[][]; shop: string[][]; drops: string[]; volleyMax: number; offered: number };
};

test('Puits : 26 balles, filtre par famille, succès, achat → la balle entre dans le pool', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS_DIR, { recursive: true });
  const errors = watchErrors(page);
  await page.goto('/?fresh=1');
  await waitReady(page);
  // fragments crédités par localStorage (sauvegarde créée si absente)
  await page.evaluate((k) => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    if (!localStorage.getItem(k)) api.meta.save();
    const d = JSON.parse(localStorage.getItem(k) as string) as { meta: { fragments: number }; currentRun: unknown };
    d.meta.fragments = 500;
    d.currentRun = null;
    localStorage.setItem(k, JSON.stringify(d));
  }, SAVE_KEY);
  await page.goto('/?fresh=1');
  await waitReady(page);
  const before = await page.evaluate(() => {
    const m = (window as unknown as QaWindow).__pegbreaker.meta.data.meta;
    return { fragments: m.fragments, unlocked: [...m.unlockedElements] };
  });
  expect(before.fragments).toBe(500);
  expect(before.unlocked.sort(), 'profil vierge : 3 éléments').toEqual(['fire', 'lightning', 'stone']);

  await page.locator('.hud-frags').click();
  await screenIs(page, 'meta');
  const arsenal = page.locator('.screen-meta .pane-arsenal');
  const tab = page.locator('.screen-meta .tab', { hasText: 'Arsenal' });
  if (await tab.isVisible()) await tab.click();

  // --- 26 nœuds de balles --------------------------------------------------
  const ballNodes = arsenal.locator('.node[data-element]');
  await expect(ballNodes).toHaveCount(26);
  const cfg = await page.evaluate(() => {
    const c = (window as unknown as QaWindow).__pegbreaker.sim.config;
    return {
      // balles de base seulement : hybrides et Divine viennent de la forge (pas de nœud d'Arsenal)
      defs: c.balls.defs.filter((d) => d.family !== 'hybrid' && d.family !== 'divine').map((d) => ({ id: d.id, family: d.family, name: d.name })),
      forged: c.balls.defs.filter((d) => d.family === 'hybrid' || d.family === 'divine').length,
      achEls: c.meta.achievements.filter((a) => a.unlocksElement).map((a) => ({ id: a.id, el: a.unlocksElement as string, name: a.name })),
      magnetCost: c.meta.nodes.find((n) => n.id === 'el_magnet')?.costs[0] ?? -1,
    };
  });
  const nodeEls = (await ballNodes.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.element ?? ''))).sort();
  expect(nodeEls, 'une entrée par balle de base sauf la pierre').toEqual(cfg.defs.map((d) => d.id).filter((id) => id !== 'stone').sort());
  expect(cfg.forged, '13 hybrides + la Divine dans balls.json (hors Arsenal)').toBe(14);
  await expect(page.locator('.screen-meta .pane-codex .codex-entry'), 'codex : 14 entrées dans un onglet à part').toHaveCount(14);
  await expect(page.locator('.screen-meta .well-filter[data-family="hybrid"], .screen-meta .well-filter[data-family="divine"]'), 'pas de filtre hybride/divine dans l\'Arsenal').toHaveCount(0);
  await expect(arsenal.locator('.node[data-unlock="fragments"][data-element]')).toHaveCount(23);
  const achNodes = arsenal.locator('.node[data-unlock="achievement"][data-element]');
  await expect(achNodes).toHaveCount(3);
  for (const a of cfg.achEls) {
    const n = arsenal.locator(`.node[data-unlock="achievement"][data-element="${a.el}"]`);
    await expect(n, `nœud de succès ${a.el}`).toHaveAttribute('data-achievement', a.id);
    await expect(n).toContainText(`Succès : ${a.name}`);
    await expect(n.locator('[data-action="buy-node"]'), 'pas de bouton d\'achat').toHaveCount(0);
    expect(await n.getAttribute('aria-label')).toContain(a.name);
  }
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS_DIR}/well-arsenal.png`, fullPage: true });

  // --- filtre par famille -------------------------------------------------
  const families = ['elemental', 'heavy', 'tricky', 'swarm', 'greed', 'arcane'];
  const perFamily: Record<string, number> = {};
  for (const f of families) {
    const btn = page.locator(`.screen-meta .well-filter[data-family="${f}"]`);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    const vis = await arsenal.locator('.pane-body > *').evaluateAll((els) =>
      els.filter((e) => !(e as HTMLElement).hidden).map((e) => (e as HTMLElement).dataset.family ?? '(aucune)'),
    );
    perFamily[f] = vis.length;
    const expected = cfg.defs.filter((d) => d.family === f && d.id !== 'stone').length;
    expect(vis.every((x) => x === f), `filtre ${f} : seules les balles de la famille (${vis.join(',')})`).toBe(true);
    expect(vis.length, `filtre ${f} : ${expected} balles`).toBe(expected);
    if (f === 'greed') await page.screenshot({ path: `${SHOTS_DIR}/well-filtre-greed.png`, fullPage: true });
  }
  // second appui sur le filtre actif : retrait
  const last = page.locator(`.screen-meta .well-filter[data-family="arcane"]`);
  await last.click();
  await expect(last).toHaveAttribute('aria-pressed', 'false');
  const visAll = await arsenal.locator('.pane-body > .node[data-element]').evaluateAll((els) => els.filter((e) => !(e as HTMLElement).hidden).length);
  expect(visAll, 'filtre retiré : 26 balles visibles').toBe(26);
  test.info().annotations.push({ type: 'filtres', description: JSON.stringify(perFamily) });

  // --- achat de l'aimant via le DOM ------------------------------------------
  const magnetNode = arsenal.locator('.node[data-node-id="el_magnet"]');
  await expect(magnetNode).toHaveAttribute('data-unlock', 'fragments');
  const buy = magnetNode.locator('[data-action="buy-node"]');
  await expect(buy).toBeEnabled();
  await buy.click();
  await expect(arsenal.locator('.node[data-node-id="el_magnet"]')).toContainText('Max');
  const after = await page.evaluate(() => {
    const m = (window as unknown as QaWindow).__pegbreaker.meta;
    return { fragments: m.data.meta.fragments, unlocked: [...m.data.meta.unlockedElements], mods: m.getModifiers().unlockedElements };
  });
  expect(after.unlocked).toContain('magnet');
  expect(after.mods).toContain('magnet');
  expect(after.fragments, 'fragments débités du coût').toBe(500 - cfg.magnetCost);

  // --- run suivante (pool du joueur) : l'aimant est proposé --------------------
  await page.goto('/?seed=well-magnet&qa=1');
  await waitReady(page);
  await page.evaluate(() => {
    const w = window as unknown as WellWindow;
    const api = w.__pegbreaker;
    w.__seen = { offers: [], shop: [], drops: [], volleyMax: 0, offered: 0 };
    const key = (o: RewardOption): string => (o.kind === 'ball' || o.kind === 'fuse' ? `${o.kind}:${o.element}` : o.kind);
    api.bus.onAny((e) => {
      if (e.type === 'reward:offered') {
        w.__seen.offered++;
        w.__seen.offers.push(e.options.map(key));
      }
      if (e.type === 'shop:opened') w.__seen.shop.push(e.shop.items.map((i) => key(i.option)));
      if (e.type === 'drop:spawned' && e.kind === 'ball') {
        const d = api.sim.state.drops.find((x) => x.id === e.dropId);
        if (d?.element) w.__seen.drops.push(d.element);
      }
      let n = 0;
      for (const b of api.sim.state.volley) if (b.element === 'magnet') n++;
      if (n > w.__seen.volleyMax) w.__seen.volleyMax = n;
    });
  });
  await installBot(page, { bot: 'greedy', seed: 'well-magnet', onLost: 'giveUp' });
  await setSpeed(page, 8);
  const seen = async (): Promise<WellWindow['__seen']> => page.evaluate(() => (window as unknown as WellWindow).__seen);
  let s = await seen();
  let pillChecked = false;
  for (let i = 0; i < 40 && s.offered < 3; i++) {
    const r = await play(page, { shots: 1, maxRealMs: 30_000 });
    s = await seen();
    if (!pillChecked && (await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.volley.some((b) => b.element === 'magnet')))) {
      await page.waitForTimeout(150);
      const pill = page.locator('.pill[data-element="magnet"]').first();
      await expect(pill).toHaveAttribute('data-family', 'greed');
      expect(await pill.getAttribute('aria-label')).toContain('Aimant');
      pillChecked = true;
    }
    if (r.stopReason === 'gameover') break;
  }
  const inOffers = s.offers.slice(0, 3).some((o) => o.includes('ball:magnet') || o.includes('fuse:magnet'));
  const elsOffered = new Set<string>();
  for (const o of [...s.offers, ...s.shop]) for (const k of o) if (k.startsWith('ball:')) elsOffered.add(k.slice(5));
  for (const e of s.drops) elsOffered.add(e);
  const allowed = new Set<BallElement>(['stone', 'fire', 'lightning', 'magnet']);
  test.info().annotations.push({ type: 'pool', description: JSON.stringify({ inOffers, seen: s, elsOffered: [...elsOffered], pillChecked }) });
  expect(s.offered, '3 écrans de récompense').toBeGreaterThanOrEqual(3);
  expect([...elsOffered].filter((e) => !allowed.has(e as BallElement)), 'aucune balle verrouillée proposée (pool du joueur)').toEqual([]);
  expect(inOffers || s.shop.some((o) => o.includes('ball:magnet')) || s.drops.includes('magnet') || s.volleyMax > 0, "l'aimant apparaît (offre, boutique, drop ou volée)").toBe(true);

  // --- fin de run : volée finale en pastilles ---------------------------------
  const r = await play(page, { maxRealMs: 120_000 });
  expect(r.stopReason).toBe('gameover');
  await expect(page.locator('.screen-gameover')).toHaveClass(/visible/);
  const chips = page.locator('.end-volley > .ev-chip');
  const groups = await page.evaluate(() => {
    const v = (window as unknown as QaWindow).__pegbreaker.sim.state.volley;
    return new Set(v.map((b) => `${b.element}:${b.tier}`)).size;
  });
  await expect(chips).toHaveCount(groups);
  const chipData = await chips.evaluateAll((els) => els.map((e) => ({ el: (e as HTMLElement).dataset.element, fam: (e as HTMLElement).dataset.family, label: e.getAttribute('aria-label') })));
  expect(chipData.every((c) => !!c.el && !!c.fam && !!c.label)).toBe(true);
  await page.screenshot({ path: `${SHOTS_DIR}/well-fin-de-run-volee.png` });
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});
