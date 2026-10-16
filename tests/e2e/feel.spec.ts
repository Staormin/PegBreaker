// tests/e2e/feel.spec.ts — propriétaire : qa-tester. Jalon 2 : juice et audio.
//
// Observable sans toucher au code du jeu :
//  - particules : `bus.emit` est enveloppé ; on lit renderer.particleCount avant/après chaque événement
//    (les handlers du renderer sont synchrones) ;
//  - pas de hit-stop (retiré le 2026-10-16) : stats.durationMs ne stagne jamais pendant 'firing' ;
//  - HUD : classes « pop »/« shake »/« pulse » posées par l'UI ;
//  - avancée des rangées : advanceProgress pris dans ]0,1[ (pas de téléportation) ;
//  - audio : audio.debug (nœuds, voix admises) + un AnalyserNode QA branché en parallèle de tout ce qui
//    se connecte à destination (init script) pour mesurer le pic réel en sortie.
// Non observables sans instrumenter render/ : flash de mur, squash, nombres flottants, shake, nom du boss
// → couverts par les captures.
import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { SHOTS_DIR, installBot, play, setSpeed, waitReady, watchErrors, type QaWindow } from './bots';

test.describe.configure({ mode: 'parallel' });

interface EvStat {
  n: number;
  /** événements suivis d'une hausse de particleCount */
  withParticles: number;
  particleSum: number;
  /** contrôle DOM réussi (pop / shake / pulse) */
  domOk: number;
  domChecked: number;
  /** occurrences survenues pool de particules (presque) plein : exclues du ratio */
  saturated: number;
}

interface FeelReport {
  ev: Record<string, EvStat>;
  milestoneByLevel: Record<string, number>;
  triggers: { type: string; frozenAfter: boolean; level?: number }[];
  frozenFrames: number;
  frozenUnexplained: number;
  /** frames où durationMs stagne en phase 'firing', onglet visible et écran de jeu (hors pause) */
  firingFrozen: number;
  firingFrames: number;
  advanceSamples: number[];
  slowmo: { level3: number; ratioMin: number | null };
  maxParticles: number;
}

type FeelWindow = QaWindow & { __feel: { report(): FeelReport; resetCounters(): void } };

/** S'exécute dans la page : instrumente bus.emit et une boucle rAF d'observation. Autonome. */
function feelInstall(): void {
  const w = window as unknown as FeelWindow;
  const api = w.__pegbreaker;
  const bus = api.bus;
  const r = api.renderer;
  const sim = api.sim;
  const HITSTOP = ['block:explode', 'player:damaged', 'boss:killed'];
  /** capacité du pool de particules (render/particles.ts) */
  const POOL = 1024;
  let ev: Record<string, EvStat> = {};
  let milestoneByLevel: Record<string, number> = {};
  let triggers: { type: string; t: number; frozenAfter: boolean; level?: number }[] = [];
  let frozenFrames = 0;
  let frozenUnexplained = 0;
  let firingFrozen = 0;
  let firingFrames = 0;
  let advanceSamples: number[] = [];
  let maxParticles = 0;
  const slow = { level3: 0, ratios: [] as number[] };
  let slowUntil = 0;

  const q = (sel: string): Element | null => document.querySelector(sel);
  const orig = bus.emit.bind(bus);
  bus.emit = (e) => {
    const before = r.particleCount;
    orig(e);
    const d = r.particleCount - before;
    if (r.particleCount > maxParticles) maxParticles = r.particleCount;
    let key: string = e.type;
    if (e.type === 'ball:bounce') key = `ball:bounce:${e.surface}`;
    const st = (ev[key] ??= { n: 0, withParticles: 0, particleSum: 0, domOk: 0, domChecked: 0, saturated: 0 });
    st.n++;
    if (before >= POOL - 16) st.saturated++;
    else if (d > 0) {
      st.withParticles++;
      st.particleSum += d;
    }
    const dom = (sel: string, cls: string): void => {
      st.domChecked++;
      if (q(sel)?.classList.contains(cls)) st.domOk++;
    };
    if (e.type === 'drop:collected') {
      dom(e.kind === 'coin' ? '.hud-coins' : e.kind === 'fragment' ? '.hud-frags' : e.kind === 'heart' ? '.hud-hp' : '.hud-volley', 'pop');
    } else if (e.type === 'player:damaged') dom('.hud-hp', 'shake');
    const now = performance.now();
    if (e.type === 'combo:milestone') {
      milestoneByLevel[e.level] = (milestoneByLevel[e.level] ?? 0) + 1;
      if (e.level >= 2) triggers.push({ type: `combo:milestone:${e.level}`, t: now, frozenAfter: false, level: e.level });
      if (e.level === 3) {
        slow.level3++;
        slowUntil = now + 250;
      }
    } else if (HITSTOP.indexOf(e.type) >= 0) triggers.push({ type: e.type, t: now, frozenAfter: false });
  };

  let lastDur = sim.state.stats.durationMs;
  let lastT = performance.now();
  let speedRef = 0;
  const loop = (): void => {
    requestAnimationFrame(loop);
    const s = sim.state;
    const now = performance.now();
    const d = s.stats.durationMs - lastDur;
    const dt = now - lastT;
    lastDur = s.stats.durationMs;
    lastT = now;
    // la sim compte le temps dans toutes les phases sauf gameover : un gel est observable aussi en 'aiming'
    // (player:damaged survient en fin d'avancée, juste avant le retour en visée)
    const playing = !document.hidden && document.getElementById('ui')?.dataset.screen === 'game';
    if (s.phase === 'firing' && playing && dt > 0) {
      firingFrames++;
      if (d === 0) firingFrozen++;
    }
    const live = s.phase === 'firing' || s.phase === 'advancing' || s.phase === 'aiming';
    if (live && d === 0) {
      let explained = false;
      for (const t of triggers) {
        if (now - t.t < 180) {
          t.frozenAfter = true;
          explained = true;
        }
      }
      if (explained || s.phase !== 'aiming') frozenFrames++;
      if (!explained && s.phase !== 'aiming') frozenUnexplained++;
    } else if (s.phase === 'firing' || s.phase === 'advancing') {
      if (dt > 0) {
        const ratio = d / dt;
        if (now < slowUntil) slow.ratios.push(ratio / Math.max(1e-6, speedRef || ratio));
        else speedRef = speedRef ? speedRef * 0.9 + ratio * 0.1 : ratio;
      }
    }
    if (s.phase === 'advancing') advanceSamples.push(Math.round(s.advanceProgress * 100) / 100);
  };
  requestAnimationFrame(loop);

  w.__feel = {
    report: () => ({
      ev: JSON.parse(JSON.stringify(ev)) as Record<string, EvStat>,
      milestoneByLevel: { ...milestoneByLevel },
      triggers: triggers.map((t) => ({ type: t.type, frozenAfter: t.frozenAfter, ...(t.level ? { level: t.level } : {}) })),
      frozenFrames,
      frozenUnexplained,
      firingFrozen,
      firingFrames,
      advanceSamples: advanceSamples.slice(0, 400),
      slowmo: { level3: slow.level3, ratioMin: slow.ratios.length ? Math.min(...slow.ratios) : null },
      maxParticles,
    }),
    resetCounters: () => {
      ev = {};
      milestoneByLevel = {};
      triggers = [];
      frozenFrames = 0;
      frozenUnexplained = 0;
      firingFrozen = 0;
      firingFrames = 0;
      advanceSamples = [];
      maxParticles = 0;
      slow.level3 = 0;
      slow.ratios = [];
    },
  };
}

/** Init script : branche un AnalyserNode QA sur tout ce qui se connecte à la destination. */
function audioTapInit(): void {
  const proto = AudioNode.prototype as unknown as { connect: (...a: unknown[]) => unknown };
  const origConnect = proto.connect;
  const taps = new WeakMap<BaseAudioContext, AnalyserNode>();
  const st = { peak: 0, clip: 0, samples: 0 };
  (window as unknown as { __qaAudio: typeof st }).__qaAudio = st;
  proto.connect = function (this: AudioNode, ...args: unknown[]) {
    const out = origConnect.apply(this, args);
    const dest = args[0];
    if (dest instanceof AudioDestinationNode) {
      const ctx = this.context;
      let an = taps.get(ctx);
      if (!an) {
        an = ctx.createAnalyser();
        an.fftSize = 2048;
        taps.set(ctx, an);
        const buf = new Float32Array(an.fftSize);
        const sample = (): void => {
          if (ctx.state === 'running') {
            an!.getFloatTimeDomainData(buf);
            st.samples++;
            for (let i = 0; i < buf.length; i++) {
              const a = Math.abs(buf[i] ?? 0);
              if (a > st.peak) st.peak = a;
              if (a >= 0.99) st.clip++;
            }
          }
          setTimeout(sample, 20);
        };
        sample();
      }
      origConnect.call(this, an);
    }
    return out;
  };
}

async function setupFeel(page: Page, seed: string, extraVolley: string[]): Promise<string[]> {
  await page.addInitScript(audioTapInit);
  const errors = watchErrors(page);
  await page.goto(`/?seed=${seed}`);
  await waitReady(page);
  await page.mouse.click(270, 480); // geste réel : déverrouille l'audio (si le titre n'était pas là)
  await page.evaluate(feelInstall);
  await installBot(page, { bot: 'greedy', seed });
  await page.evaluate((els) => {
    const v = (window as unknown as QaWindow).__pegbreaker.sim.state.volley;
    for (const e of els) v.push({ element: e as 'stone', tier: 1 });
  }, extraVolley);
  return errors;
}

const RICH = ['fire', 'fire', 'fire', 'lightning', 'lightning', 'lightning', 'split', 'split', 'ice', 'ice', 'stone', 'stone'];

/** tirs « passifs » vers un coin : laisse descendre les blocs (brèches, dégâts, rows:advanced) */
async function passiveShots(page: Page, n: number): Promise<void> {
  // debug : volée réduite à une balle pour laisser les blocs atteindre la ligne
  await page.waitForFunction(() => (window as unknown as QaWindow).__pegbreaker.sim.state.phase !== 'firing');
  await page.evaluate(() => {
    const v = (window as unknown as QaWindow).__pegbreaker.sim.state.volley;
    v.splice(1, v.length - 1);
  });
  for (let i = 0; i < n; i++) {
    const done = await page.evaluate(async () => {
      const api = (window as unknown as QaWindow).__pegbreaker;
      const s = api.sim.state;
      for (let k = 0; k < 600 && s.phase !== 'aiming' && s.phase !== 'gameover'; k++) {
        if (s.phase === 'reward') api.sim.chooseReward(0);
        else if (s.phase === 'shop') api.sim.leaveShop();
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (s.phase === 'gameover') return true;
      api.sim.aim({ x: -1, y: -0.15 });
      api.sim.fire();
      return (api.eventCounts['player:damaged'] ?? 0) >= 2;
    });
    if (done) break;
  }
}

test('feedback visuel par événement (table game-feel)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await setupFeel(page, 'feel-1', RICH);
  await setSpeed(page, 2);
  // phase 1 : bot greedy + volée enrichie (feu, foudre, scission, glace)
  await play(page, { shots: 8, maxRealMs: 45_000 });
  await page.screenshot({ path: `${SHOTS_DIR}/14-feel-fin-volee.png` });
  // phase 2 : tirs passifs (dégâts joueur, avancées)
  await setSpeed(page, 6);
  await passiveShots(page, 30);
  const rep = await page.evaluate(() => (window as unknown as FeelWindow).__feel.report());
  writeFileSync('docs/qa/j2-feel.json', JSON.stringify(rep, null, 2) + '\n');
  test.info().annotations.push({ type: 'feel', description: JSON.stringify({ ...rep, advanceSamples: rep.advanceSamples.length }) });

  const share = (k: string): number => {
    const s = rep.ev[k];
    return s && s.n - s.saturated > 0 ? s.withParticles / (s.n - s.saturated) : 0;
  };
  const must = (k: string, minShare: number): void => {
    expect((rep.ev[k]?.n ?? 0) - (rep.ev[k]?.saturated ?? 0), `événement ${k} observé (hors pool saturé)`).toBeGreaterThan(0);
    expect(share(k), `${k} : part des occurrences avec particules`).toBeGreaterThanOrEqual(minShare);
  };
  must('ball:bounce:wall', 0.8);
  must('ball:bounce:block', 0.8);
  must('block:hit', 0.8);
  must('block:destroyed', 0.9);
  const ds = rep.ev['block:destroyed']!;
  // densité de base 0,45 depuis le retrait du mode mouvement (2026-10-16) : ~7 éclats mesurés
  expect(ds.particleSum / ds.withParticles, 'éclats par bloc détruit ≥ 5').toBeGreaterThanOrEqual(5);
  must('combo:milestone', 0.9);
  if (rep.ev['block:explode']) must('block:explode', 0.8);
  if (rep.ev['lightning:chain']) must('lightning:chain', 0.8);
  if (rep.ev['ball:split']) must('ball:split', 0.8);
  if (rep.ev['block:frozen']) must('block:frozen', 0.8);
  // les « pop » / « shake » du HUD ont été retirés avec le mode mouvement (2026-10-16) :
  // le feedback des drops est côté renderer (particules) ; player:damaged n'a plus d'effet mesurable hors canvas
  if (rep.ev['drop:collected']) must('drop:collected', 0.8);
  expect(rep.ev['player:damaged']?.n ?? 0, 'dégâts joueur provoqués').toBeGreaterThan(0);
  // plus de hit-stop ni de ralenti (décision produit du 2026-10-16) : la sim ne se fige jamais
  expect(rep.firingFrozen, `frames figées pendant 'firing' (sur ${rep.firingFrames})`).toBe(0);
  expect(rep.maxParticles, 'particules sous le plafond du pool (1024)').toBeLessThanOrEqual(1024);
  // rows:advanced : glissement interpolé
  const mid = rep.advanceSamples.filter((x) => x > 0.05 && x < 0.95).length;
  expect(mid, 'advanceProgress observé entre 0 et 1 (pas de téléportation)').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('non-régression : la sim ne se fige jamais pendant une volée (hit-stop retiré), particules sous le plafond', async ({ page }) => {
  test.setTimeout(90_000);
  // volée enrichie : explosions, paliers de combo, dégâts — tous ces événements déclenchaient un hit-stop avant
  const errors = await setupFeel(page, 'feel-3', [...RICH, ...RICH]);
  await setSpeed(page, 2);
  await play(page, { shots: 6, maxRealMs: 45_000 });
  await setSpeed(page, 6);
  await passiveShots(page, 20);
  const rep = await page.evaluate(() => (window as unknown as FeelWindow).__feel.report());
  const out = {
    firingFrames: rep.firingFrames,
    firingFrozen: rep.firingFrozen,
    triggers: rep.triggers.length,
    milestones: rep.milestoneByLevel,
    maxParticles: rep.maxParticles,
    slowmo: rep.slowmo,
    timeScale: await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.timeScale),
  };
  writeFileSync('docs/qa/final-no-freeze.json', JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'no-freeze', description: JSON.stringify(out) });
  expect(rep.firingFrames, 'frames de volée observées').toBeGreaterThan(100);
  expect(out.triggers, 'anciens déclencheurs de hit-stop présents (explosions, paliers 2+, dégâts)').toBeGreaterThan(0);
  expect(rep.firingFrozen, 'aucune frame où durationMs stagne pendant firing').toBe(0);
  if (rep.slowmo.ratioMin !== null) expect(rep.slowmo.ratioMin, 'pas de ralenti au palier 3').toBeGreaterThan(0.6);
  expect(rep.maxParticles, 'particules ≤ plafond 1024').toBeLessThanOrEqual(1024);
  expect(errors).toEqual([]);
});

test('audio : nœuds créés, pic < 0,99, SFX à 0 → plus aucune voix ni nœud', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await setupFeel(page, 'audio-1', ['fire', 'fire', 'lightning', 'lightning', 'split', 'stone', 'stone', 'stone']);
  const stats = (): Promise<{ unlocked: boolean; state: string; nodes: number; accepted: number; dropped: number; peak: number; clip: number; samples: number }> =>
    page.evaluate(() => {
      const w = window as unknown as QaWindow & { __qaAudio: { peak: number; clip: number; samples: number } };
      const a = w.__pegbreaker.audio as unknown as {
        unlocked: boolean;
        debug: { contextState: string; mixer: { accepted: number; dropped: number }; engine: { nodesCreated: number } };
      };
      return {
        unlocked: a.unlocked,
        state: a.debug.contextState,
        nodes: a.debug.engine.nodesCreated,
        accepted: a.debug.mixer.accepted,
        dropped: a.debug.mixer.dropped,
        peak: Math.round(w.__qaAudio.peak * 1000) / 1000,
        clip: w.__qaAudio.clip,
        samples: w.__qaAudio.samples,
      };
    });
  const s0 = await stats();
  await setSpeed(page, 2);
  await play(page, { shots: 20, maxRealMs: 80_000 });
  const s1 = await stats();
  await page.evaluate(() => {
    const a = (window as unknown as QaWindow).__pegbreaker.audio!;
    a.setSfxVolume(0);
    a.setMusicVolume(0);
  });
  await page.waitForTimeout(1500); // fin des voix en cours et de la musique
  const s2 = await stats();
  await play(page, { shots: 3, maxRealMs: 20_000 });
  await page.waitForTimeout(300);
  const s3 = await stats();
  const out = { atUnlock: s0, after20Shots: s1, afterMute: s2, after3MutedShots: s3 };
  writeFileSync('docs/qa/j2-audio.json', JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'audio', description: JSON.stringify(out) });
  expect(s1.unlocked, 'AudioContext déverrouillé par le geste').toBe(true);
  expect(s1.nodes - s0.nodes, 'nœuds créés pendant 20 tirs').toBeGreaterThan(0);
  expect(s1.accepted, 'voix SFX admises').toBeGreaterThan(0);
  expect(s1.samples, 'pic mesuré en sortie').toBeGreaterThan(0);
  expect(s1.peak, 'pic de sortie < 0,99').toBeLessThan(0.99);
  expect(s1.clip, 'échantillons ≥ 0,99').toBe(0);
  expect(s3.accepted, 'SFX à 0 : plus aucune voix admise').toBe(s2.accepted);
  expect(s3.nodes, 'SFX + musique à 0 : plus aucun nœud créé').toBe(s2.nodes);
  expect(errors).toEqual([]);
});

test('fusion : carte de récompense « fuse » cliquée au DOM → animation (particules renderer)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  let found = '';
  for (let i = 1; i <= 8 && !found; i++) {
    const seed = `fuse-${i}`;
    await page.goto(`/?seed=${seed}`);
    await waitReady(page);
    await installBot(page, { bot: 'greedy', seed, handleChoices: false });
    await setSpeed(page, 8);
    const r = await play(page, { stopOnPhases: ['reward', 'gameover'], maxRealMs: 20_000 });
    if (r.state.phase !== 'reward') continue;
    if ((await page.locator('.card-fuse').count()) > 0) found = seed;
  }
  expect(found, 'une offre de fusion trouvée sur fuse-1…8').not.toBe('');
  await setSpeed(page, 1);
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.volley.length);
  const pc0 = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.renderer.particleCount);
  // pic de particules pendant l'animation de fusion (échantillonné en parallèle du clic)
  const peak = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const r = (window as unknown as QaWindow).__pegbreaker.renderer;
        let max = 0;
        const t0 = performance.now();
        const tick = (): void => {
          if (r.particleCount > max) max = r.particleCount;
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
          else resolve(max);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.locator('.card-fuse').first().click();
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS_DIR}/15-fusion-animation.png` });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS_DIR}/16-fusion-animation-fin.png` });
  const after = await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.sim.state.volley.length);
  expect(after, 'deux balles fusionnées en une').toBe(before - 1);
  expect(await page.evaluate(() => (window as unknown as QaWindow).__pegbreaker.eventCounts['volley:fusion'] ?? 0)).toBeGreaterThan(0);
  // la pulsation HUD n'existe plus : l'effet observable est côté renderer (particules de l'animation de fusion)
  const pcPeak = await peak;
  test.info().annotations.push({ type: 'fusion', description: JSON.stringify({ seed: found, particlesBefore: pc0, particlesPeak: pcPeak }) });
  expect(pcPeak, 'volley:fusion → particules émises par le renderer').toBeGreaterThan(pc0);
  expect(errors).toEqual([]);
});
