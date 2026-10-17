// tests/e2e/landscape.spec.ts — propriétaire : qa-tester. Écran réel de l'utilisateur : portable 1920×1080 à l'échelle 1,6
// → viewport 1176×560 px CSS, deviceScaleFactor 1,6 (paysage, très peu de hauteur).
// 1. Partie : plateau entièrement visible, éléments du HUD sans chevauchement avec le plateau, un drag réel tire.
// 2. Boutique vague 3 avec 14 balles (6 groupes) : rien ne défile (page et colonnes), Reroll / Continuer visibles,
//    `.hud` en visibility:hidden et absent au point de test ; vente d'une balle d'un groupe puis « Vendre tout » (DOM).
// 3. Récompense (« Passer » visible), écran revanche puis fin de run tenant à l'écran.
// 4. Puits / codex : la page ne défile pas, seul un conteneur interne défile ; « ← Retour » visible.
// Captures : docs/qa/landscape-shots/.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type { BallElement, BallTier, Vec2, VolleyBall } from '../../src/core/types';
import { boardToClient, installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

const W = 1176;
const H = 560;
const SHOTS = 'docs/qa/landscape-shots';
test.use({ viewport: { width: W, height: H }, deviceScaleFactor: 1.6 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

type Box = { x: number; y: number; width: number; height: number };
const inViewport = (b: Box | null): boolean => !!b && b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= W + 0.5 && b.y + b.height <= H + 0.5;
const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

async function expectInViewport(loc: Locator, what: string): Promise<void> {
  await expect(loc, what).toBeVisible();
  const b = await loc.boundingBox();
  expect(inViewport(b), `${what} dans le viewport ${W}×${H} : ${JSON.stringify(b)}`).toBe(true);
}

/** la page elle-même ne défile pas (document ≤ viewport) */
async function pageFits(page: Page): Promise<{ sw: number; sh: number }> {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }));
}

/** plateau en px client : coins (0,0) et (cols, rows) */
async function boardBox(page: Page): Promise<Box> {
  const dims = await page.evaluate(() => {
    const b = (window as unknown as QaWindow).__pegbreaker.sim.config.blocks.board;
    return { cols: b.cols, rows: b.rows };
  });
  const [a, c] = (await boardToClient(page, [{ x: 0, y: 0 }, { x: dims.cols, y: dims.rows }])) as [Vec2, Vec2];
  return { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y };
}

const vb = (element: BallElement, tier: BallTier, n = 1): VolleyBall[] => Array.from({ length: n }, () => ({ element, tier }));

/** bot greedy jusqu'à la récompense de la vague `wave` (les précédentes : premier choix, boutiques quittées) */
async function reachReward(page: Page, seed: string, wave: number): Promise<void> {
  await installBot(page, { bot: 'greedy', seed, onLost: 'none' });
  await setSpeed(page, 8);
  for (let i = 0; i < 12; i++) {
    await play(page, { stopOnPhases: ['reward', 'shop', 'gameover'], maxRealMs: 60_000 });
    const st = await page.evaluate(() => {
      const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
      return { phase: s.phase, wave: s.wave };
    });
    expect(st.phase, `${seed} : mort avant la vague ${wave}`).not.toBe('gameover');
    if (st.phase === 'reward' && st.wave >= wave) break;
    await page.evaluate(() => {
      const sim = (window as unknown as QaWindow).__pegbreaker.sim;
      if (sim.state.phase === 'reward') sim.chooseReward(0);
      else if (sim.state.phase === 'shop') sim.leaveShop();
    });
  }
  await setSpeed(page, 1);
}

// ---------------------------------------------------------------------------------------------------------------------
test('paysage : plateau visible, HUD hors du plateau, un drag réel tire', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await page.goto('/?seed=land-play&qa=1');
  await waitReady(page);
  await page.waitForTimeout(300);
  const board = await boardBox(page);
  expect(inViewport(board), `plateau entièrement visible : ${JSON.stringify(board)}`).toBe(true);
  expect(board.height, 'plateau d\'au moins 400 px de haut').toBeGreaterThan(400);
  expect(await pageFits(page)).toEqual({ sw: W, sh: H });
  const { hudBoxes, hits } = await hudOverlap(page, board);
  test.info().annotations.push({ type: 'hud', description: JSON.stringify({ board, hud: hudBoxes.map((b) => [b.cls, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]), hits }) });
  await page.screenshot({ path: `${SHOTS}/01-partie.png` });
  // LS-01 (bandeau de contrat et sélecteur d'ouverture sur le plateau) : couvert par le test « LS-01 (corrigé) »
  expect(hits.filter((h) => !KNOWN_LS01.some((k) => h.cls.includes(k))), 'HUD sans chevauchement avec le plateau (hors LS-01)').toEqual([]);
  await playDrag(page);
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});

/** classes HUD connues pour chevaucher le plateau (bug LS-01) */
const KNOWN_LS01 = ['hud-band', 'hud-spread'];

/** boîtes des éléments du HUD visibles et leurs intersections (> 4 px²) avec le plateau ; l'aide d'onboarding (.ghost) est exclue */
async function hudOverlap(page: Page, board: Box): Promise<{ hudBoxes: (Box & { cls: string })[]; hits: { cls: string; area: number }[] }> {
  const hudBoxes = await page.evaluate(() => {
    const out: { cls: string; x: number; y: number; width: number; height: number }[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('.hud > *, .hud-top > *, .hud-right > *')) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (e.classList.contains('hud-top') || e.classList.contains('hud-right') || e.classList.contains('ghost')) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ cls: e.className, x: r.x, y: r.y, width: r.width, height: r.height });
    }
    return out;
  });
  const hits = hudBoxes.filter((b) => overlap(b, board) > 4).map((b) => ({ cls: b.cls, area: Math.round(overlap(b, board)) }));
  return { hudBoxes, hits };
}

/** drag réel : du lanceur vers le haut → volley:start */
async function playDrag(page: Page): Promise<void> {
  const lp = await page.evaluate(() => {
    const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
    return { x: s.launchPos.x, y: s.launchPos.y };
  });
  const [p0, p1] = (await boardToClient(page, [{ x: lp.x, y: lp.y - 0.5 }, { x: lp.x + 0.6, y: lp.y - 4 }])) as [Vec2, Vec2];
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => ((window as unknown as QaWindow).__pegbreaker.eventCounts['volley:start'] ?? 0) >= 1, null, { timeout: 3000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/02-tir.png` });
}

// LS-01 (corrigé) : en 1176×560, le bandeau de contrat (.hud-band) recouvre le haut de la rangée 0 et le sélecteur d'ouverture
// (.hud-spread) recouvre la zone de lancement (bas du plateau). `test.fail` : passera au rouge une fois corrigé.
test('LS-01 (corrigé) : aucun élément du HUD ne chevauche le plateau', async ({ page }) => {
  await page.goto('/?seed=land-play&qa=1');
  await waitReady(page);
  await page.waitForTimeout(300);
  const { hits } = await hudOverlap(page, await boardBox(page));
  test.info().annotations.push({ type: 'LS-01', description: JSON.stringify(hits) });
  expect(hits).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
test('paysage : récompense (« Passer » visible), boutique 14 balles sans défilement, vendre 1 / vendre tout, HUD masqué', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto('/?seed=land-shop&goal=0');
  await waitReady(page);
  await reachReward(page, 'land-shop', 3);
  // écran de récompense
  await expect(page.locator('#ui[data-screen="reward"]')).toBeVisible();
  await expectInViewport(page.locator('.screen-reward [data-action="skip-reward"]'), '« Passer »');
  expect(await pageFits(page)).toEqual({ sw: W, sh: H });
  await page.screenshot({ path: `${SHOTS}/03-recompense.png` });
  // 14 balles en 6 groupes, puis boutique
  const volley = [...vb('fire', 3), ...vb('ice', 2), ...vb('stone', 1, 6), ...vb('lightning', 1, 3), ...vb('steam', 1), ...vb('laser', 2, 2)];
  expect(volley).toHaveLength(14);
  await page.evaluate((volley) => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    const s = api.sim.state as unknown as { volley: VolleyBall[]; coins: number; rewardOffer: unknown[] };
    s.volley.length = 0;
    for (const b of volley) s.volley.push({ ...b });
    s.coins = 300;
    s.rewardOffer = [{ kind: 'coins', amount: 0 }];
    api.sim.chooseReward(0);
  }, volley);
  await expect(page.locator('#ui[data-screen="shop"]')).toBeVisible();
  await expect(page.locator('.screen-shop .volley-tile')).toHaveCount(6);
  await expect(page.locator('.screen-shop [title]'), 'aucune infobulle native (title)').toHaveCount(0);
  await page.waitForTimeout(300);
  // pas de défilement : page, écran et colonnes
  expect(await pageFits(page), 'la page ne défile pas').toEqual({ sw: W, sh: H });
  const scroll = await page.evaluate(() => {
    const q = (s: string): { sh: number; ch: number } | null => {
      const e = document.querySelector<HTMLElement>(s);
      return e ? { sh: e.scrollHeight, ch: e.clientHeight } : null;
    };
    return { screen: q('.screen-shop'), panel: q('.screen-shop .panel'), main: q('.screen-shop .shop-main'), left: q('.screen-shop .shop-col-left'), right: q('.screen-shop .shop-col-right'), grid: q('.screen-shop .volley-grid') };
  });
  test.info().annotations.push({ type: 'shop-scroll', description: JSON.stringify(scroll) });
  expect(scroll.left && scroll.right, 'deux colonnes (≥ 900 px)').toBeTruthy();
  for (const [k, v] of Object.entries(scroll)) if (v) expect(v.sh, `${k} : contenu ${v.sh} ≤ hauteur ${v.ch} (aucun défilement)`).toBeLessThanOrEqual(v.ch + 1);
  await expectInViewport(page.locator('.screen-shop [data-action="reroll"]'), 'Reroll');
  await expectInViewport(page.locator('.screen-shop [data-action="leave-shop"]'), 'Continuer');
  for (const g of await page.locator('.screen-shop .volley-tile').all()) await expectInViewport(g, 'tuile de la volée');
  await expectInViewport(page.locator('.screen-shop .volley-detail'), 'panneau détail');
  // HUD masqué derrière la boutique
  const hud = await page.evaluate(() => {
    const h = document.querySelector<HTMLElement>('.hud');
    const cs = h ? getComputedStyle(h) : null;
    const top = document.querySelector<HTMLElement>('.hud-top');
    const r = top?.getBoundingClientRect();
    const at = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
    return { visibility: cs?.visibility, hudAtPoint: !!at?.closest('.hud') };
  });
  expect(hud, '.hud invisible derrière la boutique').toEqual({ visibility: 'hidden', hudAtPoint: false });
  await page.screenshot({ path: `${SHOTS}/04-boutique-14-balles.png` });

  // vendre 1 pierre (groupe de 6 → 5), puis « Vendre tout » des pierres
  const coins = (): Promise<number> => page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.coins);
  const sellPrices = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.config.economy.sell.byTier);
  const stone = page.locator('.screen-shop .volley-tile[data-element="stone"][data-tier="1"]');
  const det = page.locator('.screen-shop .volley-detail');
  await expect(stone).toHaveAttribute('data-count', '6');
  const c0 = await coins();
  await stone.click();
  await expect(stone).toHaveAttribute('data-selected', 'true');
  await det.locator('[data-action="sell"]').click();
  await expect(stone).toHaveAttribute('data-count', '5');
  expect(await coins()).toBe(c0 + sellPrices[0]);
  await stone.click();
  const all = det.locator('[data-action="sell-all"][data-element="stone"][data-tier="1"]');
  await expectInViewport(all, '« Vendre tout » des pierres');
  await all.click();
  await expect(stone).toHaveCount(0);
  expect(await coins()).toBe(c0 + 6 * sellPrices[0]);
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.volley.length)).toBe(8);
  await page.screenshot({ path: `${SHOTS}/05-boutique-apres-vente.png` });
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Boutique refaite (docs/SHOP-UI.md) : 29 balles en 21 groupes (base, hybrides, Divine) à 1176×560.
test('paysage : boutique 29 balles — pas de défilement de page, rien sous le pied, tuiles ≥ 44 px, panneau visible', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto('/?seed=land-shop29&goal=0');
  await waitReady(page);
  await reachReward(page, 'land-shop29', 3);
  const groups: [BallElement, BallTier, number][] = [
    ['divine', 1, 1], ['steam', 3, 1], ['laser', 2, 1], ['wraith', 1, 1], ['fire', 3, 2], ['ice', 2, 2], ['stone', 1, 3], ['lightning', 1, 2],
    ['bomb', 2, 1], ['nova', 1, 2], ['crystal', 2, 1], ['gold', 1, 1], ['lucky', 3, 1], ['split', 1, 2], ['ghost', 2, 1], ['pierce', 1, 1],
    ['acid', 1, 1], ['void', 2, 1], ['twin', 1, 1], ['echo', 3, 1], ['magnet', 1, 2],
  ];
  const volley = groups.flatMap(([e, t, n]) => vb(e, t, n));
  expect(volley).toHaveLength(29);
  await page.evaluate((volley) => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    const s = api.sim.state as unknown as { volley: VolleyBall[]; coins: number; rewardOffer: unknown[] };
    s.volley.length = 0;
    for (const b of volley) s.volley.push({ ...b });
    s.coins = 254;
    s.rewardOffer = [{ kind: 'coins', amount: 0 }];
    api.sim.chooseReward(0);
  }, volley);
  await expect(page.locator('#ui[data-screen="shop"]')).toBeVisible();
  await expect(page.locator('.screen-shop .volley-tile')).toHaveCount(groups.length);
  await page.waitForTimeout(300);
  expect(await pageFits(page), 'aucun défilement de page').toEqual({ sw: W, sh: H });
  const m = await page.evaluate(() => {
    const r = (s: string): DOMRect | null => document.querySelector<HTMLElement>(s)?.getBoundingClientRect() ?? null;
    const footer = r('.screen-shop .screen-footer') ?? r('.screen-shop .actions');
    const boxes: Record<string, number> = {};
    for (const k of ['.shop-main', '.shop-col-left', '.shop-col-right', '.volley-grid', '.volley-detail', '.shop-buy', '.shop-forge']) {
      const b = r(`.screen-shop ${k}`);
      if (b && b.height > 0) boxes[k] = Math.round(b.bottom * 10) / 10;
    }
    const tiles = [...document.querySelectorAll<HTMLElement>('.screen-shop .volley-tile')].map((t) => t.getBoundingClientRect());
    const grid = document.querySelector<HTMLElement>('.screen-shop .volley-grid');
    return {
      footerTop: footer ? Math.round(footer.top * 10) / 10 : null,
      bottoms: boxes,
      tileMin: { w: Math.min(...tiles.map((t) => t.width)), h: Math.min(...tiles.map((t) => t.height)) },
      tilesVisible: tiles.filter((t) => grid && t.top >= grid.getBoundingClientRect().top - 0.5 && t.bottom <= grid.getBoundingClientRect().bottom + 0.5).length,
      gridScroll: grid ? { sh: grid.scrollHeight, ch: grid.clientHeight } : null,
    };
  });
  test.info().annotations.push({ type: 'shop-29', description: JSON.stringify(m) });
  await page.screenshot({ path: `${SHOTS}/10-boutique-29-balles.png` });
  expect(m.footerTop, 'pied présent').not.toBeNull();
  for (const [k, b] of Object.entries(m.bottoms)) expect(b, `${k} : bas ${b} ≤ haut du pied ${m.footerTop} (rien sous le pied)`).toBeLessThanOrEqual((m.footerTop ?? 0) + 0.5);
  expect(m.tileMin.w, 'tuiles ≥ 44 px de large').toBeGreaterThanOrEqual(44);
  expect(m.tileMin.h, 'tuiles ≥ 44 px de haut').toBeGreaterThanOrEqual(44);
  await expectInViewport(page.locator('.screen-shop .volley-detail'), 'panneau détail');
  await expectInViewport(page.locator('.screen-shop [data-action="reroll"]'), 'Reroll');
  await expectInViewport(page.locator('.screen-shop [data-action="leave-shop"]'), 'Continuer');
  // sélection d'une tuile : le panneau suit (Divine : pas d'upgrade, vente possible)
  const div = page.locator('.screen-shop .volley-tile[data-element="divine"]');
  await div.click();
  await expect(div).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('.screen-shop .volley-detail [data-action="sell"]')).toBeEnabled();
  await expect(page.locator('.screen-shop .volley-detail [data-action="upgrade"]')).toHaveCount(0);
  await expect(page.locator('.screen-shop [title]'), 'aucune infobulle native').toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
test('paysage : revanche tient à l\'écran, fin de run : « Rejouer » visible (titre coupé : LS-02)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto('/?seed=land-end&qa=1');
  await waitReady(page);
  await page.evaluate(() => {
    ((window as unknown as QaWindow).__pegbreaker.sim.state as unknown as { hp: number }).hp = 1;
  });
  await installBot(page, { bot: 'naive', seed: 'land-end', onLost: 'none' });
  await setSpeed(page, 8);
  const r = await play(page, { maxRealMs: 120_000 });
  expect(r.stopReason).toBe('gameover');
  await setSpeed(page, 1);
  await expect(page.locator('#ui[data-screen="revive"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
  expect(await pageFits(page)).toEqual({ sw: W, sh: H });
  await expectInViewport(page.locator('[data-action="revive"]'), 'Seconde chance');
  await expectInViewport(page.locator('[data-action="give-up"]'), 'Abandonner');
  await page.screenshot({ path: `${SHOTS}/06-revanche.png` });
  await page.locator('[data-action="give-up"]').click();
  await expect(page.locator('#ui[data-screen="gameover"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(600);
  expect(await pageFits(page)).toEqual({ sw: W, sh: H });
  await expectInViewport(page.locator('.screen-gameover [data-action="restart"]'), 'Rejouer');
  await page.screenshot({ path: `${SHOTS}/07-fin-de-run.png` });
  const panel = await page.locator('.screen-gameover .panel').boundingBox();
  test.info().annotations.push({ type: 'gameover-panel', description: JSON.stringify(panel) });
  // LS-02 (panneau de 651 px centré dans 560 px : titre hors écran, inatteignable) : couvert par le test « LS-02 (corrigé) »
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.hud') as HTMLElement).visibility)).toBe('hidden');
  await page.screenshot({ path: `${SHOTS}/07-fin-de-run.png` });
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
test('paysage : Puits et codex utilisables (défilement interne seulement)', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await page.goto('/?seed=land-well&qa=1');
  await waitReady(page);
  await page.locator('.hud-frags').click();
  await expect(page.locator('#ui[data-screen="meta"]')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await pageFits(page), 'la page ne défile pas').toEqual({ sw: W, sh: H });
  const back = page.locator('.screen-meta button', { hasText: '← Retour' });
  await expectInViewport(back, '« ← Retour »');
  await page.screenshot({ path: `${SHOTS}/08-puits.png` });
  const tab = page.locator('.screen-meta .tab', { hasText: 'Codex' });
  if (await tab.isVisible()) await tab.click();
  const pane = page.locator('.screen-meta .pane-codex');
  await expect(pane.locator('.codex-entry')).toHaveCount(14);
  // la dernière entrée est atteignable par défilement interne, la page ne bouge pas
  const last = pane.locator('.codex-entry').last();
  await last.scrollIntoViewIfNeeded();
  await expectInViewport(last, 'dernière entrée du codex après défilement');
  const sc = await page.evaluate(() => {
    let scrolled = 0;
    for (const e of document.querySelectorAll<HTMLElement>('.screen-meta, .screen-meta *')) if (e.scrollTop > 0) scrolled++;
    return { scrolled, docTop: document.scrollingElement?.scrollTop ?? 0, winY: window.scrollY };
  });
  expect(sc.docTop, 'document non défilé').toBe(0);
  expect(sc.winY).toBe(0);
  expect(sc.scrolled, 'un conteneur interne a défilé').toBeGreaterThan(0);
  await expectInViewport(back, '« ← Retour » après défilement');
  await page.screenshot({ path: `${SHOTS}/09-codex.png` });
  await back.click();
  await expect(page.locator('#ui[data-screen="game"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});

// LS-02 (corrigé) : fin de run en 1176×560 : le panneau fait 651 px dans un écran de 560 px centré (flex, align/justify center,
// overflow auto) → le titre « Fin de la descente » est à y = −45 px, hors de la zone défilable (débordement négatif
// perdu) ; « Le Puits » / « Défi du jour » finissent à 605 px. `test.fail` : passera au rouge une fois corrigé.
test('LS-02 (corrigé) : le panneau de fin de run est entièrement atteignable', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?seed=land-end&qa=1');
  await waitReady(page);
  await page.evaluate(() => {
    ((window as unknown as QaWindow).__pegbreaker.sim.state as unknown as { hp: number }).hp = 1;
  });
  await installBot(page, { bot: 'naive', seed: 'land-end', onLost: 'giveUp' });
  await setSpeed(page, 8);
  await play(page, { maxRealMs: 120_000 });
  await expect(page.locator('#ui[data-screen="gameover"]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(600);
  const top = await page.locator('.screen-gameover .panel').evaluate((e) => e.getBoundingClientRect().top);
  test.info().annotations.push({ type: 'LS-02', description: `panel.top = ${top}` });
  expect(top, 'haut du panneau atteignable (≥ 0)').toBeGreaterThanOrEqual(0);
});
