// tests/e2e/late.spec.ts — propriétaire : qa-tester. Diagnostic fin de partie (anti-infini, waves.json → lateWave).
// Long (plusieurs minutes) : désactivé dans la suite, lancer avec
//   QA_LATE=1 npx playwright test late --workers=1
// Reproduit la run « conditionnel / qa-2 » de fun.spec.ts (pool personnel, profil vierge, seconde chance gratuite)
// et journalise, tous les 5 tirs : vague, tir dans la vague, rangées restantes, blocs, PV. Sortie : docs/qa/balls-data/late-qa-2.json.
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installBot, openGame, play, setSpeed, type QaWindow } from './bots';

test('fin de partie : la vague lateWave finit (conditionnel qa-2, pool personnel)', async ({ page }) => {
  test.skip(!process.env['QA_LATE'], 'diagnostic long : QA_LATE=1');
  test.setTimeout(900_000);
  const { consoleErrors } = await openGame(page, 'qa-2');
  await installBot(page, { bot: 'naive', seed: 'qa-2', spreadMode: 'rowSelector', onLost: 'reviveIfAffordable' });
  await setSpeed(page, 16);
  const log: Record<string, unknown>[] = [];
  let stop = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 800_000) {
    const r = await play(page, { shots: 5, maxRealMs: 120_000 });
    const s = await page.evaluate(() => {
      const st = (window as unknown as QaWindow).__pegbreaker.sim.state;
      let hpSum = 0;
      for (const b of st.blocks) hpSum += b.hp;
      return { wave: st.wave, shotInWave: st.shotInWave, rowsLeftInWave: st.rowsLeftInWave, depth: st.depth, blocks: st.blocks.length, blockHp: Math.round(hpSum), hp: st.hp, maxHp: st.maxHp, volley: st.volley.length, phase: st.phase, simMin: Math.round(st.stats.durationMs / 600) / 100 };
    });
    log.push(s);
    if (r.stopReason === 'gameover' || s.phase === 'gameover') {
      stop = 'gameover';
      break;
    }
  }
  mkdirSync('docs/qa/balls-data', { recursive: true });
  writeFileSync('docs/qa/balls-data/late-qa-2.json', JSON.stringify({ stop: stop || 'timeout', realMs: Date.now() - t0, log }, null, 2) + '\n');
  expect(consoleErrors).toEqual([]);
});
