// sim/contracts.ts — contrats de vague (contracts.json) : tirage, suivi, complétion, échec.
// Le tirage utilise un flux aléatoire dédié (internal.contractRng) : proposer ou non un contrat
// ne décale pas le flux principal (génération des rangées, drops, récompenses).
import type { BallElement, ContractDef, ContractKind } from '../core/types';
import type { Ctx } from './ctx';
import { emit } from './ctx';
import { applyOption } from './rewards';
import { hashString } from '../core/rng';

/** Amorce du flux des contrats pour une seed de run. */
export function contractSeed(seed: string): number {
  return hashString(`${seed}/contracts`) || 0x9e3779b9;
}

export function contractDef(ctx: Ctx, id: string): ContractDef | undefined {
  for (const d of ctx.cfg.contracts.defs) if (d.id === id) return d;
  return undefined;
}

function copyDef(d: ContractDef): ContractDef {
  return { ...d, reward: { ...d.reward } };
}

function eligible(ctx: Ctx, d: ContractDef): boolean {
  const s = ctx.s;
  if (d.weight <= 0 || d.minWave > s.wave || d.id === s.internal.lastContractId) return false;
  if (d.kind === 'killWithElement') {
    const el = d.element;
    if (!el || !s.volley.some((v) => v.element === el)) return false;
  }
  return true;
}

/**
 * Début de vague : avec `chance`, tire un contrat éligible (pondéré, minWave ≤ vague, différent de celui de la
 * vague précédente, killWithElement seulement si l'élément est dans la volée). Sinon contract = null.
 */
export function offerContract(ctx: Ctx): void {
  const s = ctx.s;
  const it = s.internal;
  const cc = ctx.cfg.contracts;
  s.contract = null;
  const rng = ctx.crng;
  rng.setState(it.contractRng);
  let picked: ContractDef | null = null;
  if (rng.chance(cc.chance)) {
    let total = 0;
    for (const d of cc.defs) if (eligible(ctx, d)) total += d.weight;
    if (total > 0) {
      let r = rng.next() * total;
      for (const d of cc.defs) {
        if (!eligible(ctx, d)) continue;
        r -= d.weight;
        if (r < 0) {
          picked = d;
          break;
        }
      }
    }
  }
  it.contractRng = rng.getState();
  if (!picked) {
    it.lastContractId = null; // « d'affilée » = vagues consécutives : une vague sans contrat rompt la série
    return;
  }
  it.lastContractId = picked.id;
  s.contract = { id: picked.id, progress: 0, target: picked.target, status: 'active' };
  emit(ctx, { type: 'contract:offered', contract: { ...s.contract }, def: copyDef(picked) });
}

/** Définition du contrat actif du kind demandé, sinon undefined. */
function active(ctx: Ctx, kind: ContractKind): ContractDef | undefined {
  const c = ctx.s.contract;
  if (!c || c.status !== 'active') return undefined;
  const d = contractDef(ctx, c.id);
  return d && d.kind === kind ? d : undefined;
}

function complete(ctx: Ctx, d: ContractDef): void {
  const s = ctx.s;
  const c = s.contract;
  if (!c || c.status !== 'active') return;
  c.status = 'done';
  s.stats.contractsCompleted = (s.stats.contractsCompleted ?? 0) + 1;
  emit(ctx, { type: 'contract:completed', def: copyDef(d), reward: { ...d.reward } });
  applyOption(ctx, d.reward);
}

function fail(ctx: Ctx, d: ContractDef): void {
  const c = ctx.s.contract;
  if (!c || c.status !== 'active') return;
  c.status = 'failed';
  emit(ctx, { type: 'contract:failed', def: copyDef(d) });
}

/** Fixe la progression ; émet contract:progress si elle change ; complète si progress ≥ target. */
function setProgress(ctx: Ctx, d: ContractDef, value: number, completes: boolean): void {
  const c = ctx.s.contract;
  if (!c || c.status !== 'active' || value === c.progress) return;
  c.progress = value;
  emit(ctx, { type: 'contract:progress', progress: c.progress, target: c.target });
  if (completes && c.progress >= c.target) complete(ctx, d);
}

/** Progression cumulative (collectCoins, collectBalls, killWithElement, goldenKill). */
export function contractAdd(ctx: Ctx, kind: ContractKind, amount: number): void {
  const d = active(ctx, kind);
  if (!d || amount <= 0) return;
  setProgress(ctx, d, (ctx.s.contract as { progress: number }).progress + amount, true);
}

/** Progression « record » (destroyInOneShot, reachCombo). */
export function contractMax(ctx: Ctx, kind: ContractKind, value: number): void {
  const d = active(ctx, kind);
  if (!d) return;
  const c = ctx.s.contract as { progress: number };
  if (value > c.progress) setProgress(ctx, d, value, true);
}

/** Début d'un tir : remise à zéro des compteurs par tir, décompte des tirs (clearUnderShots). */
export function contractOnFire(ctx: Ctx): void {
  const s = ctx.s;
  s.internal.shotKills = 0;
  const d = active(ctx, 'clearUnderShots');
  if (!d) return;
  setProgress(ctx, d, s.shotInWave + 1, false);
  const c = s.contract;
  if (c && c.progress > c.target) fail(ctx, d);
}

/** Un bloc vient d'être cassé par `element` (balle dorée si ctx.curGolden). */
export function contractOnKill(ctx: Ctx, element: BallElement): void {
  const c = ctx.s.contract;
  if (!c || c.status !== 'active') return;
  const it = ctx.s.internal;
  it.shotKills = (it.shotKills ?? 0) + 1;
  const d = contractDef(ctx, c.id);
  if (!d) return;
  switch (d.kind) {
    case 'destroyInOneShot':
      contractMax(ctx, 'destroyInOneShot', it.shotKills);
      break;
    case 'killWithElement':
      if (element === d.element) contractAdd(ctx, 'killWithElement', 1);
      break;
    case 'goldenKill':
      if (ctx.curGolden) contractAdd(ctx, 'goldenKill', 1);
      break;
    default:
      break;
  }
}

/** Le joueur perd des PV : noDamage échoue immédiatement (retour visuel sans attendre la fin de vague). */
export function contractOnDamage(ctx: Ctx): void {
  const d = active(ctx, 'noDamage');
  if (d) fail(ctx, d);
}

/** Fin de vague (vague nettoyée) : noDamage et clearUnderShots se valident, les autres contrats actifs échouent. */
export function contractOnWaveEnd(ctx: Ctx): void {
  const c = ctx.s.contract;
  if (!c || c.status !== 'active') return;
  const d = contractDef(ctx, c.id);
  if (!d) return;
  if (d.kind === 'noDamage') {
    if (ctx.s.internal.damagedThisWave) fail(ctx, d);
    else setProgress(ctx, d, 1, true);
    if (c.status === 'active') complete(ctx, d); // target > 1 mal configuré : on valide quand même
  } else if (d.kind === 'clearUnderShots') {
    if (c.progress <= c.target) complete(ctx, d);
    else fail(ctx, d);
  } else fail(ctx, d);
}
