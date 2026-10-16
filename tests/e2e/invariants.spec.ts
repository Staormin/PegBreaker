// tests/e2e/invariants.spec.ts — propriétaire : qa-tester.
// 3 runs complètes à vitesse 8. L'enregistreur QA (bots.ts) vérifie à chaque changement de phase
// (donc après chaque tir) : pas de NaN/Infinity dans l'état, balles dans le plateau, hp ≤ maxHp,
// volée ≥ 1, pas deux blocs sur une cellule ; et en continu : softlock (phase + eventCounts figés
// > 10 s simulées hors reward/shop/gameover), 'firing' > maxVolleyMs + 2 s, sim gelée.
import { expect, test } from '@playwright/test';
import { installBot, openGame, play, setSpeed, type BotKind } from './bots';

test.describe.configure({ mode: 'parallel' });

const RUNS: { seed: string; bot: BotKind }[] = [
  { seed: 'inv-1', bot: 'greedy' },
  { seed: 'inv-2', bot: 'naive' },
  { seed: 'inv-3', bot: 'greedy' },
];

for (const { seed, bot } of RUNS) {
  test(`invariants ${seed} (${bot})`, async ({ page }) => {
    test.setTimeout(170_000);
    const { consoleErrors } = await openGame(page, seed);
    await installBot(page, { bot, seed });
    await setSpeed(page, 8);
    const r = await play(page, { maxRealMs: 150_000 });
    const tag = `seed=${seed} bot=${bot} tirs=${r.shots} vague=${r.state.wave}`;
    test.info().annotations.push({
      type: 'run',
      description: `${tag} arrêt=${r.stopReason} maxFiringMs=${r.maxFiringMs} maxFeedbackGapMs=${r.maxFeedbackGapMs}`,
    });
    expect(r.pageErrors, `erreurs page (${tag})`).toEqual([]);
    expect(consoleErrors, `erreurs console (${tag})`).toEqual([]);
    expect(r.softlocks, `softlocks (${tag})`).toEqual([]);
    expect(r.violations, `invariants (${tag})`).toEqual([]);
    expect(r.stopReason, `la run se termine par un game over (${tag})`).toBe('gameover');
    expect(r.shots).toBeGreaterThan(0);
  });
}
