// tests/e2e/progression.spec.ts — propriétaire : qa-tester. Jalon 3 : progression run 1 → 5 AVEC méta.
// Même profil localStorage conservé entre les runs ; même seed pour les 5 runs (seule la méta change) ;
// après chaque run, le bot achète le nœud le moins cher tant qu'il peut. Écrit docs/qa/j3-progression.json.
// N'échoue que sur crash / softlock / erreur console / méta non créditée (pas sur une cible de fun).
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

const SEED = 'prog';
/** vitesse de sim (runs longues avec la méta) et plafond réel par run : au-delà, la run est notée « timeout » (survie > plafond) */
const SPEED = 24;
const MAX_REAL_MS = 45_000;

test('progression méta : 5 runs greedy, achat du nœud le moins cher', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  const rows: Record<string, unknown>[] = [];
  for (let run = 1; run <= 5; run++) {
    await page.goto('/?fresh=1');
    await waitReady(page);
    const mods = await page.evaluate((seed) => {
      const api = (window as unknown as QaWindow).__pegbreaker;
      api.sim.restart(seed);
      const m = api.meta.getModifiers();
      return { bonusHp: m.bonusHp, bonusStartBalls: m.bonusStartBalls, coinMultiplier: m.coinMultiplier, freeRerolls: m.freeRerolls, unlockedElements: m.unlockedElements };
    }, SEED);
    const start = await page.evaluate(() => {
      const s = (window as unknown as QaWindow).__pegbreaker.sim.state;
      return { maxHp: s.maxHp, volley: s.volley.length };
    });
    await installBot(page, { bot: 'greedy', seed: SEED });
    await setSpeed(page, SPEED);
    const r = await play(page, { maxRealMs: MAX_REAL_MS });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const api = (window as unknown as QaWindow).__pegbreaker;
      const m = api.meta;
      const before = m.data.meta.fragments;
      const nodes = api.sim.config.meta.nodes;
      const bought: string[] = [];
      for (let guard = 0; guard < 20; guard++) {
        let best: string | null = null;
        let bc = Infinity;
        for (const n of nodes) {
          if (!m.canBuyNode(n.id)) continue;
          const c = n.costs[m.data.meta.nodes[n.id] ?? 0];
          if (c !== undefined && c < bc) {
            bc = c;
            best = n.id;
          }
        }
        if (!best || !m.buyNode(best)) break;
        bought.push(`${best}:${bc}`);
      }
      return {
        fragmentsAfterRun: before,
        fragmentsLeft: m.data.meta.fragments,
        bought,
        runs: m.data.stats.runs,
        achievements: [...m.data.achievements],
        nodes: { ...m.data.meta.nodes },
      };
    });
    rows.push({
      run,
      modifiers: mods,
      start,
      stopReason: r.stopReason,
      depth: r.state.depth,
      wave: r.state.wave,
      bestShotDamage: r.state.stats.bestShotDamage,
      bestCombo: r.state.stats.bestCombo,
      finalVolley: r.state.volley,
      durationSimMs: Math.round(r.state.stats.durationMs),
      bossesKilled: r.state.stats.bossesKilled,
      perfectWaves: r.state.stats.perfectWaves,
      deadMoments: r.deadMoments.length,
      softlocks: r.softlocks,
      ...after,
    });
    // run non terminée dans le plafond : on l'abandonne (la méta n'est pas créditée) et on continue
    if (r.stopReason !== 'gameover') rows[rows.length - 1]!['note'] = `run interrompue après ${MAX_REAL_MS / 1000} s réelles à vitesse ${SPEED}`;
  }
  const series = (k: string): number[] => rows.map((x) => x[k] as number);
  const monotonic = (xs: number[]): boolean => xs.every((x, i) => i === 0 || x >= (xs[i - 1] as number));
  const out = {
    generatedAt: new Date().toISOString(),
    seed: SEED,
    rows,
    trend: {
      depth: { values: series('depth'), nonDecreasing: monotonic(series('depth')), run5MinusRun1: (series('depth')[4] ?? 0) - (series('depth')[0] ?? 0) },
      bestShotDamage: { values: series('bestShotDamage'), nonDecreasing: monotonic(series('bestShotDamage')) },
      finalVolley: { values: series('finalVolley'), nonDecreasing: monotonic(series('finalVolley')) },
    },
  };
  writeFileSync('docs/qa/j3-progression.json', JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'progression', description: JSON.stringify(out.trend) });
  for (const x of rows) {
    expect(x['softlocks'], `softlock run ${String(x['run'])}`).toEqual([]);
    expect(['gameover', 'timeout'], `arrêt run ${String(x['run'])}`).toContain(x['stopReason']);
    if (x['stopReason'] === 'gameover') expect(x['fragmentsAfterRun'] as number, 'fragments crédités').toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});
