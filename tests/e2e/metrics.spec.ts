// tests/e2e/metrics.spec.ts — propriétaire : qa-tester.
// 5 runs bot naïf + 5 runs bot greedy (seeds qa-1…qa-5) → docs/qa/j1-metrics.json.
// Ne JAMAIS échouer sur une cible de fun : seulement sur crash, softlock ou erreur console.
//
// Déroulé :
//  A. naïf qa-1 seul, vitesse 1, délais humains 1,5 s : temps avant première récompense + fps vitesse 1,
//     puis une volée sous CPU 4× (Emulation.setCPUThrottlingRate), puis vitesse 8 jusqu'à la mort.
//  B. les 9 autres runs en parallèle (une page chacune, vitesse 8, sans délai ; la durée « joueur »
//     ajoute 1,5 s de visée par tir).
//  C. perf : volée de 30 balles injectée dans l'état (debug), CPU 4×, fps pendant la volée.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { QA_OUT,
  SHOTS_DIR,
  FINAL_SHOTS,
  configureBot,
  installBot,
  mean,
  openGame,
  play,
  waitReady,
  watchErrors,
  quantile,
  setSpeed,
  type BotKind,
  type QaReport,
  type QaWindow,
} from './bots';

const OUT = `${QA_OUT}-metrics.json`;
const SHOTS = SHOTS_DIR;
const SEEDS = ['qa-1', 'qa-2', 'qa-3', 'qa-4', 'qa-5'];
const AIM_MS = 1500;
const FATAL_STOPS = ['page-error', 'softlock', 'sim-frozen'];

interface FpsStat {
  samples: number;
  min: number | null;
  avg: number | null;
  /** depuis les durées de frame rAF mesurées par le bot */
  frameMsP95: number | null;
  frameMsMax: number | null;
}

function fpsStat(r: QaReport, bucket: string): FpsStat {
  const xs = r.fps[bucket] ?? [];
  const fr = r.frames[bucket] ?? [];
  const round = (x: number): number => Math.round(x * 10) / 10;
  return {
    samples: xs.length,
    min: xs.length ? Math.min(...xs) : null,
    avg: xs.length ? round(mean(xs)) : null,
    frameMsP95: fr.length ? round(quantile(fr, 0.95)) : null,
    frameMsMax: fr.length ? round(Math.max(...fr)) : null,
  };
}

function summarize(bot: BotKind, seed: string, r: QaReport, consoleErrors: string[], realMs: number, ttfr: number | null) {
  const st = r.state.stats;
  const decisions = r.shots + r.rewardChoices + r.buys;
  const durationSpecMs = st.durationMs + AIM_MS * r.shots;
  // durée « joueur » : on retire la latence de visée du bot (et le délai déjà simulé de la run A) et on met 1,5 s par tir
  const durationHumanMs = st.durationMs - r.aimingMs + AIM_MS * r.shots;
  const combos = r.shotLog.map((s) => s.combo);
  const firstBreak = r.shotLog.findIndex((s) => s.destroyed > 0);
  const wavesStarted = Math.max(1, r.state.wave);
  const first = r.shotLog[0];
  return {
    bot,
    seed,
    stopReason: r.stopReason,
    timeToFirstRewardMs: ttfr === null ? null : Math.round(ttfr),
    /** 1er écran de choix : horloge réelle (run A seulement, vitesse 1 + délais humains) */
    timeToFirstChoiceRealMs: ttfr === null || !r.firstOffer ? null : r.firstOffer.perfNow,
    /** 1er écran de choix en temps « joueur » : simulé − visée bot + 1,5 s × tirs */
    timeToFirstChoiceHumanMs: r.firstOffer ? r.firstOffer.simMs - r.firstOffer.aimingMs + AIM_MS * r.firstOffer.shots : null,
    shotsInWave1: r.firstOffer ? r.firstOffer.shots : null,
    firstShot: first ? { damage: first.damage, destroyed: first.destroyed, combo: first.combo } : null,
    shotsUntilFirstBreak: firstBreak < 0 ? null : firstBreak + 1,
    shots: r.shots,
    rewardChoices: r.rewardChoices,
    buys: r.buys,
    decisions,
    decisionsPerMinSim: Math.round((decisions / (st.durationMs / 60000)) * 10) / 10,
    decisionsPerMinHuman: Math.round((decisions / (durationHumanMs / 60000)) * 10) / 10,
    durationSimMs: Math.round(st.durationMs),
    durationSpecMs: Math.round(durationSpecMs),
    durationHumanMs: Math.round(durationHumanMs),
    botAimingSimMs: r.aimingMs,
    choiceSimMs: r.choiceMs,
    waveOfDeath: r.state.wave,
    depth: r.state.depth,
    shotsPerWave: Math.round((r.shots / wavesStarted) * 10) / 10,
    bestCombo: st.bestCombo,
    bestShotDamage: Math.round(st.bestShotDamage),
    totalDamage: Math.round(st.totalDamage),
    blocksDestroyed: st.blocksDestroyed,
    finalVolley: r.state.volley,
    fusions: st.fusions,
    bossesKilled: st.bossesKilled,
    damageTaken: r.damageTaken,
    breaches: r.breaches,
    breachesByKind: r.breachesByKind,
    breachDamageByKind: r.breachDamageByKind,
    bossesSpawned: r.bossesSpawned,
    coinsEarned: st.coinsEarned,
    relics: r.state.relics,
    rewardsTaken: r.rewardsTaken,
    comboShare: {
      ge5: Math.round((combos.filter((c) => c >= 5).length / Math.max(1, combos.length)) * 100) / 100,
      ge10: Math.round((combos.filter((c) => c >= 10).length / Math.max(1, combos.length)) * 100) / 100,
      ge20: Math.round((combos.filter((c) => c >= 20).length / Math.max(1, combos.length)) * 100) / 100,
    },
    /** premier tir de la run où le combo dépasse 5 (null = jamais) */
    firstShotComboAbove5: (() => {
      const i = r.shotLog.findIndex((s) => s.combo > 5);
      return i < 0 ? null : i + 1;
    })(),
    damageByWave: (() => {
      const m: Record<number, number> = {};
      for (const s of r.shotLog) m[s.wave] = Math.max(m[s.wave] ?? 0, s.damage);
      return m;
    })(),
    deadMoments: r.deadMoments,
    maxFeedbackGapMs: r.maxFeedbackGapMs,
    maxFiringMs: r.maxFiringMs,
    avgFiringMs: Math.round(mean(r.shotLog.map((x) => x.firingMs))),
    /** volées terminées par le rappel automatique (maxVolleyMs = 9000) : balles coincées */
    cappedVolleys: r.shotLog.filter((x) => x.firingMs >= 8800).length,
    fps: {
      speed1: fpsStat(r, 'speed1'),
      cpu4Volley: fpsStat(r, 'cpu4'),
      speed8: fpsStat(r, 'speed8'),
    },
    consoleErrors,
    pageErrors: r.pageErrors,
    softlocks: r.softlocks,
    invariantViolations: r.violations,
    realSeconds: Math.round(realMs / 100) / 10,
  };
}

type RunRow = ReturnType<typeof summarize>;

function averages(rows: RunRow[]) {
  const avg = (f: (r: RunRow) => number | null): number | null => {
    const xs = rows.map(f).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    return xs.length ? Math.round(mean(xs) * 10) / 10 : null;
  };
  return {
    runs: rows.length,
    shots: avg((r) => r.shots),
    decisionsPerMinSim: avg((r) => r.decisionsPerMinSim),
    decisionsPerMinHuman: avg((r) => r.decisionsPerMinHuman),
    durationSpecMs: avg((r) => r.durationSpecMs),
    durationHumanMs: avg((r) => r.durationHumanMs),
    waveOfDeath: avg((r) => r.waveOfDeath),
    shotsPerWave: avg((r) => r.shotsPerWave),
    bestCombo: avg((r) => r.bestCombo),
    bestShotDamage: avg((r) => r.bestShotDamage),
    finalVolley: avg((r) => r.finalVolley),
    deadMoments: avg((r) => r.deadMoments.length),
    avgFiringMs: avg((r) => r.avgFiringMs),
    cappedVolleys: avg((r) => r.cappedVolleys),
    maxFeedbackGapMs: avg((r) => r.maxFeedbackGapMs),
    firstShotDestroyed: avg((r) => r.firstShot?.destroyed ?? null),
    timeToFirstChoiceHumanMs: avg((r) => r.timeToFirstChoiceHumanMs),
    shotsInWave1: avg((r) => r.shotsInWave1),
    bossesKilled: avg((r) => r.bossesKilled),
    bossesSpawned: avg((r) => r.bossesSpawned),
    damageTaken: avg((r) => r.damageTaken),
    comboShareGe5: avg((r) => r.comboShare.ge5),
    comboShareGe10: avg((r) => r.comboShare.ge10),
    fps8Min: avg((r) => r.fps.speed8.min),
    consoleErrors: rows.reduce((a, r) => a + r.consoleErrors.length + r.pageErrors.length, 0),
    waveOfDeathStdDev: (() => {
      const xs = rows.map((r) => r.waveOfDeath);
      const m = mean(xs);
      return Math.round(Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) * 100) / 100;
    })(),
    waveOfDeathMinMax: [Math.min(...rows.map((r) => r.waveOfDeath)), Math.max(...rows.map((r) => r.waveOfDeath))],
    /** dégâts max par tir, moyenne sur les runs ayant atteint la vague */
    damageByWave: (() => {
      const acc: Record<number, number[]> = {};
      for (const r of rows) for (const [w, d] of Object.entries(r.damageByWave)) (acc[Number(w)] ??= []).push(d);
      const out: Record<number, { runs: number; meanMaxShotDamage: number }> = {};
      for (const [w, xs] of Object.entries(acc)) out[Number(w)] = { runs: xs.length, meanMaxShotDamage: Math.round(mean(xs)) };
      return out;
    })(),
    survivalByWave: (() => {
      const out: Record<number, number> = {};
      const maxW = Math.max(...rows.map((r) => r.waveOfDeath));
      for (let w = 1; w <= maxW; w++) out[w] = rows.filter((r) => r.waveOfDeath >= w).length;
      return out;
    })(),
  };
}

function assertHealthy(row: RunRow): void {
  const tag = `${row.bot}/${row.seed}`;
  expect(row.pageErrors, `erreurs page ${tag}`).toEqual([]);
  expect(row.consoleErrors, `erreurs console ${tag}`).toEqual([]);
  expect(row.softlocks, `softlocks ${tag}`).toEqual([]);
  expect(FATAL_STOPS, `arrêt fatal ${tag} (${row.stopReason})`).not.toContain(row.stopReason);
}

async function runFast(page: Page, bot: BotKind, seed: string): Promise<RunRow> {
  const t0 = Date.now();
  const { consoleErrors } = await openGame(page, seed);
  await installBot(page, { bot, seed });
  await setSpeed(page, 8);
  const r = await play(page, { maxRealMs: 150_000, fpsBucket: 'speed8' });
  return summarize(bot, seed, r, consoleErrors, Date.now() - t0, null);
}

test.describe.configure({ mode: 'serial' });

test('métriques : 5 runs naïf + 5 runs greedy', async ({ context }) => {
  test.setTimeout(210_000);
  mkdirSync('docs/qa', { recursive: true });

  // --- A. naïf qa-1, vitesse 1 avec délais humains --------------------------------
  const pageA = await context.newPage();
  const tA = Date.now();
  // temps de chargement jusqu'au premier tir possible (sim en 'aiming', avant le clic sur l'écran titre)
  const errA = watchErrors(pageA);
  await pageA.goto('/?seed=qa-1');
  const readyAtMs = (await (
    await pageA.waitForFunction(
      () => {
        const api = (window as unknown as QaWindow).__pegbreaker;
        return api?.sim?.state.phase === 'aiming' ? Math.round(performance.now()) : 0;
      },
      null,
      { polling: 'raf' },
    )
  ).jsonValue()) as number;
  const nav = await pageA.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return n ? { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd) } : null;
  });
  const titleShown = (await pageA.locator('.screen-title.visible').count()) > 0;
  await waitReady(pageA);
  const sA = { consoleErrors: errA };
  await installBot(pageA, { bot: 'naive', seed: 'qa-1', humanDelayMs: AIM_MS });
  await setSpeed(pageA, 1);
  let rA = await play(pageA, { untilFirstReward: true, maxRealMs: 60_000, fpsBucket: 'speed1' });
  const ttfr = rA.firstRewardAt;
  // toujours à vitesse 1 et délais humains jusqu'au 1er écran de choix (fin de vague 1) : mesure fps
  rA = await play(pageA, { stopOnPhases: ['reward', 'gameover'], maxRealMs: 90_000, fpsBucket: 'speed1' });
  // une volée sous CPU 4×
  const cdp = await context.newCDPSession(pageA);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  rA = await play(pageA, { shots: 1, maxRealMs: 30_000, fpsBucket: 'cpu4', fpsOnlyFiring: true });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // le reste de la run à vitesse 8, sans délai (la durée « joueur » est recalculée)
  await configureBot(pageA, { humanDelayMs: 0 });
  await setSpeed(pageA, 8);
  const runA = play(pageA, { maxRealMs: 150_000, fpsBucket: 'speed8' }).then((r) =>
    summarize('naive', 'qa-1', r, sA.consoleErrors, Date.now() - tA, ttfr),
  );

  // --- B. les 9 autres runs en parallèle ---------------------------------------------
  const jobs: Promise<RunRow>[] = [runA];
  for (const bot of ['naive', 'greedy'] as const) {
    for (const seed of SEEDS) {
      if (bot === 'naive' && seed === 'qa-1') continue;
      jobs.push(context.newPage().then((p) => runFast(p, bot, seed)));
    }
  }
  const rows = await Promise.all(jobs);
  const naive = rows.filter((r) => r.bot === 'naive').sort((a, b) => a.seed.localeCompare(b.seed));
  const greedy = rows.filter((r) => r.bot === 'greedy').sort((a, b) => a.seed.localeCompare(b.seed));

  const out = {
    generatedAt: new Date().toISOString(),
    build: await pageA.evaluate(() => (window as unknown as QaWindow).__pegbreaker.version),
    load: { readyToAimMs: readyAtMs, ...nav, titleScreenShown: titleShown },
    method: {
      speed: 'run naive/qa-1 : vitesse 1 + 1,5 s de visée jusqu\'au 1er écran de récompense, 1 volée en CPU 4× (vague 2), puis vitesse 8 ; autres runs : vitesse 8 en parallèle (10 pages, fps vitesse 8 non significatifs : CPU partagé)',
      durationSpecMs: 'stats.durationMs + 1500 ms × tirs',
      durationHumanMs: 'stats.durationMs − temps simulé passé en aiming par le bot + 1500 ms × tirs',
      decisionsPerMin: 'tirs + choix de récompense + achats, par minute de durationSimMs (Sim) ou durationHumanMs (Human)',
      deadMoments: 'fenêtres > 5 s simulées sans ball:/block:/drop:/combo:/reward:, hors reward/shop/gameover',
    },
    naive: { runs: naive, average: averages(naive) },
    greedy: { runs: greedy, average: averages(greedy) },
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'metrics', description: `écrit ${OUT}` });

  for (const row of rows) assertHealthy(row);
});

const ELEMENTS = ['stone', 'fire', 'lightning', 'ice', 'ghost', 'lead', 'split'] as const;

// 720 px de large : au-dessus du seuil « mobile » (600 px CSS) qui plafonne le DPR à 1,5 ;
// plus un cas téléphone réel (375×812, DPR 2, plafonné à 1,5 par le renderer)
const PERF_CASES = [
  { dpr: 1, w: 720, h: 1280, key: 'dpr1' },
  { dpr: 1.5, w: 720, h: 1280, key: 'dpr1_5' },
  { dpr: 2, w: 720, h: 1280, key: 'dpr2' },
  { dpr: 2, w: 375, h: 812, key: 'mobile375_dpr2' },
];
for (const pc of PERF_CASES) {
  const dpr = pc.dpr;
  test(`perf : volée de 30 balles (7 éléments) sous CPU 4×, ${pc.w}×${pc.h} DPR ${dpr}`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: pc.w, height: pc.h },
      deviceScaleFactor: dpr,
      ...(pc.w < 600 ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await ctx.newPage();
    const { consoleErrors } = await openGame(page, 'qa-perf');
    await installBot(page, { bot: 'greedy', seed: 'qa-perf' });
    // debug : volée portée à 30 balles, les 7 éléments en alternance (pire cas de rendu : sprites, trails, effets)
    const fill = (): Promise<number> =>
      page.evaluate((els) => {
        const api = (window as unknown as QaWindow).__pegbreaker;
        const v = api.sim.state.volley;
        let i = 0;
        while (v.length < api.sim.config.balls.maxVolley) v.push({ element: els[i++ % els.length]!, tier: 1 });
        return v.length;
      }, [...ELEMENTS]);
    expect(await fill()).toBe(30);
    await page.waitForTimeout(1200);
    const dprBefore = await page.evaluate(() => ((window as unknown as QaWindow).__pegbreaker.renderer as unknown as { dpr?: number }).dpr ?? null);
    const cdp = await ctx.newCDPSession(page);
    const idle = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.fps);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const shot = play(page, { shots: 1, maxRealMs: 30_000, fpsBucket: 'cpu4-30', fpsOnlyFiring: true });
    await page.waitForTimeout(700);
    if (pc.key === 'dpr2') await page.screenshot({ path: `${FINAL_SHOTS}/06-volee-30-balles-7-elements-dpr2.png` });
    const r = await shot;
    const dprAfter = await page.evaluate(() => ((window as unknown as QaWindow).__pegbreaker.renderer as unknown as { dpr?: number }).dpr ?? null);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await fill();
    const r2 = await play(page, { shots: 1, maxRealMs: 30_000, fpsBucket: 'cpu1-30', fpsOnlyFiring: true });
    const qualitySwitchMs = await page.evaluate(() => ((window as unknown as QaWindow).__pegbreaker.renderer as unknown as { qualitySwitchMs?: number }).qualitySwitchMs ?? null);
    const perf = {
      deviceScaleFactor: dpr,
      viewport: `${pc.w}×${pc.h}`,
      qualitySwitchMs,
      rendererDprBefore: dprBefore,
      rendererDprAfter: dprAfter,
      idleFpsBefore: idle,
      cpu4Volley30: fpsStat(r, 'cpu4-30'),
      cpu1Volley30: fpsStat(r2, 'cpu1-30'),
      shotLog: [...r.shotLog.slice(-1), ...r2.shotLog.slice(-1)],
    };
    try {
      const cur = JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, unknown>;
      cur[`perf30_${pc.key}`] = perf;
      writeFileSync(OUT, JSON.stringify(cur, null, 2) + '\n');
    } catch {
      writeFileSync(OUT.replace('.json', `-perf-${pc.key}.json`), JSON.stringify(perf, null, 2) + '\n');
    }
    test.info().annotations.push({ type: `perf30-dpr${dpr}`, description: JSON.stringify(perf) });
    expect(r.pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(r.softlocks).toEqual([]);
    await ctx.close();
  });
}
