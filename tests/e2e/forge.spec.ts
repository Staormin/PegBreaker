// tests/e2e/forge.spec.ts — propriétaire : qa-tester. Vente, forge, hybrides, Divine, catalyseur, codex (docs/HYBRIDS.md).
//
// Protocole commun (`reachShop`) : run de défi `?seed=<seed>&goal=0` (pool standard : 27 balles, run CRÉDITÉE donc codex et
// succès écrits ; jamais `qa=1`, qui coupe l'inscription au codex), bot greedy vitesse 8 jusqu'à l'écran de récompense de
// la vague 3 (shopEvery = 3), puis, via l'API de debug : `state.volley` et `state.coins` forcés, offre remplacée par
// « 0 pièce », `sim.chooseReward(0)` → la boutique s'ouvre avec la volée préparée (catalyseur et forge calculés dessus).
// Toutes les actions de boutique passent ensuite par le DOM (clics réels).
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { BallElement, BallTier, GameEvent, RunSummary, VolleyBall } from '../../src/core/types';
import { installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

const SHOTS = 'docs/qa/forge-shots';
const DATA = 'docs/qa/forge-data';

type Rec = {
  ev: { type: string; [k: string]: unknown }[];
  explodeDivine: number;
  chainDivine: number;
  shotDamage: number[];
  maxHit: number;
  hitsByEl: Record<string, number>;
  summary: RunSummary | null;
  achievements: string[];
};
type FW = QaWindow & { __fr: Rec };

const vb = (element: BallElement, tier: BallTier, n = 1): VolleyBall[] => Array.from({ length: n }, () => ({ element, tier }));

async function installRec(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as FW;
    const api = w.__pegbreaker;
    const r: Rec = { ev: [], explodeDivine: 0, chainDivine: 0, shotDamage: [], maxHit: 0, hitsByEl: {}, summary: null, achievements: [] };
    w.__fr = r;
    const KEEP = ['shop:', 'achievement:', 'run:over', 'run:lost'];
    api.bus.onAny((e: GameEvent) => {
      if (KEEP.some((k) => e.type.startsWith(k))) r.ev.push(JSON.parse(JSON.stringify(e)) as Rec['ev'][number]);
      if (e.type === 'block:explode' && e.element === 'divine') r.explodeDivine++;
      if (e.type === 'lightning:chain' && e.element === 'divine') r.chainDivine++;
      if (e.type === 'volley:end') r.shotDamage.push(e.shotDamage);
      if (e.type === 'block:hit') {
        r.hitsByEl[e.element] = (r.hitsByEl[e.element] ?? 0) + 1;
        if (e.damage > r.maxHit) r.maxHit = e.damage;
      }
      if (e.type === 'run:over') r.summary = JSON.parse(JSON.stringify(e.summary)) as RunSummary;
      if (e.type === 'achievement:unlocked') r.achievements.push(e.achievementId);
    });
  });
}

/** remet à zéro les compteurs de tir (avant les tirs mesurés) */
const resetShots = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const r = (window as unknown as FW).__fr;
    r.shotDamage = [];
    r.maxHit = 0;
    r.hitsByEl = {};
    r.explodeDivine = 0;
    r.chainDivine = 0;
  });
const rec = (page: Page): Promise<Rec> => page.evaluate(() => (window as unknown as FW).__fr);
const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
    return { phase: s.phase, wave: s.wave, coins: s.coins, hp: s.hp, volley: s.volley.map((b) => ({ ...b })) };
  });
const codex = (page: Page): Promise<BallElement[]> => page.evaluate(() => [...((window as unknown as QaWindow).__pegbreaker.meta.data.codex ?? [])]);
const names = (page: Page): Promise<Record<string, string>> =>
  page.evaluate(() => Object.fromEntries((window as unknown as QaWindow).__pegbreaker.sim.config.balls.defs.map((d) => [d.id, d.name])));

/** Joue jusqu'à la récompense de la vague 3, prépare volée + pièces, ouvre la boutique. */
async function reachShop(page: Page, seed: string, volley: VolleyBall[], coins: number): Promise<void> {
  await page.goto(`/?seed=${seed}&goal=0`);
  await waitReady(page);
  await installRec(page);
  await installBot(page, { bot: 'greedy', seed, onLost: 'none' });
  await setSpeed(page, 8);
  for (let i = 0; i < 12; i++) {
    await play(page, { stopOnPhases: ['reward', 'shop', 'gameover'], maxRealMs: 60_000 });
    const st = await state(page);
    expect(st.phase, `${seed} : mort avant la vague 3`).not.toBe('gameover');
    if (st.phase === 'reward' && st.wave >= 3) break;
    await page.evaluate(() => {
      const sim = (window as unknown as QaWindow).__pegbreaker.sim;
      if (sim.state.phase === 'reward') sim.chooseReward(0);
      else if (sim.state.phase === 'shop') sim.leaveShop();
    });
  }
  const st = await state(page);
  expect(st.wave, 'récompense de la vague 3 atteinte').toBe(3);
  await setSpeed(page, 1);
  await page.evaluate(
    ({ volley, coins }) => {
      const api = (window as unknown as QaWindow).__pegbreaker;
      const s = api.sim.state as unknown as { volley: VolleyBall[]; coins: number; rewardOffer: unknown[] };
      s.volley.length = 0;
      for (const b of volley) s.volley.push({ ...b });
      s.coins = coins;
      s.rewardOffer = [{ kind: 'coins', amount: 0 }];
      api.sim.chooseReward(0);
    },
    { volley, coins },
  );
  await expect(page.locator('#ui[data-screen="shop"]')).toBeVisible();
  await expect(page.locator('.screen-shop .volley-chip')).toHaveCount(volley.length);
}

/** Tire n fois (visée : bloc cassable le plus bas, ouverture 0) ; récompenses passées, boutiques quittées. */
async function shoot(page: Page, n: number): Promise<number> {
  return page.evaluate(
    (n) =>
      new Promise<number>((res) => {
        const api = (window as unknown as QaWindow).__pegbreaker;
        let k = 0;
        const t0 = performance.now();
        const loop = (): void => {
          const s = api.sim.state;
          if (performance.now() - t0 > 90_000 || s.phase === 'gameover') return res(k);
          if (s.phase === 'aiming') {
            if (k >= n) return res(k);
            let best: { col: number; row: number; width: number } | null = null;
            for (const b of s.blocks) if (b.kind !== 'peg' && (!best || b.row > best.row || (b.row === best.row && b.col < best.col))) best = b;
            const tx = best ? best.col + best.width / 2 : s.launchPos.x + 0.5;
            const ty = best ? best.row + 0.5 : 1;
            let dx = tx - s.launchPos.x;
            let dy = Math.min(-0.3, ty - s.launchPos.y);
            const l = Math.hypot(dx, dy);
            dx /= l;
            dy /= l;
            api.sim.aim({ x: dx, y: dy }, 0);
            api.sim.fire();
            if (api.sim.state.phase === 'firing') k++;
          } else if (s.phase === 'reward') api.sim.skipReward();
          else if (s.phase === 'shop') api.sim.leaveShop();
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }),
    n,
  );
}

const chip = (page: Page, el: BallElement, tier: BallTier) => page.locator(`.screen-shop .volley-chip[data-element="${el}"][data-tier="${tier}"]`).first();

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(DATA, { recursive: true });
});

// ---------------------------------------------------------------------------------------------------------------------
test('(a) vente : prix par rang, hybride, dernière balle invendable', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await reachShop(page, 'forge-sell', [...vb('fire', 3), ...vb('ice', 2), ...vb('steam', 2), ...vb('stone', 1)], 0);
  const eco = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.config.economy.sell);
  const steps: [BallElement, BallTier, number][] = [
    ['fire', 3, eco.byTier[2]],
    ['steam', 2, eco.hybridByTier[1]],
    ['ice', 2, eco.byTier[1]],
  ];
  let coins = 0;
  for (const [el, tier, price] of steps) {
    const btn = chip(page, el, tier).locator('[data-action="sell"]');
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText(`+${price}`);
    await btn.click();
    coins += price;
    await expect(page.locator(`.screen-shop .volley-chip[data-element="${el}"]`)).toHaveCount(0);
    expect((await state(page)).coins, `vente ${el} ${tier} : +${price}`).toBe(coins);
  }
  const last = page.locator('.screen-shop [data-action="sell"]');
  await expect(last).toHaveCount(1);
  await expect(last, 'dernière balle invendable').toBeDisabled();
  const refused = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.sell(0));
  expect(refused, 'sim.sell sur la dernière balle → 0').toBe(0);
  const st = await state(page);
  expect(st.volley).toEqual([{ element: 'stone', tier: 1 }]);
  expect(st.coins).toBe(coins);
  const sold = (await rec(page)).ev.filter((e) => e.type === 'shop:sold');
  expect(sold.map((e) => [e['element'], e['tier'], e['coins']])).toEqual(steps.map(([a, b, c]) => [a, b, c]));
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
test('(b) forge d\'une hybride (II + I) : volée, shop:forged, toasts, codex immédiat, succès hybrid1 en fin de run', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await reachShop(page, 'forge-hybrid', [...vb('fire', 2), ...vb('ice', 1), ...vb('stone', 1, 3)], 100);
  const cost = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.config.economy.forge.hybridCost);
  const opts = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.forgeOptions());
  expect(opts.map((o) => o.result), 'forgeOptions : Feu II + Glace I → Vapeur').toEqual(['steam']);
  const card = page.locator('.forge-option[data-action="forge"][data-result="steam"]');
  await expect(card).toHaveCount(1);
  await expect(card).toBeEnabled();
  await expect(card).toHaveAttribute('data-cost', String(cost));
  expect(await codex(page), 'codex vide avant la forge').toEqual([]);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/01-boutique-forge.png`, fullPage: true });
  await card.click();
  await expect(page.locator('.toast-forge'), 'toast de forge').toBeVisible({ timeout: 3000 });
  await expect(page.locator('.toast-codex'), 'toast de codex').toBeVisible({ timeout: 3000 });
  await expect(chip(page, 'steam', 1)).toBeVisible();
  const st = await state(page);
  expect(st.volley.filter((b) => b.element === 'steam'), 'hybride rang I dans la volée').toEqual([{ element: 'steam', tier: 1 }]);
  expect(st.volley.some((b) => b.element === 'fire' || b.element === 'ice'), 'parents consommés').toBe(false);
  expect(st.volley).toHaveLength(4);
  expect(st.coins).toBe(100 - cost);
  const forged = (await rec(page)).ev.filter((e) => e.type === 'shop:forged');
  expect(forged).toHaveLength(1);
  expect(forged[0]?.['result']).toBe('steam');
  expect(forged[0]?.['cost']).toBe(cost);
  expect([...((forged[0]?.['parents'] as string[]) ?? [])].sort()).toEqual(['fire', 'ice']);
  expect(await codex(page), 'codex inscrit immédiatement (pas seulement en fin de run)').toEqual(['steam']);
  const achBefore = await page.evaluate(() => [...(window as unknown as QaWindow).__pegbreaker.meta.data.achievements]);
  await page.screenshot({ path: `${SHOTS}/02-forge-toast.png` });

  // fin de run : PV à 1, bot greedy → mort → abandon → run:over → succès
  await page.locator('.screen-shop [data-action="leave-shop"]').click();
  await page.evaluate(() => {
    (((window as unknown as QaWindow).__pegbreaker.sim.state as unknown) as { hp: number }).hp = 1;
  });
  await installBot(page, { bot: 'greedy', seed: 'forge-hybrid-end', onLost: 'giveUp' });
  await setSpeed(page, 8);
  const r = await play(page, { maxRealMs: 120_000 });
  expect(r.stopReason).toBe('gameover');
  await page.waitForFunction(() => (window as unknown as FW).__fr.summary !== null, null, { timeout: 10_000 });
  const fr = await rec(page);
  const achAfter = await page.evaluate(() => [...(window as unknown as QaWindow).__pegbreaker.meta.data.achievements]);
  test.info().annotations.push({ type: 'forge', description: JSON.stringify({ achBefore, achAfter, unlocked: fr.achievements, forged: fr.summary?.forged, statsForged: fr.summary?.stats.forged, wave: fr.summary?.wave }) });
  expect(fr.summary?.forged, 'RunSummary.forged').toEqual(['steam']);
  expect(fr.summary?.stats.forged, 'stats.forged').toBe(1);
  expect(achBefore, 'hybrid1 pas avant la fin de run').not.toContain('hybrid1');
  expect(achAfter, 'succès hybrid1 à la fin de run').toContain('hybrid1');
  expect(fr.achievements).toContain('hybrid1');
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
test('(c) upgrade d\'une hybride I → II → III via le DOM', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await reachShop(page, 'forge-upgrade', [...vb('laser', 1), ...vb('stone', 1, 2)], 500);
  const up = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.config.economy.forge.upgradeCost);
  const btn1 = chip(page, 'laser', 1).locator('[data-action="upgrade"]');
  await expect(btn1).toHaveAttribute('data-cost', String(up[0]));
  await expect(page.locator('.screen-shop .volley-chip[data-element="stone"] [data-action="upgrade"]'), 'pas d\'upgrade sur une balle de base').toHaveCount(0);
  await btn1.click();
  await expect(chip(page, 'laser', 2)).toBeVisible();
  expect((await state(page)).coins).toBe(500 - up[0]);
  const btn2 = chip(page, 'laser', 2).locator('[data-action="upgrade"]');
  await expect(btn2).toHaveAttribute('data-cost', String(up[1]));
  await btn2.click();
  await expect(chip(page, 'laser', 3)).toBeVisible();
  const st = await state(page);
  expect(st.coins).toBe(500 - up[0] - up[1]);
  expect(st.volley.filter((b) => b.element === 'laser')).toEqual([{ element: 'laser', tier: 3 }]);
  await expect(chip(page, 'laser', 3).locator('[data-action="upgrade"]'), 'plus d\'upgrade au rang III').toHaveCount(0);
  // les événements d'une action de boutique sont distribués au pas suivant de la boucle (une frame)
  await expect.poll(async () => (await rec(page)).ev.filter((e) => e.type === 'shop:upgraded').length).toBe(2);
  const ups = (await rec(page)).ev.filter((e) => e.type === 'shop:upgraded').map((e) => [e['element'], e['tier'], e['cost']]);
  expect(ups).toEqual([
    ['laser', 2, up[0]],
    ['laser', 3, up[1]],
  ]);
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
test('(d) Divine : deux hybrides III → carte .forge-divine → 3 tirs : nova et Jugement, dégâts > 5× la pierre', async ({ page, context }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  const SEED = 'forge-divine';
  const base = [...vb('steam', 3), ...vb('laser', 3), ...vb('stone', 1, 3)];
  await reachShop(page, SEED, base, 300);
  const cost = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.config.economy.forge.divineCost);
  const card = page.locator('.forge-option.forge-divine[data-action="forge"][data-result="divine"]');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-cost', String(cost));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/03-boutique-divine.png`, fullPage: true });
  await card.click();
  await expect(chip(page, 'divine', 1)).toBeVisible();
  const st = await state(page);
  expect(st.volley.filter((b) => b.element === 'divine')).toEqual([{ element: 'divine', tier: 1 }]);
  expect(st.volley.filter((b) => b.element === 'steam' || b.element === 'laser')).toEqual([]);
  expect(st.coins).toBe(300 - cost);
  await expect.poll(() => codex(page), 'Divine inscrite au codex (une frame)').toContain('divine');
  // deux Divines ne fusionnent pas / pas d'upgrade, pas de forge restante
  await expect(chip(page, 'divine', 1).locator('[data-action="upgrade"]')).toHaveCount(0);
  await expect(page.locator('.forge-option')).toHaveCount(0);
  const sig = async (p: Page): Promise<string> =>
    p.evaluate(() => JSON.stringify((window as unknown as QaWindow).__pegbreaker.sim.state.blocks.map((b) => [b.kind, b.col, b.row, Math.round(b.hp)])));
  await page.locator('.screen-shop [data-action="leave-shop"]').click();
  await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming');
  const sigDivine = await sig(page);
  await resetShots(page);
  // capture : Divine en vol (vitesse 0,3)
  await setSpeed(page, 0.3);
  const done = shoot(page, 3);
  await page.waitForFunction(
    () => (window as unknown as QaWindow).__pegbreaker.sim.state.balls.some((b) => b.alive && b.element === 'divine' && b.pos.y < 6.5),
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/04-divine-en-vol.png` });
  await setSpeed(page, 4);
  const nDiv = await done;
  const rd = await rec(page);

  // run pierre équivalente : même graine, même pilote, même volée préparée ; à la boutique, Divine remplacée par une pierre
  const p2 = await context.newPage();
  const errors2 = watchErrors(p2);
  await reachShop(p2, SEED, base, 300);
  await p2.evaluate(() => {
    const s = (window as unknown as QaWindow).__pegbreaker.sim.state as unknown as { volley: VolleyBall[]; coins: number };
    s.volley.length = 0;
    for (let i = 0; i < 4; i++) s.volley.push({ element: 'stone', tier: 1 });
    s.coins = 150;
  });
  await p2.locator('.screen-shop [data-action="leave-shop"]').click();
  await p2.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming');
  const sigStone = await sig(p2);
  await resetShots(p2);
  await setSpeed(p2, 4);
  const nStone = await shoot(p2, 3);
  const rs = await rec(p2);
  const maxD = Math.max(...rd.shotDamage);
  const maxS = Math.max(...rs.shotDamage);
  const out = {
    seed: SEED,
    sameBoard: sigDivine === sigStone,
    divine: { shots: nDiv, shotDamage: rd.shotDamage, maxShot: maxD, maxHit: rd.maxHit, explodeDivine: rd.explodeDivine, chainDivine: rd.chainDivine, hitsByEl: rd.hitsByEl },
    stone: { shots: nStone, shotDamage: rs.shotDamage, maxShot: maxS, maxHit: rs.maxHit },
    ratioMaxShot: Math.round((maxD / Math.max(1, maxS)) * 100) / 100,
  };
  writeFileSync(`${DATA}/divine.json`, JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'divine', description: JSON.stringify(out) });
  expect(out.sameBoard, 'même plateau au départ des deux runs (déterminisme)').toBe(true);
  expect(nDiv).toBe(3);
  expect(nStone).toBe(3);
  expect(rd.explodeDivine, "block:explode element 'divine' (nova)").toBeGreaterThan(0);
  expect(rd.chainDivine, "lightning:chain element 'divine' (Jugement)").toBeGreaterThan(0);
  expect(out.ratioMaxShot, 'dégâts max/tir > 5× la run pierre').toBeGreaterThan(5);
  for (const p of [page, p2]) expect(await p.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
  await p2.close();
});

// ---------------------------------------------------------------------------------------------------------------------
test('(e) catalyseur : un seul parent rang I → article partenaire rang II, achat → forge possible dans la même boutique', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await reachShop(page, 'forge-cata', [...vb('fire', 1), ...vb('stone', 1, 3)], 200);
  const n = await names(page);
  const cfg = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.config.economy);
  await expect(page.locator('.forge-option'), 'aucune forge avant le catalyseur').toHaveCount(0);
  await expect(page.locator('.screen-shop .forge-empty')).toBeVisible();
  const cat = page.locator('.shop-item[data-catalyst="true"]');
  await expect(cat).toHaveCount(1);
  const items = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.shop?.items.map((i) => ({ ...i })) ?? []);
  const ci = items.findIndex((i) => i.catalyst === true);
  expect(items.filter((i) => i.catalyst === true)).toHaveLength(1);
  expect(items[ci]?.option, 'partenaire manquant (Glace) au rang II').toEqual({ kind: 'ball', element: 'ice', tier: 2 });
  expect(items[ci]?.price).toBe(cfg.forge.catalystCost);
  expect(items, 'nombre d\'articles inchangé').toHaveLength(cfg.shop.itemCount);
  await expect(cat.locator('.catalyst-line')).toHaveText(`Partenaire de ${n['fire']} → ${n['steam']}`);
  await expect(cat).toHaveAttribute('data-shop-index', String(ci));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/05-catalyseur.png`, fullPage: true });
  await cat.click();
  await expect(chip(page, 'ice', 2)).toBeVisible();
  expect((await state(page)).coins).toBe(200 - cfg.forge.catalystCost);
  const card = page.locator('.forge-option[data-action="forge"][data-result="steam"]');
  await expect(card, 'forge possible dans la même boutique').toHaveCount(1);
  await card.click();
  await expect(chip(page, 'steam', 1)).toBeVisible();
  const st = await state(page);
  expect(st.coins).toBe(200 - cfg.forge.catalystCost - cfg.forge.hybridCost);
  expect(st.volley.filter((b) => b.element === 'steam')).toEqual([{ element: 'steam', tier: 1 }]);
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
test('(f) codex : 14 entrées « ? + ? », recette connue après la forge, compteur', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await reachShop(page, 'forge-codex', [...vb('crystal', 2), ...vb('nova', 1), ...vb('stone', 1, 2)], 100);
  const n = await names(page);
  const pane = page.locator('.screen-meta .pane-codex');
  const openCodex = async (): Promise<void> => {
    await page.locator('.screen-shop [data-action="open-codex"]').click();
    await expect(page.locator('#ui[data-screen="meta"]')).toBeVisible();
    const tab = page.locator('.screen-meta .tab', { hasText: 'Codex' });
    if (await tab.isVisible()) await tab.click();
    await expect(pane).toBeVisible();
  };
  const back = async (): Promise<void> => {
    await page.locator('.screen-meta button', { hasText: '← Retour' }).click();
    await expect(page.locator('#ui[data-screen="shop"]'), 'retour à la boutique').toBeVisible();
  };
  await openCodex();
  const entries = pane.locator('.codex-entry[data-element]');
  await expect(entries).toHaveCount(14);
  await expect(pane.locator('.codex-entry[data-known="false"]')).toHaveCount(14);
  await expect(pane.locator('.codex-count')).toContainText('0 / 14');
  const unknownTxt = await pane.locator('.codex-entry[data-known="false"] .codex-formula').allTextContents();
  expect(unknownTxt.every((t) => t.replace(/\s/g, '').startsWith('?+?')), `formules inconnues « ? + ? » (${unknownTxt[0]})`).toBe(true);
  expect(await pane.locator('.codex-entry[data-element="supernova"]').textContent(), 'nom caché').not.toContain(n['supernova']);
  await page.screenshot({ path: `${SHOTS}/06-codex-vide.png`, fullPage: true });
  await back();
  await page.locator('.forge-option[data-action="forge"][data-result="supernova"]').click();
  await expect(page.locator('.toast-codex')).toBeVisible({ timeout: 3000 });
  await openCodex();
  const known = pane.locator('.codex-entry[data-element="supernova"]');
  await expect(known).toHaveAttribute('data-known', 'true');
  await expect(known.locator('.codex-recipe')).toContainText(n['crystal'] as string);
  await expect(known.locator('.codex-recipe')).toContainText(n['nova'] as string);
  await expect(known).toContainText(n['supernova'] as string);
  await expect(pane.locator('.codex-entry[data-known="false"]')).toHaveCount(13);
  await expect(pane.locator('.codex-count')).toContainText('1 / 14');
  const help = (await pane.locator('.codex-help').textContent()) ?? '';
  test.info().annotations.push({ type: 'codex-help', description: help });
  await page.waitForTimeout(200);
  await known.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/07-codex-une-recette.png`, fullPage: true });
  await back();
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice())).toEqual([]);
  expect(errors).toEqual([]);
});
