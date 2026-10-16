// audio/audio.pw.ts — propriétaire : audio-dev. Vérification réelle dans Chromium.
// 1) jeu réel : audio branché sur __pegbreaker.bus, unlock au clic, 20 tirs à vitesse 1 ;
// 2) page preview : rafale synthétique 30 balles (pire cas) ; mesure du pic sur l'AnalyserNode.
import { expect, test, type Page } from '@playwright/test';
import { installBot, openGame, play, setSpeed } from '../../tests/e2e/bots';
import type { AudioSystemDev } from './index';

type W = Window & { __audio?: AudioSystemDev; __audioPreview?: AudioSystemDev };

async function snap(page: Page, key: '__audio' | '__audioPreview') {
  return page.evaluate((k) => {
    const a = (window as unknown as W)[k]!;
    a.debug.samplePeak();
    return {
      unlocked: a.unlocked,
      state: a.debug.contextState,
      nodes: a.debug.engine.nodesCreated,
      voices: a.debug.engine.voicesActive,
      peak: a.debug.engine.peak,
      clip: a.debug.engine.clipSamples,
      accepted: a.debug.mixer.accepted,
      dropped: a.debug.mixer.dropped,
      maxInWindow: a.debug.mixer.maxInWindow,
      music: a.debug.musicPlaying,
    };
  }, key);
}

test('jeu réel : 20 tirs, aucune erreur, nœuds bornés, pas de clipping', async ({ page }) => {
  const { consoleErrors } = await openGame(page, 'audio-qa');
  await page.evaluate(async () => {
    const w = window as unknown as W & { __pegbreaker: { bus: import('../core/events').EventBus } };
    const url = '/src/audio/index.ts';
    const mod = (await import(/* @vite-ignore */ url)) as typeof import('./index');
    const a = mod.createAudio(w.__pegbreaker.bus, { sfx: 0.8, music: 0.5, shake: true, reduceMotion: false });
    w.__audio = a;
    window.addEventListener('pointerdown', () => a.unlock(), { capture: true, once: true });
  });
  const before = await snap(page, '__audio');
  expect(before.nodes).toBe(0);
  expect(before.state).toBe('none');
  expect(before.unlocked).toBe(false);

  await page.mouse.click(270, 300);
  await page.waitForFunction(() => (window as unknown as W).__audio!.unlocked, null, { timeout: 5000 });
  await installBot(page, { bot: 'greedy', seed: 'audio-qa' });
  await setSpeed(page, 1);
  const t0 = Date.now();
  const s0 = await snap(page, '__audio');
  const counts: number[] = [];
  const sampler = setInterval(() => {
    void snap(page, '__audio').then((s) => counts.push(s.voices)).catch(() => undefined);
  }, 250);
  const r = await play(page, { shots: 20, maxRealMs: 200_000 });
  clearInterval(sampler);
  const s1 = await snap(page, '__audio');
  const secs = (Date.now() - t0) / 1000;
  const ev = await page.evaluate(() => (window as unknown as { __pegbreaker: { eventCounts: Record<string, number> } }).__pegbreaker.eventCounts);
  const report = {
    shots: r.shots,
    wave: r.state.wave,
    secs: Math.round(secs),
    nodesPerSec: Math.round((s1.nodes - s0.nodes) / secs),
    nodesTotal: s1.nodes,
    maxVoicesSampled: Math.max(0, ...counts),
    peak: Number(s1.peak.toFixed(4)),
    clipSamples: s1.clip,
    accepted: s1.accepted,
    dropped: s1.dropped,
    maxInWindow: s1.maxInWindow,
    music: s1.music,
    bounces: ev['ball:bounce'] ?? 0,
    hits: ev['block:hit'] ?? 0,
    errors: consoleErrors,
  };
  console.log('AUDIO-GAME', JSON.stringify(report));
  expect(consoleErrors).toEqual([]);
  expect(s1.state).toBe('running');
  expect(s1.maxInWindow).toBeLessThanOrEqual(12);
  expect(report.maxVoicesSampled).toBeLessThan(80);
  expect(s1.peak).toBeLessThan(0.99);
  expect(s1.music).toBe(true);
});

test('preview : rafale 30 balles, volume 0, pas de clipping', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/src/audio/preview.html');
  await page.waitForFunction(() => !!(window as unknown as W).__audioPreview);
  expect((await snap(page, '__audioPreview')).nodes).toBe(0);
  await page.getByRole('button', { name: 'Tout jouer en séquence' }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as unknown as W).__audioPreview!.debug.resetPeak());
  await page.getByRole('button', { name: 'Rafale 30 balles (3 s)' }).click();
  await page.getByRole('button', { name: 'boss:spawned' }).click();
  await page.getByRole('button', { name: 'explode' }).click();
  await page.waitForTimeout(3500);
  const s = await snap(page, '__audioPreview');
  console.log('AUDIO-STRESS', JSON.stringify(s));
  expect(s.state).toBe('running');
  expect(s.accepted).toBeGreaterThan(50);
  expect(s.dropped).toBeGreaterThan(0);
  expect(s.peak).toBeLessThan(0.99);
  expect(s.maxInWindow).toBeLessThanOrEqual(12);

  // volume SFX 0 : plus aucun nœud créé
  await page.evaluate(() => (window as unknown as W).__audioPreview!.setSfxVolume(0));
  const n0 = (await snap(page, '__audioPreview')).nodes;
  await page.getByRole('button', { name: 'Rafale 30 balles (3 s)' }).click();
  await page.waitForTimeout(800);
  const n1 = (await snap(page, '__audioPreview')).nodes;
  // seule la musique (si active) peut créer des nœuds
  expect(n1 - n0).toBeLessThan(40);
  expect(errors).toEqual([]);
});
