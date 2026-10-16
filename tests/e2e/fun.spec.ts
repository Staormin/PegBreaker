// tests/e2e/fun.spec.ts — propriétaire : qa-tester. Mesure du lot 1 du plan fun (docs/FUN.md, section Mesure).
// 5 seeds bot naïf + 5 seeds bot « contrats » (qa-1…qa-5), profil vierge, seed forcée (run 1 : seconde chance gratuite).
//  - naïf : vise le bloc le plus bas ±10°, longueur de geste de débutant (40–320 px → éventail involontaire), abandonne à la mort ;
//  - contrats : naïf qui lit state.contract (mur + rafale pour combo/casse, blocs près des drops pour pièces/balles,
//    éventail à 1 si ≥ 4 blocs sur une rangée pour « nettoie en N tirs ») et prend la seconde chance si elle est payable.
// Comparaison au « avant » (docs/qa/final-metrics.json, build 7a33cab) → docs/qa/lot1-fun.json.
// Second test : captures (éventail, bandeau contrat, balle dorée, record) et vérification de l'input réel → spread.
// N'échoue que sur crash, softlock, erreur console ou incohérence de contrat (run:over ≠ 1), jamais sur une cible de fun.
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
const OUT = `${QA_OUT}-fun.json`;
const BEFORE = 'docs/qa/final-metrics.json';
const FATAL = ['page-error', 'softlock', 'sim-frozen'];
const SAVE_KEY = 'pegbreaker.save.v1';

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

function summarize(bot: BotKind, seed: string, r: QaReport, consoleErrors: string[], ttfrMs: number | null) {
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

async function runFast(page: Page, bot: BotKind, seed: string): Promise<Row> {
  const { consoleErrors } = await openGame(page, seed);
  await installBot(page, { bot, seed, spreadMode: 'drag', onLost: bot === 'contracts' ? 'reviveIfAffordable' : 'giveUp' });
  await setSpeed(page, 8);
  const r = await play(page, { maxRealMs: 170_000 });
  return summarize(bot, seed, r, consoleErrors, null);
}

test.describe.configure({ mode: 'serial' });

test('fun lot 1 : 5 seeds naïf + 5 seeds contrats, comparés au « avant »', async ({ context }) => {
  test.setTimeout(240_000);
  mkdirSync('docs/qa', { recursive: true });

  // A. naïf qa-1 à vitesse 1 avec 1,5 s de visée jusqu'à la première récompense, puis vitesse 8
  const pageA = await context.newPage();
  const sA = await openGame(pageA, 'qa-1');
  await installBot(pageA, { bot: 'naive', seed: 'qa-1', humanDelayMs: AIM_MS, spreadMode: 'drag', onLost: 'giveUp' });
  await setSpeed(pageA, 1);
  const rA0 = await play(pageA, { untilFirstReward: true, maxRealMs: 60_000 });
  const ttfr = rA0.firstRewardAt; // performance.now() : origine = navigation
  await configureBot(pageA, { humanDelayMs: 0 });
  await setSpeed(pageA, 8);
  const jobs: Promise<Row>[] = [play(pageA, { maxRealMs: 170_000 }).then((r) => summarize('naive', 'qa-1', r, sA.consoleErrors, ttfr))];
  // B. les 9 autres en parallèle
  for (const bot of ['naive', 'contracts'] as const)
    for (const seed of SEEDS) {
      if (bot === 'naive' && seed === 'qa-1') continue;
      jobs.push(context.newPage().then((p) => runFast(p, bot, seed)));
    }
  const rows = await Promise.all(jobs);
  const naive = rows.filter((r) => r.bot === 'naive').sort((a, b) => a.seed.localeCompare(b.seed));
  const contracts = rows.filter((r) => r.bot === 'contracts').sort((a, b) => a.seed.localeCompare(b.seed));

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
      comboGe5Greedy: b.greedy.average['comboShareGe5'],
      durationHumanMinNaive: r2((b.naive.average['durationHumanMs'] ?? 0) / 60000),
      durationHumanMinGreedy: r2((b.greedy.average['durationHumanMs'] ?? 0) / 60000),
      waveOfDeathNaive: b.naive.average['waveOfDeath'],
      waveOfDeathGreedy: b.greedy.average['waveOfDeath'],
      decisionsPerMinHumanNaive: b.naive.average['decisionsPerMinHuman'],
      timeToFirstRewardMsNaive: b.naive.runs[0]?.timeToFirstRewardMs ?? null,
      timeToFirstChoiceHumanMsNaive: b.naive.average['timeToFirstChoiceHumanMs'],
      deadMoments: b.naive.average['deadMoments'],
      contracts: null,
      revive: null,
    };
  }
  const out = {
    generatedAt: new Date().toISOString(),
    build: await pageA.evaluate(() => (window as unknown as QaWindow).__pegbreaker.version),
    method: {
      speed: 'naïf qa-1 : vitesse 1 et 1,5 s de visée jusqu\'à firstRewardAt, puis vitesse 8 ; autres : vitesse 8 en parallèle',
      spread: 'longueur de geste uniforme 40–320 px CSS → spread = clamp((len − 90) / 220) (ui/input.ts) ; le bot contrats force 0 (mur) ou 1 (rangée ≥ 4)',
      decisionsPerShot: '(tirs + tirs à ouverture > 0) / tirs',
      durationHuman: 'durationMs − visée bot + 1,5 s × tirs',
      revive: 'contrats : clic DOM sur [data-action=revive] si gratuit (stats.runs = 0) ou ◆ suffisants ; naïf : sim.giveUp()',
    },
    before,
    naive: { runs: naive, average: aggregate(naive) },
    contracts: { runs: contracts, average: aggregate(contracts) },
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'fun', description: JSON.stringify({ naive: out.naive.average, contracts: out.contracts.average }) });

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
  await page.goto('/?seed=fun-shots');
  await waitReady(page);
  await page.waitForTimeout(300);
  const rec = page.locator('.hud-record');
  await expect(rec).toBeVisible();
  const recTxt = (await rec.textContent()) ?? '';
  expect(recTxt, 'record affiché dans le HUD').toContain('7');

  // F1 : la longueur du geste règle l'ouverture (input réel)
  const lp = await page.evaluate(() => {
    const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
    return { x: s.launchPos.x, y: s.launchPos.y };
  });
  const [start] = (await boardToClient(page, [{ x: lp.x, y: lp.y - 1 }])) as [Vec2];
  const spreadAfterDrag = async (len: number): Promise<number> => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y - len, { steps: 6 });
    const v = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.aimSpread);
    return v;
  };
  const s60 = await spreadAfterDrag(60);
  await page.mouse.move(start.x - 400, start.y + 400); // retour sous le lanceur : relâchement sans tir (dir.y ≥ 0)
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.cancelAim());
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase)).toBe('aiming');
  const s200 = await spreadAfterDrag(200);
  await page.mouse.move(start.x, start.y + 300);
  await page.mouse.up();
  await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.cancelAim());
  const s400 = await spreadAfterDrag(400);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${FUN_SHOTS}/01-eventail-ouvert.png` });
  test.info().annotations.push({ type: 'spread', description: JSON.stringify({ s60, s200, s400 }) });
  expect(s60, 'geste de 60 px : rafale serrée').toBe(0);
  expect(s200).toBeCloseTo((200 - 90) / 220, 1);
  expect(s400, 'geste de 400 px : éventail max').toBe(1);
  await page.mouse.up(); // tire l'éventail
  await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase === 'firing', null, { timeout: 3000 });
  await page.waitForFunction(() => ((window as unknown as QaWindow).__pegbreaker.eventCounts['volley:start'] ?? 0) === 1, null, { timeout: 3000 });

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
