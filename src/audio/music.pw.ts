// audio/music.pw.ts — propriétaire : audio-dev. Validation de la musique dans Chromium.
// npx playwright test -c src/audio/playwright.audio.config.ts music
// 1) rendu OfflineAudioContext de 40 s par piste (vague 6 = toutes couches ; vague 1 ; boss) avec un
//    AnalyserNode échantillonné toutes les 50 ms : pic < 0,9, pas de silence > 2 s, RMS stable
//    (pas de saut > 6 dB entre mesures voisines) ;
// 2) temps réel sous charge (thread principal bloqué 200 ms toutes les 400 ms) : aucune note en
//    retard, aucune mesure recalée ; silence d'intro, fondu croisé, lost / revived / over.
import { expect, test, type Page } from '@playwright/test';
import type { MusicTrackId } from '../core/types';
import type { AudioSystemDev } from './index';

type W = Window & { __audioPreview?: AudioSystemDev };
const TRACKS: MusicTrackId[] = ['neon', 'arcade', 'deep'];
/** crête des SFX mesurée en jeu après le limiteur (docs/qa/*-audio.json) */
const SFX_PEAK = 0.86;

async function openPreview(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/src/audio/preview.html');
  await page.waitForFunction(() => !!(window as unknown as W).__audioPreview);
  return errors;
}

test('rendu 40 s par piste : pic, silences, stabilité RMS', async ({ page }) => {
  const errors = await openPreview(page);
  const results = await page.evaluate(async (ids) => {
    const url = '/src/audio/render.ts';
    const mod = (await import(/* @vite-ignore */ url)) as typeof import('./render');
    const out: Record<string, unknown>[] = [];
    for (const track of ids) {
      for (const [wave, boss] of [[6, false], [1, false], [6, true]] as const) {
        const r = await mod.renderMusic({ track, seconds: 40, wave, boss, analyser: true });
        out.push({
          track,
          wave,
          boss,
          peak: Number(r.analysis.peak.toFixed(4)),
          peakDb: Number(r.analysis.peakDb.toFixed(1)),
          rmsDb: Number(r.analysis.rmsDb.toFixed(1)),
          maxSilenceS: Number(r.analysis.maxSilenceS.toFixed(2)),
          maxBarJumpDb: Number(r.analysis.maxBarJumpDb.toFixed(2)),
          bars: r.analysis.barRmsDb.length,
          analyserPeak: Number((r.analyser?.peak ?? -1).toFixed(4)),
          analyserSamples: r.analyser?.samples ?? 0,
          analyserMaxBarJumpDb: Number(
            (r.analyser?.barRmsDb ?? []).reduce((m, v, i, a) => (i === 0 ? 0 : Math.max(m, Math.abs(v - (a[i - 1] ?? v)))), 0).toFixed(2),
          ),
        });
      }
    }
    return out;
  }, TRACKS);
  for (const r of results) console.log('MUSIC-RENDER', JSON.stringify(r));
  for (const r of results) {
    const tag = `${String(r.track)} vague ${String(r.wave)}${r.boss ? ' boss' : ''}`;
    expect(r.peak as number, tag).toBeLessThan(0.9);
    expect(r.peak as number, tag).toBeGreaterThan(0.01);
    expect(r.analyserPeak as number, tag).toBeLessThan(0.9);
    expect(r.analyserSamples as number, tag).toBeGreaterThan(700);
    expect(r.maxSilenceS as number, tag).toBeLessThanOrEqual(2);
    expect(r.maxBarJumpDb as number, tag).toBeLessThanOrEqual(6);
    expect(r.analyserMaxBarJumpDb as number, tag).toBeLessThanOrEqual(6);
    expect(r.bars as number, tag).toBeGreaterThanOrEqual(13);
  }
  expect(errors).toEqual([]);
});

test('temps réel sous charge : aucune note en retard ; intro, fondu croisé, lost/revived/over', async ({ page }) => {
  const errors = await openPreview(page);
  const dbg = () =>
    page.evaluate(() => {
      const x = (window as unknown as W).__audioPreview!;
      x.debug.samplePeak();
      return {
        mode: x.debug.musicMode,
        track: x.musicTrack,
        wave: x.debug.musicWave,
        tension: x.debug.musicTension,
        stats: { ...x.debug.musicStats },
        peak: x.debug.engine.peak,
        state: x.debug.contextState,
      };
    });

  await page.getByRole('button', { name: 'Démarrer (run:started)' }).click();
  await page.waitForFunction(() => (window as unknown as W).__audioPreview!.unlocked);
  // 2 s de silence d'intro
  await page.waitForTimeout(1000);
  expect((await dbg()).mode).toBe('intro');
  await page.waitForTimeout(1500);
  expect((await dbg()).mode).toBe('play');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'intensité +' }).click();
  expect((await dbg()).wave).toBe(6);

  // charge : le thread principal est bloqué 200 ms toutes les 400 ms pendant 10 s ; on échantillonne le pic
  await page.evaluate(async () => {
    const x = (window as unknown as W).__audioPreview!;
    x.debug.resetPeak();
    const end = performance.now() + 10_000;
    while (performance.now() < end) {
      const until = performance.now() + 200;
      while (performance.now() < until) x.debug.samplePeak();
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  const loaded = await dbg();
  console.log('MUSIC-LOAD', JSON.stringify(loaded));
  expect(loaded.stats.barsPlanned).toBeGreaterThanOrEqual(3);
  expect(loaded.stats.lateNotes).toBe(0);
  expect(loaded.stats.resyncs).toBe(0);
  expect(loaded.stats.minLeadMs).toBeGreaterThanOrEqual(150);
  expect(loaded.peak).toBeLessThan(0.9);

  // boss
  await page.getByRole('button', { name: 'boss on/off' }).click();
  expect((await dbg()).tension).toBe(true);
  await page.getByRole('button', { name: 'boss on/off' }).click();

  // fondu croisé vers chaque piste ; pic de la musique seule mesuré après compresseur + limiteur
  // (même point que les SFX du jeu, ~0,86 en crête) : il doit rester ≥ 8 dB dessous (cible ~0,3)
  const peaks: Record<string, number> = {};
  for (const id of ['arcade', 'deep', 'neon'] as const) {
    await page.getByLabel('Piste musicale').selectOption(id);
    const s = await dbg();
    expect(s.track).toBe(id);
    expect(s.mode).toBe('play');
    await page.waitForTimeout(3000);
    peaks[id] = await page.evaluate(async () => {
      const x = (window as unknown as W).__audioPreview!;
      x.debug.resetPeak();
      const end = performance.now() + 8000;
      while (performance.now() < end) {
        x.debug.samplePeak();
        await new Promise((r) => setTimeout(r, 20));
      }
      return x.debug.engine.peak;
    });
  }
  console.log('MUSIC-REALTIME-PEAK', JSON.stringify(peaks));
  for (const v of Object.values(peaks)) expect(v).toBeLessThanOrEqual(SFX_PEAK * Math.pow(10, -8 / 20));

  // lost → accord tenu ; revived → reprise ; over → résolution puis silence
  await page.getByRole('button', { name: 'lost', exact: true }).click();
  expect((await dbg()).mode).toBe('lost');
  const barsLost = (await dbg()).stats.barsPlanned;
  await page.waitForTimeout(3000);
  expect((await dbg()).stats.barsPlanned).toBe(barsLost);
  await page.getByRole('button', { name: 'revived', exact: true }).click();
  expect((await dbg()).mode).toBe('play');
  await page.waitForTimeout(3000);
  expect((await dbg()).stats.barsPlanned).toBeGreaterThan(barsLost);
  await page.getByRole('button', { name: 'over', exact: true }).click();
  expect((await dbg()).mode).toBe('over');
  await page.waitForTimeout(12_000);
  const end = await dbg();
  console.log('MUSIC-END', JSON.stringify(end));
  expect(end.mode).toBe('idle');
  expect(end.stats.lateNotes).toBe(0);
  expect(end.state).toBe('running');
  expect(errors).toEqual([]);
});

test('export WAV 30 s depuis la preview', async ({ page }) => {
  const errors = await openPreview(page);
  await page.getByLabel('Piste musicale').selectOption('deep');
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Exporter WAV 30 s' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('pegbreaker-deep-vague1.wav');
  const path = await d.path();
  const { statSync } = await import('node:fs');
  // 30 s × 44 100 Hz × 2 canaux × 2 octets + en-tête
  expect(statSync(path).size).toBe(44 + 30 * 44100 * 2 * 2);
  expect(errors).toEqual([]);
});

test('rafale 30 balles + musique intensité max (arcade, boss) : pic master < 0,9', async ({ page }) => {
  const errors = await openPreview(page);
  await page.getByRole('button', { name: 'Démarrer (run:started)' }).click();
  await page.getByLabel('Piste musicale').selectOption('arcade');
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'intensité +' }).click();
  await page.getByRole('button', { name: 'boss on/off' }).click();
  await page.waitForTimeout(5000);
  const sample = (ms: number) =>
    page.evaluate(async (dur) => {
      const x = (window as unknown as W).__audioPreview!;
      x.debug.resetPeak();
      const end = performance.now() + dur;
      while (performance.now() < end) {
        x.debug.samplePeak();
        await new Promise((r) => setTimeout(r, 10));
      }
      return { peak: x.debug.engine.peak, mode: x.debug.musicMode };
    }, ms);
  const musicOnly = await sample(3000);
  await page.getByRole('button', { name: 'Rafale 30 balles (3 s)' }).click();
  const both = await sample(3500);
  console.log('MUSIC+BURST', JSON.stringify({ musicOnly, both }));
  expect(musicOnly.mode).toBe('play');
  expect(musicOnly.peak).toBeGreaterThan(0.2);
  expect(both.peak).toBeLessThan(0.9);
  expect(errors).toEqual([]);
});
