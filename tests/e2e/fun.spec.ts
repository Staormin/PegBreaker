// tests/e2e/fun.spec.ts — propriétaire : qa-tester. Mesure des lots fun (docs/FUN.md, section Mesure).
// Passe finale (aa89b87+) : l'ouverture se choisit au sélecteur HUD `button.hud-spread[data-action=spread-cycle]`
// (0 / 0,5 / 1), jamais par le geste. 3 stratégies × 5 seeds (qa-1…qa-5), `?seed=…&qa=1`, profil vierge,
// seconde chance prise si payable (gratuite : stats.runs = 0) pour toutes :
//  - tight : rafale (niveau 0) ;  - conditional : « large » si ≥ 4 blocs sur une rangée, sinon « rafale » (clic sélecteur) ;
//  - fan : « large » systématique (clic sélecteur). Visée : bot naïf (bloc le plus bas ±10°).
// Comparaison au « avant » (final-metrics.json) et au lot 1 (lot1-fun.json) → docs/qa/fun-final.json.
// Second test : input réel (un drag de 400 px laisse aimSpread à 0 ; sélecteur → 0,5 → 1), captures.
// N'échoue que sur crash, softlock, erreur console ou incohérence (run:over ≠ 1), jamais sur une cible de fun.
import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Vec2 } from '../../src/core/types';
import {
  FUN_SHOTS,
  QA_OUT,
  boardToClient,
  configureBot,
  installBot,
  mean,
  openGame,
  play,
  setSpeed,
  waitReady,
  watchErrors,
  type BotKind,
  type QaReport,
  type QaWindow,
} from './bots';

const SEEDS = ['qa-1', 'qa-2', 'qa-3', 'qa-4', 'qa-5'];
const AIM_MS = 1500;
const OUT = `${QA_OUT}.json`;
const BEFORE = 'docs/qa/final-metrics.json';
/** référence « lot 1 » : rapport docs/qa/fun-lot1.md (commit 2e731ed) */
const LOT1 = 'docs/qa/lot1-fun.json';

/** groupes comparés : bot de visée + mode d'éventail */
type Group = 'tight' | 'conditional' | 'fan';
const GROUPS: Record<Group, { bot: BotKind; spreadMode: 'none' | 'max' | 'rowSelector'; label: string }> = {
  tight: { bot: 'naive', spreadMode: 'none', label: 'rafale systématique (spread 0)' },
  conditional: { bot: 'naive', spreadMode: 'rowSelector', label: 'conditionnel : « large » si ≥ 4 blocs sur une rangée, sinon « rafale »' },
  fan: { bot: 'naive', spreadMode: 'max', label: '« large » systématique (spread 1)' },
};
const FATAL = ['page-error', 'softlock', 'sim-frozen'];
const SAVE_KEY = 'pegbreaker.save.v1';

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

function summarize(bot: Group, seed: string, r: QaReport, consoleErrors: string[], ttfrMs: number | null) {
  const st = r.state.stats;
  const shots = Math.max(1, r.shots);
  const spreadShots = r.shotLog.filter((s) => s.spread > 0).length;
  const fullFan = r.shotLog.filter((s) => s.spread >= 0.99).length;
  const durationHumanMs = st.durationMs - r.aimingMs + AIM_MS * r.shots;
  const lost0 = r.lost[0];
  const revived = r.revives > 0;
  const decisions = r.shots + spreadShots + r.rewardChoices + r.buys + r.lost.length;
  const contractShots = r.shotLog.filter((s) => s.contract !== null);
  return {
    bot,
    seed,
    stopReason: r.stopReason,
    shots: r.shots,
    /** direction (1) + ouverture ≠ 0 (1) */
    decisionsPerShot: r2((r.shots + spreadShots) / shots),
    spreadShare: r2(spreadShots / shots),
    /** modèle B : part des tirs dont la distance lanceur → cible dépasse la zone morte (geste « du lanceur à la cible ») */
    involuntaryShareB: (() => {
      const xs = r.shotLog.filter((x) => x.targetPx > 0);
      return xs.length ? r2(xs.filter((x) => x.targetPx > 150).length / xs.length) : null;
    })(),
    meanTargetPx: Math.round(mean(r.shotLog.filter((x) => x.targetPx > 0).map((x) => x.targetPx)) || 0),
    bestShotDamageRun: r.state.stats.bestShotDamage,
    fullFanShare: r2(fullFan / shots),
    meanSpread: r2(mean(r.shotLog.map((s) => s.spread)) || 0),
    decisionsPerMinHuman: r1(decisions / (durationHumanMs / 60000)),
    comboGe5: r2(r.shotLog.filter((s) => s.combo >= 5).length / shots),
    comboGe8: r2(r.shotLog.filter((s) => s.combo >= 8).length / shots),
    comboGe5UnderComboContract: (() => {
      const xs = r.shotLog.filter((s) => s.contract === 'reachCombo' || s.contract === 'destroyInOneShot');
      return xs.length ? r2(xs.filter((s) => s.combo >= 5).length / xs.length) : null;
    })(),
    contractShots: contractShots.length,
    contracts: r.contracts,
    durationHumanMs: Math.round(durationHumanMs),
    durationHumanMin: r2(durationHumanMs / 60000),
    durationSimMs: Math.round(st.durationMs),
    firstLossWave: lost0 ? lost0.wave : null,
    firstLossDepth: lost0 ? lost0.depth : null,
    waveOfDeath: r.state.wave,
    depth: r.state.depth,
    revived,
    wavesGainedByRevive: revived && lost0 ? r.state.wave - lost0.wave : null,
    depthGainedByRevive: revived && lost0 ? r.state.depth - lost0.depth : null,
    lost: r.lost,
    runOverCount: r.runOverCount,
    timeToFirstRewardMs: ttfrMs === null ? null : Math.round(ttfrMs),
    timeToFirstChoiceHumanMs: r.firstOffer ? r.firstOffer.simMs - r.firstOffer.aimingMs + AIM_MS * r.firstOffer.shots : null,
    firstOfferSource: r.firstOfferSource,
    rewardSources: r.rewardSources,
    golden: {
      ...r.golden,
      perShot: r2(r.golden.launches / shots),
      damageShare: r.hitDamage > 0 ? r2(r.golden.damage / r.hitDamage) : 0,
      shotsWithGoldenKill: r2(r.shotLog.filter((s) => s.goldenKills > 0).length / shots),
    },
    bestCombo: st.bestCombo,
    bestShotDamage: st.bestShotDamage,
    contractsCompletedStat: st.contractsCompleted,
    deadMoments: r.deadMoments,
    maxFeedbackGapMs: r.maxFeedbackGapMs,
    softlocks: r.softlocks,
    violations: r.violations,
    consoleErrors,
    pageErrors: r.pageErrors,
  };
}
type Row = ReturnType<typeof summarize>;

function avg(rows: Row[], f: (r: Row) => number | null): number | null {
  const xs = rows.map(f).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return xs.length ? r2(mean(xs)) : null;
}

function aggregate(rows: Row[]) {
  return {
    runs: rows.length,
    decisionsPerShot: avg(rows, (r) => r.decisionsPerShot),
    spreadShare: avg(rows, (r) => r.spreadShare),
    involuntaryShareB: avg(rows, (r) => r.involuntaryShareB),
    meanTargetPx: avg(rows, (r) => r.meanTargetPx),
    bestShotDamage: avg(rows, (r) => r.bestShotDamageRun),
    shots: avg(rows, (r) => r.shots),
    decisionsPerMinHuman: avg(rows, (r) => r.decisionsPerMinHuman),
    comboGe5: avg(rows, (r) => r.comboGe5),
    comboGe8: avg(rows, (r) => r.comboGe8),
    comboGe5UnderComboContract: avg(rows, (r) => r.comboGe5UnderComboContract),
    contractsOfferedPerRun: avg(rows, (r) => r.contracts.offered),
    contractsCompletedPerRun: avg(rows, (r) => r.contracts.completed),
    contractsFailedPerRun: avg(rows, (r) => r.contracts.failed),
    contractSuccessRate: (() => {
      const o = rows.reduce((a, r) => a + r.contracts.offered, 0);
      const c = rows.reduce((a, r) => a + r.contracts.completed, 0);
      return o ? r2(c / o) : null;
    })(),
    contractsByKind: (() => {
      const m: Record<string, { offered: number; completed: number; failed: number }> = {};
      for (const r of rows)
        for (const [k, v] of Object.entries(r.contracts.byKind)) {
          const b = (m[k] ??= { offered: 0, completed: 0, failed: 0 });
          b.offered += v.offered;
          b.completed += v.completed;
          b.failed += v.failed;
        }
      return m;
    })(),
    durationHumanMin: avg(rows, (r) => r.durationHumanMin),
    firstLossWave: avg(rows, (r) => r.firstLossWave),
    waveOfDeath: avg(rows, (r) => r.waveOfDeath),
    depth: avg(rows, (r) => r.depth),
    reviveShare: r2(rows.filter((r) => r.revived).length / Math.max(1, rows.length)),
    wavesGainedByRevive: avg(rows, (r) => r.wavesGainedByRevive),
    depthGainedByRevive: avg(rows, (r) => r.depthGainedByRevive),
    timeToFirstChoiceHumanMs: avg(rows, (r) => r.timeToFirstChoiceHumanMs),
    goldenPerShot: avg(rows, (r) => r.golden.perShot),
    goldenDamageShare: avg(rows, (r) => r.golden.damageShare),
    shotsWithGoldenKill: avg(rows, (r) => r.golden.shotsWithGoldenKill),
    deadMoments: rows.reduce((a, r) => a + r.deadMoments.length, 0),
    maxFeedbackGapMs: Math.max(...rows.map((r) => r.maxFeedbackGapMs)),
    errors: rows.reduce((a, r) => a + r.consoleErrors.length + r.pageErrors.length, 0),
  };
}

async function runFast(page: Page, group: Group, seed: string): Promise<Row> {
  const g = GROUPS[group];
  const { consoleErrors } = await openGame(page, seed);
  // même graine de bot que le lot 1 (hash « naive:<seed> » / « contracts:<seed> ») : seul le mode d'éventail change
  await installBot(page, { bot: g.bot, seed, spreadMode: g.spreadMode, onLost: 'reviveIfAffordable' });
  await setSpeed(page, 8);
  const r = await play(page, { maxRealMs: 170_000 });
  const row = summarize(group, seed, r, consoleErrors, null);
  await page.close();
  return row;
}

test.describe.configure({ mode: 'serial' });

test('fun final : rafale, conditionnel, large systématique (5 seeds chacun) contre avant et lot 1', async ({ context }) => {
  test.setTimeout(420_000);
  mkdirSync('docs/qa', { recursive: true });

  // A. naïf qa-1 à vitesse 1 avec 1,5 s de visée jusqu'à la première récompense, puis vitesse 8
  const pageA = await context.newPage();
  const sA = await openGame(pageA, 'qa-1');
  await installBot(pageA, { bot: 'naive', seed: 'qa-1', humanDelayMs: AIM_MS, spreadMode: 'none', onLost: 'reviveIfAffordable' });
  await setSpeed(pageA, 1);
  const rA0 = await play(pageA, { untilFirstReward: true, maxRealMs: 60_000 });
  const ttfr = rA0.firstRewardAt; // performance.now() : origine = navigation
  await configureBot(pageA, { humanDelayMs: 0 });
  await setSpeed(pageA, 8);
  const build = await pageA.evaluate(() => (window as unknown as QaWindow).__pegbreaker.version);
  const jobA = play(pageA, { maxRealMs: 200_000 }).then((r) => summarize('tight', 'qa-1', r, sA.consoleErrors, ttfr));

  // B. les 19 autres runs, par lots de 10 pages au plus (CPU partagé)
  const todo: [Group, string][] = [];
  for (const g of ['conditional', 'fan', 'tight'] as const)
    for (const seed of SEEDS) if (!(g === 'tight' && seed === 'qa-1')) todo.push([g, seed]);
  const rows: Row[] = [];
  const first = todo.splice(0, 9);
  rows.push(...(await Promise.all([jobA, ...first.map(([g, seed]) => context.newPage().then((p) => runFast(p, g, seed)))])));
  rows.push(...(await Promise.all(todo.map(([g, seed]) => context.newPage().then((p) => runFast(p, g, seed))))));
  const by = (g: Group): Row[] => rows.filter((r) => r.bot === g).sort((a, b) => a.seed.localeCompare(b.seed));

  // « avant » : build 7a33cab (docs/qa/final-metrics.json, même formule de durée joueur)
  let before: Record<string, unknown> | null = null;
  if (existsSync(BEFORE)) {
    const b = JSON.parse(readFileSync(BEFORE, 'utf8')) as {
      naive: { average: Record<string, number>; runs: { timeToFirstRewardMs: number | null }[] };
      greedy: { average: Record<string, number> };
    };
    before = {
      source: `${BEFORE} (build 7a33cab)`,
      decisionsPerShot: 1,
      comboGe5Naive: b.naive.average['comboShareGe5'],
      durationHumanMinNaive: r2((b.naive.average['durationHumanMs'] ?? 0) / 60000),
      waveOfDeathNaive: b.naive.average['waveOfDeath'],
      decisionsPerMinHumanNaive: b.naive.average['decisionsPerMinHuman'],
      timeToFirstRewardMsNaive: b.naive.runs[0]?.timeToFirstRewardMs ?? null,
      timeToFirstChoiceHumanMsNaive: b.naive.average['timeToFirstChoiceHumanMs'],
      deadMoments: b.naive.average['deadMoments'],
    };
  }
  let lot1: Record<string, unknown> | null = null;
  if (existsSync(LOT1)) {
    const l = JSON.parse(readFileSync(LOT1, 'utf8')) as { naive: { average: unknown; runs: { timeToFirstRewardMs: number | null }[] }; contracts: { average: unknown } };
    lot1 = { source: `${LOT1} (rapport fun-lot1.md)`, naive: l.naive.average, contracts: l.contracts.average, timeToFirstRewardMsNaive: l.naive.runs[0]?.timeToFirstRewardMs ?? null };
  }
  const groups = Object.fromEntries(
    (Object.keys(GROUPS) as Group[]).map((g) => [g, { label: GROUPS[g].label, runs: by(g), average: aggregate(by(g)) }]),
  );
  const out = {
    generatedAt: new Date().toISOString(),
    build,
    method: {
      speed: 'naïf qa-1 : vitesse 1 et 1,5 s de visée jusqu\'à firstRewardAt, puis vitesse 8 ; autres : vitesse 8, 10 pages en parallèle au plus',
      spread: 'sélecteur HUD (clic DOM) puis sim.aim(dir, 0 | 0,5 | 1) ; le geste ne règle plus l\'ouverture (0 % d\'ouvertures involontaires par construction, vérifié par le second test)',
      involuntary: '0 % par construction : le geste ne touche plus aimSpread (test « captures et input réel »)',
      decisionsPerShot: '(tirs + tirs à ouverture > 0) / tirs',
      durationHuman: 'durationMs − visée bot + 1,5 s × tirs',
      revive: 'conditionnel (contrats) : clic DOM sur [data-action=revive] si gratuit (stats.runs = 0, qa=1) ou ◆ suffisants ; autres : sim.giveUp()',
    },
    before,
    lot1,
    ...groups,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'fun', description: JSON.stringify(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.average]))) });

  for (const row of rows) {
    const tag = `${row.bot}/${row.seed}`;
    expect(row.pageErrors, `erreurs page ${tag}`).toEqual([]);
    expect(row.consoleErrors, `erreurs console ${tag}`).toEqual([]);
    expect(row.softlocks, `softlocks ${tag}`).toEqual([]);
    expect(FATAL, `arrêt fatal ${tag}`).not.toContain(row.stopReason);
    if (row.stopReason === 'gameover') expect(row.runOverCount, `run:over unique ${tag}`).toBe(1);
  }
});

test('captures et input réel : éventail, contrat, balle dorée, record', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(FUN_SHOTS, { recursive: true });
  const errors = watchErrors(page);
  // record de vague connu (F5) : sauvegarde avec bestWave = 7, puis seed forcée
  await page.goto('/?fresh=1');
  await waitReady(page);
  await page.evaluate((k) => {
    const d = JSON.parse(JSON.stringify((window as unknown as QaWindow).__pegbreaker.meta.data)) as { stats: { bestWave: number; runs: number }; currentRun: unknown };
    d.stats.bestWave = 7;
    d.stats.runs = Math.max(1, d.stats.runs);
    d.currentRun = null;
    localStorage.setItem(k, JSON.stringify(d));
  }, SAVE_KEY);
  await page.goto('/?seed=fun-shots&qa=1');
  await waitReady(page);
  await page.waitForTimeout(300);
  const rec = page.locator('.hud-record');
  await expect(rec).toBeVisible();
  const recTxt = (await rec.textContent()) ?? '';
  expect(recTxt, 'record affiché dans le HUD').toContain('7');

  // F1-02 : le geste ne règle plus l'ouverture (input réel) ; seul le sélecteur HUD la change
  const st = async (): Promise<{ spread: number; phase: string; volleys: number }> =>
    page.evaluate(() => {
      const p = (window as unknown as QaWindow).__pegbreaker;
      return { spread: p.sim.state.aimSpread, phase: p.sim.state.phase, volleys: p.eventCounts['volley:start'] ?? 0 };
    });
  const lp = await page.evaluate(() => {
    const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
    return { x: s.launchPos.x, y: s.launchPos.y };
  });
  const [start] = (await boardToClient(page, [{ x: lp.x, y: lp.y - 1 }])) as [Vec2];
  const spreadAfterDrag = async (len: number): Promise<number> => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + len * 0.2, start.y - len, { steps: 6 });
    return (await st()).spread;
  };
  const selector = page.locator('button.hud-spread[data-action="spread-cycle"]');
  await expect(selector).toHaveAttribute('data-level', '0');
  const s60 = await spreadAfterDrag(60);
  await page.mouse.move(start.x - 400, start.y + 400); // retour sous le lanceur : relâchement sans tir (dir.y ≥ 0)
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.cancelAim());
  const s200 = await spreadAfterDrag(200);
  await page.mouse.move(start.x, start.y + 300);
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.cancelAim());
  const s400 = await spreadAfterDrag(400);
  await page.mouse.up(); // tire, ouverture 0
  await page.waitForFunction(() => ((window as unknown as QaWindow).__pegbreaker.eventCounts['volley:start'] ?? 0) === 1, null, { timeout: 3000 });
  const afterFire = await st();
  test.info().annotations.push({ type: 'spread geste', description: JSON.stringify({ s60, s200, s400, afterFire }) });
  expect([s60, s200, s400, afterFire.spread], 'aucun geste n\'ouvre l\'éventail (0 % d\'involontaires)').toEqual([0, 0, 0, 0]);
  await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming', null, { timeout: 20_000 });
  // sélecteur : rafale → moyen → large, puis drag de 200 px : aimSpread = 1 ; persistant après le tir
  await selector.click();
  await expect(selector).toHaveAttribute('data-level', '1');
  const sMid = await spreadAfterDrag(200);
  await page.mouse.move(start.x, start.y + 300);
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.cancelAim());
  await selector.click();
  await expect(selector).toHaveAttribute('data-level', '2');
  const sLarge = await spreadAfterDrag(120);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${FUN_SHOTS}/01-eventail-ouvert.png` });
  await page.mouse.up();
  await page.waitForFunction(() => ((window as unknown as QaWindow).__pegbreaker.eventCounts['volley:start'] ?? 0) === 2, null, { timeout: 3000 });
  test.info().annotations.push({ type: 'spread sélecteur', description: JSON.stringify({ sMid, sLarge }) });
  expect(sMid).toBe(0.5);
  expect(sLarge).toBe(1);
  await expect(selector, 'niveau persistant après le tir').toHaveAttribute('data-level', '2');

  await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming', null, { timeout: 20_000 });

  // balle dorée (F3) en vol : sim ralentie, capture dès son lancement
  await page.evaluate(() => {
    const w = window as unknown as QaWindow & { __golden?: number };
    w.__golden = 0;
    w.__pegbreaker.bus.onAny((e) => {
      if (e.type === 'ball:launched' && e.golden) w.__golden = (w.__golden ?? 0) + 1;
    });
  });
  await setSpeed(page, 0.25);
  await page.evaluate(() => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    api.sim.aim({ x: 0.35, y: -1 }, 0.4);
    api.sim.fire();
  });
  await page.waitForFunction(() => ((window as unknown as QaWindow & { __golden?: number }).__golden ?? 0) > 0, null, { timeout: 15_000 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${FUN_SHOTS}/03-balle-doree.png` });
  const goldenInFlight = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.balls.filter((b) => b.alive && b.golden).length);
  expect(goldenInFlight, 'une balle dorée en vol').toBe(1);
  await setSpeed(page, 1);
  await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'aiming', null, { timeout: 60_000 });

  // bandeau contrat (F2) : première graine fun-c<i> dont la vague 1 tire un contrat (chance 0,85)
  const found = await page.evaluate(() => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    for (let i = 1; i <= 20; i++) {
      api.sim.restart(`fun-c${i}`);
      const c = api.sim.state.contract;
      if (c && c.status === 'active') return { seed: `fun-c${i}`, contract: { ...c } };
    }
    return null;
  });
  expect(found, 'un contrat tiré en vague 1 sur 20 graines').not.toBeNull();
  const banner = page.locator('.hud-contract');
  await expect(banner).toHaveAttribute('data-state', 'active');
  await expect(banner.locator('.hc-prog')).toHaveText(`${found!.contract.progress}/${found!.contract.target}`);
  test.info().annotations.push({ type: 'contrat', description: JSON.stringify({ ...found, text: await banner.locator('.hc-text').textContent() }) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${FUN_SHOTS}/02-bandeau-contrat.png` });
  const pageErrors = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.errors.slice());
  expect(pageErrors).toEqual([]);
  expect(errors).toEqual([]);
});
