// sim/machine.ts — machine à états de la run :
// aiming → firing → advancing → (aiming | reward → [shop] → aiming de la vague suivante | gameover)
import type { Ball, BallElement, RunSummary } from '../core/types';
import type { Ctx } from './ctx';
import { emit } from './ctx';
import { createInternal, createStats, type SimState } from './state';
import { fuseVolley, launchNext } from './volley';
import { physicsStep, rebuildGrid } from './physics';
import { advanceRows, clearBoard, startWave, waveCleared } from './waves';
import { bossAfterAdvance, bossOnShotEnd } from './boss';
import { collectAllDrops } from './drops';
import { makeBossOptions, makeOptions, applyOption } from './rewards';
import { openShop } from './shop';
import { refreshRelics } from './relics';
import { compactBlocks, releaseBall, releaseBlock, releaseDrop } from './pools';
import { clampAim } from './aim';
import { contractOnFire, contractOnWaveEnd, contractSeed } from './contracts';
import { burnEmbers } from './combat';
import { hashString } from '../core/rng';
import { AUTO_SPEEDUP_RAMP_MS } from './constants';
import { modElement } from './mods';

/** Construit l'état initial d'une run et génère la vague 1. */
export function startRun(ctx: Ctx, seed: string, restarts: number): void {
  const cfg = ctx.cfg;
  const board = cfg.blocks.board;
  const meta = ctx.meta;
  ctx.rng.setState(hashString(seed) || 0x9e3779b9); // même amorçage que createRng(seed)
  let maxHp = cfg.waves.start.hp + meta.bonusHp;
  maxHp = Math.min(maxHp, ctx.mods.maxHp); // glass, rich (le plus petit plafond l'emporte)
  maxHp = Math.max(1, maxHp);
  const volley: { element: BallElement; tier: 1 }[] = [];
  const nStart = Math.max(1, cfg.waves.start.balls + meta.bonusStartBalls);
  for (let i = 0; i < nStart; i++) {
    const el = cfg.waves.start.elements[i] ?? 'stone';
    volley.push({ element: modElement(ctx.mods, el), tier: 1 });
  }
  const s: SimState = {
    seed,
    phase: 'aiming',
    wave: 1,
    shotInWave: 0,
    rowsLeftInWave: 0,
    depth: 0,
    hp: maxHp,
    maxHp,
    coins: 0,
    volley,
    balls: [],
    blocks: [],
    drops: [],
    relics: [],
    launchPos: { x: board.cols / 2, y: board.rows },
    aimDir: null,
    aimSpread: 0,
    contract: null,
    revivesUsed: 0,
    currentShotDamage: 0,
    currentShotCombo: 0,
    rewardOffer: null,
    shop: null,
    pendingLaunches: 0,
    advanceProgress: 0,
    stats: createStats(),
    rngState: 0,
    recallSpeed: 1,
    internal: createInternal(1),
  };
  s.internal.restarts = restarts;
  s.internal.contractRng = contractSeed(seed);
  ctx.s = s;
  ctx.spareBalls.length = 0;
  ctx.spareDrops.length = 0;
  ctx.spareBlocks.length = 0;
  refreshRelics(ctx);
  emit(ctx, { type: 'run:started', seed });
  fuseVolley(ctx);
  startWave(ctx);
  ctx.gridDirty = true;
}

/**
 * Ordre de départ. Éventail ouvert (spread > 0) : centré, indices triés par distance au centre, la gauche
 * d'abord à égalité (N = 5 → 2, 1, 3, 0, 4 ; N = 4 → 1, 2, 0, 3). Rafale serrée (spread = 0) : ordre de la
 * volée, toutes les balles ayant le même angle (garde le jeu à l'identique du tir sans éventail).
 * Dans les deux cas, la dernière balle lancée (la dorée) est l'indice N − 1.
 */
export function launchOrder(n: number, centered: boolean): number[] {
  const m = (n - 1) / 2;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  if (centered) order.sort((a, b) => Math.abs(a - m) - Math.abs(b - m) || a - b);
  return order;
}

/**
 * Éventail : la balle i de N part à base + maxSpreadDeg × spread × (2i/(N−1) − 1) (N = 1 : base).
 * Remplit launchQueue (ordre de départ) et launchDirs (directions alignées, angle minimal imposé).
 */
function planVolley(ctx: Ctx, dirX: number, dirY: number, spread: number): void {
  const s = ctx.s;
  const it = s.internal;
  const n = s.volley.length;
  const half = ((ctx.cfg.blocks.board.maxSpreadDeg * Math.PI) / 180) * spread;
  const order = launchOrder(n, spread > 0);
  it.launchQueue = [];
  it.launchDirs = [];
  for (const i of order) {
    const v = s.volley[i]!;
    it.launchQueue.push({ element: v.element, tier: v.tier });
    const a = n > 1 ? half * ((2 * i) / (n - 1) - 1) : 0;
    if (a === 0) {
      it.launchDirs.push(dirX, dirY); // exact : à spread 0, trajectoires identiques au tir sans éventail
    } else {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const d = clampAim(ctx, { x: dirX * c - dirY * sn, y: dirX * sn + dirY * c });
      it.launchDirs.push(d.x, d.y);
    }
  }
}

export function fire(ctx: Ctx): void {
  const s = ctx.s;
  if (s.phase !== 'aiming' || !s.aimDir || s.volley.length === 0) return;
  const it = s.internal;
  refreshRelics(ctx); // l'état a pu être modifié de l'extérieur (reprise, outils de debug)
  const spread = Number.isFinite(s.aimSpread) ? Math.min(1, Math.max(0, s.aimSpread)) : 0;
  planVolley(ctx, s.aimDir.x, s.aimDir.y, spread);
  it.launchTimer = 0;
  it.volleyElapsed = 0;
  it.originX = s.launchPos.x;
  it.dirX = s.aimDir.x;
  it.dirY = s.aimDir.y;
  it.firstGrounded = false;
  it.splitsThisShot = 0;
  it.firstbloodUsed = false;
  it.safetynetUsed = false;
  it.absorbElement = null;
  it.manualRecall = false;
  it.frozenThisShot = 0;
  if (it.radarUsed) it.radarUsed.length = 0;
  else it.radarUsed = [];
  s.pendingLaunches = it.launchQueue.length;
  s.currentShotDamage = 0;
  s.currentShotCombo = 0;
  s.recallSpeed = 1;
  s.depth++;
  s.stats.shots++;
  s.phase = 'firing';
  contractOnFire(ctx);
  burnEmbers(ctx); // pyromane : brûlure au début du tir suivant (comptée dans ce tir)
  if (ctx.blocksDied) compactBlocks(ctx);
  rebuildGrid(ctx);
  emit(ctx, {
    type: 'volley:start',
    count: s.pendingLaunches,
    from: { x: s.launchPos.x, y: s.launchPos.y },
    dir: { x: s.aimDir.x, y: s.aimDir.y },
    spread,
  });
}

export function recall(ctx: Ctx): void {
  if (ctx.s.phase !== 'firing') return;
  ctx.s.internal.manualRecall = true;
  ctx.s.recallSpeed = ctx.cfg.blocks.board.recallSpeed;
}

/** Accélération automatique : au-delà de autoSpeedupAfterMs, rampe linéaire 1 → recallSpeed sur AUTO_SPEEDUP_RAMP_MS. */
function autoSpeedup(ctx: Ctx): void {
  const s = ctx.s;
  const board = ctx.cfg.blocks.board;
  if (s.internal.manualRecall || !(board.autoSpeedupAfterMs > 0)) return;
  const over = s.internal.volleyElapsed - board.autoSpeedupAfterMs;
  if (over <= 0) return;
  const t = Math.min(1, over / AUTO_SPEEDUP_RAMP_MS);
  s.recallSpeed = 1 + (board.recallSpeed - 1) * t;
}

function endVolley(ctx: Ctx): void {
  const s = ctx.s;
  const rows = ctx.cfg.blocks.board.rows;
  // rappel forcé (maxVolleyMs) : les balles restantes rentrent
  for (let i = s.balls.length - 1; i >= 0; i--) {
    const b = s.balls[i] as Ball;
    emit(ctx, { type: 'ball:grounded', ballId: b.id, pos: { x: b.pos.x, y: rows } });
    releaseBall(ctx, i);
  }
  s.pendingLaunches = 0;
  s.recallSpeed = 1;
  if (s.currentShotDamage > s.stats.bestShotDamage) s.stats.bestShotDamage = s.currentShotDamage;
  if (s.currentShotCombo > s.stats.bestCombo) s.stats.bestCombo = s.currentShotCombo;
  emit(ctx, { type: 'volley:end', shotDamage: s.currentShotDamage, bestCombo: s.currentShotCombo });
  if (ctx.relic.magnet) collectAllDrops(ctx);
  bossOnShotEnd(ctx);
  s.shotInWave++;
  if (waveCleared(ctx)) {
    clearWave(ctx);
    return;
  }
  s.phase = 'advancing';
  s.advanceProgress = 0;
}

function finishAdvance(ctx: Ctx): void {
  const s = ctx.s;
  s.advanceProgress = 1;
  advanceRows(ctx);
  bossAfterAdvance(ctx);
  if (s.hp <= 0) {
    gameOver(ctx);
    return;
  }
  if (waveCleared(ctx)) {
    clearWave(ctx);
    return;
  }
  s.advanceProgress = 0;
  s.phase = 'aiming';
}

function clearWave(ctx: Ctx): void {
  const s = ctx.s;
  clearBoard(ctx); // chevilles restantes effacées
  collectAllDrops(ctx);
  s.internal.wavesCleared++;
  if (!s.internal.damagedThisWave) s.stats.perfectWaves = (s.stats.perfectWaves ?? 0) + 1;
  emit(ctx, { type: 'wave:cleared', wave: s.wave });
  contractOnWaveEnd(ctx);
  const source = s.internal.bossKilledThisWave ? 'boss' : 'wave';
  const count = ctx.cfg.economy.reward.optionCount;
  const offer = source === 'boss' ? makeBossOptions(ctx, count) : makeOptions(ctx, count, true, 'chance');
  s.rewardOffer = offer;
  s.phase = 'reward';
  s.advanceProgress = 0;
  // copie superficielle (pas de structuredClone dans step) : les options sont des objets plats
  emit(ctx, { type: 'reward:offered', options: offer.map((o) => ({ ...o })), source });
}

function afterReward(ctx: Ctx): void {
  const s = ctx.s;
  s.rewardOffer = null;
  const every = ctx.cfg.waves.shopEvery;
  if (every > 0 && s.wave % every === 0) openShop(ctx);
  else nextWave(ctx);
}

export function chooseReward(ctx: Ctx, index: number): void {
  const s = ctx.s;
  if (s.phase !== 'reward' || !s.rewardOffer) return;
  const o = s.rewardOffer[index];
  if (!o) return;
  applyOption(ctx, o);
  emit(ctx, { type: 'reward:chosen', option: structuredClone(o) });
  afterReward(ctx);
}

export function skipReward(ctx: Ctx): void {
  const s = ctx.s;
  if (s.phase !== 'reward') return;
  s.coins += ctx.cfg.economy.reward.skipCoins;
  emit(ctx, { type: 'reward:skipped' });
  afterReward(ctx);
}

export function leaveShop(ctx: Ctx): void {
  const s = ctx.s;
  if (s.phase !== 'shop') return;
  s.shop = null;
  emit(ctx, { type: 'shop:left' });
  nextWave(ctx);
}

function nextWave(ctx: Ctx): void {
  const s = ctx.s;
  s.wave++;
  clearBoard(ctx);
  startWave(ctx);
  s.phase = 'aiming';
}

export function buildSummary(ctx: Ctx): RunSummary {
  const s = ctx.s;
  const eco = ctx.cfg.economy;
  let fragMult = ctx.meta.fragmentMultiplier;
  for (const id of ctx.meta.runMods) {
    const def = ctx.cfg.meta.runMods.find((m) => m.id === id);
    if (def) fragMult *= def.fragmentMultiplier;
  }
  const f = eco.fragments;
  const earned =
    s.stats.fragmentsEarned +
    f.perWave * s.internal.wavesCleared +
    f.perBoss * s.stats.bossesKilled +
    f.perDepth * s.depth;
  const sc = eco.score;
  const score = Math.round(
    sc.perDepth * s.depth + sc.perBlock * s.stats.blocksDestroyed + sc.perDamage * s.stats.totalDamage + sc.perBoss * s.stats.bossesKilled,
  );
  const stats = { ...s.stats, fragmentsEarned: Math.round(earned * fragMult) };
  return {
    seed: s.seed,
    depth: s.depth,
    wave: s.wave,
    stats,
    relics: s.relics.slice(),
    volley: s.volley.map((v) => ({ element: v.element, tier: v.tier })),
    isDaily: ctx.isDaily,
    dailyDate: ctx.dailyDate,
    score,
    revivesUsed: s.revivesUsed ?? 0,
    contractsCompleted: s.stats.contractsCompleted ?? 0,
  };
}

function canRevive(ctx: Ctx): boolean {
  const s = ctx.s;
  return s.phase === 'gameover' && !s.internal.overEmitted && (s.revivesUsed ?? 0) < ctx.cfg.economy.revive.maxPerRun;
}

/** PV à 0 : phase gameover, run:lost. run:over n'est émis qu'à l'abandon (giveUp) ou au restart. */
function gameOver(ctx: Ctx): void {
  const s = ctx.s;
  s.phase = 'gameover';
  s.advanceProgress = 0;
  s.internal.overEmitted = false;
  emit(ctx, { type: 'run:lost', canRevive: canRevive(ctx), wave: s.wave, depth: s.depth });
}

/**
 * Seconde chance : PV = max(1, ceil(maxHp × hpRatio)), blocs et drops des `clearRows` rangées du bas
 * du plateau (au-dessus de la ligne du joueur) supprimés, boss compris ; retour en visée.
 */
export function revive(ctx: Ctx): boolean {
  if (!canRevive(ctx)) return false;
  const s = ctx.s;
  const r = ctx.cfg.economy.revive;
  const rows = ctx.cfg.blocks.board.rows;
  s.revivesUsed = (s.revivesUsed ?? 0) + 1;
  s.hp = Math.min(s.maxHp, Math.max(1, Math.ceil(s.maxHp * r.hpRatio)));
  const minRow = rows - 1 - Math.max(0, r.clearRows);
  for (let i = s.blocks.length - 1; i >= 0; i--) if ((s.blocks[i] as { row: number }).row >= minRow) releaseBlock(ctx, i);
  for (let i = s.drops.length - 1; i >= 0; i--) if ((s.drops[i] as { pos: { y: number } }).pos.y >= minRow) releaseDrop(ctx, i);
  ctx.gridDirty = true;
  s.phase = 'aiming';
  s.advanceProgress = 0;
  emit(ctx, { type: 'run:revived', hpLeft: s.hp, revivesUsed: s.revivesUsed });
  // plateau vidé et plus de rangée à venir : la vague est nettoyée tout de suite (pas de tir dans le vide)
  if (waveCleared(ctx)) clearWave(ctx);
  return true;
}

/** Abandon après run:lost : émet run:over une seule fois. */
export function giveUp(ctx: Ctx): void {
  const s = ctx.s;
  if (s.phase !== 'gameover' || s.internal.overEmitted) return;
  s.internal.overEmitted = true;
  const summary = buildSummary(ctx);
  s.stats.fragmentsEarned = summary.stats.fragmentsEarned;
  emit(ctx, { type: 'run:over', summary });
}

/** Un sous-pas de temps de jeu (dt ≤ SUBSTEP_MS). */
export function tick(ctx: Ctx, dt: number): void {
  const s = ctx.s;
  if (s.phase === 'gameover') return;
  s.stats.durationMs += dt;
  if (s.phase === 'firing') {
    const it = s.internal;
    it.volleyElapsed += dt;
    autoSpeedup(ctx);
    const board = ctx.cfg.blocks.board;
    const speed = Math.max(1, s.recallSpeed);
    const n = Math.ceil(speed - 1e-9);
    const sub = (dt * speed) / n;
    for (let k = 0; k < n; k++) {
      it.launchTimer -= sub;
      while (s.pendingLaunches > 0 && it.launchTimer <= 0) {
        launchNext(ctx);
        it.launchTimer += board.launchIntervalMs;
      }
      physicsStep(ctx, sub);
    }
    if ((s.balls.length === 0 && s.pendingLaunches === 0) || it.volleyElapsed >= board.maxVolleyMs) endVolley(ctx);
  } else if (s.phase === 'advancing') {
    const dur = ctx.cfg.blocks.board.advanceDurationMs;
    s.advanceProgress = dur > 0 ? Math.min(1, s.advanceProgress + dt / dur) : 1;
    if (s.advanceProgress >= 1) finishAdvance(ctx);
  }
}

