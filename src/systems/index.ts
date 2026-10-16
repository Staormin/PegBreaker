// systems/index.ts — createMeta(storage, config, now?): MetaSystem.
// Sauvegarde versionnée, le Puits (méta), succès, défi quotidien, stats globales.
//
// `data` : vue en lecture seule de l'objet interne. Stratégie copy-on-write : chaque
// mutation remplace l'objet racine (et les sections touchées) par de nouveaux objets gelés
// (Object.freeze superficiel par section, cf. save.freezeSave). Une référence obtenue via
// `data` n'est donc jamais modifiée sous les pieds de l'appelant, et l'UI peut détecter un
// changement par comparaison de références (`meta.data !== prev`). Pas de copie par lecture.
// Exception : `currentRun` (snapshot de la sim) n'est pas gelé.
import type { DailyResult, GameConfig, MetaModifiers, MetaSystem, RunSnapshot, RunSummary, SaveData, Settings } from '../core/types';
import { checkAchievements } from './achievements';
import { dailySeedFor, dateKey, pickDailyMods, recordDaily, streakAt, streakMultiplier } from './daily';
import { availableRunMods, canBuy, computeModifiers, findNode, nextCost, nodeLevel, normalizeMeta } from './meta';
import { BACKUP_KEY, SAVE_KEY, clamp01, defaultSave, freezeSave, parseMusicTrack, parseSave } from './save';
import { applyRunStats } from './stats';
import { safeGet, safeRemove, safeSet, type StorageLike } from './storage';

export type { StorageLike } from './storage';
export { createMemoryStorage } from './storage';
export { SAVE_KEY, BACKUP_KEY } from './save';
export { effectiveFragmentMultiplier, availableRunMods, nextCost } from './meta';

/**
 * Coût de la seconde chance pour l'UI (à débiter via spendFragments avant sim.revive()).
 * Gratuit pendant la toute première run si economy.revive.freeOnFirstRun : stats.runs
 * n'est incrémenté qu'en fin de run, donc la run 1 reste « première » même après revanche.
 */
export function reviveCost(meta: Pick<MetaSystem, 'data'>, config: GameConfig): number {
  const r = config.economy.revive;
  return r.freeOnFirstRun && meta.data.stats.runs === 0 ? 0 : r.cost;
}

/** Crée le système méta et charge immédiatement la sauvegarde (load() reste rappelable). */
export function createMeta(storage: StorageLike, config: GameConfig, now: () => Date = () => new Date()): MetaSystem {
  let d: Readonly<SaveData> = freezeSave(withNormalizedMeta(defaultSave()));

  function withNormalizedMeta(s: SaveData): SaveData {
    return { ...s, meta: normalizeMeta(s.meta, config, s.achievements) };
  }

  function commit(next: SaveData, persist = true): void {
    d = freezeSave(next);
    if (persist) save();
  }

  function save(): void {
    safeSet(storage, SAVE_KEY, JSON.stringify(d));
  }

  function load(): void {
    const raw = safeGet(storage, SAVE_KEY);
    const res = parseSave(raw);
    if (res.ok) {
      commit(withNormalizedMeta(res.data), false);
      return;
    }
    if (res.reason !== 'missing' && raw !== null) {
      // Sauvegarde illisible ou d'une version inconnue : « renommée » en backup.
      // On ne supprime l'original que si la copie a réussi (pas de perte en cas de quota).
      if (safeSet(storage, BACKUP_KEY, raw)) safeRemove(storage, SAVE_KEY);
    }
    commit(withNormalizedMeta(defaultSave()), false);
  }

  function getModifiers(): MetaModifiers {
    return computeModifiers(d.meta, config, d.achievements);
  }

  function canBuyNode(nodeId: string): boolean {
    return canBuy(d.meta, config, nodeId);
  }

  function buyNode(nodeId: string): boolean {
    const node = findNode(config, nodeId);
    if (!node || !canBuy(d.meta, config, nodeId)) return false;
    const lvl = nodeLevel(d.meta, nodeId);
    const cost = nextCost(node, lvl) ?? 0;
    const meta = normalizeMeta({ ...d.meta, fragments: d.meta.fragments - cost, nodes: { ...d.meta.nodes, [nodeId]: lvl + 1 } }, config, d.achievements);
    commit({ ...d, meta });
    return true;
  }

  function toggleRunMod(id: string): void {
    if (!availableRunMods(d.meta, config).includes(id)) return;
    const active = d.meta.activeRunMods.includes(id) ? d.meta.activeRunMods.filter((m) => m !== id) : [...d.meta.activeRunMods, id];
    commit({ ...d, meta: { ...d.meta, activeRunMods: active } });
  }

  function spendFragments(amount: number): boolean {
    if (!Number.isFinite(amount) || amount < 0 || d.meta.fragments < amount) return false;
    if (amount === 0) return true; // rien à débiter : pas d'écriture, référence `data` inchangée
    commit({ ...d, meta: { ...d.meta, fragments: d.meta.fragments - amount } });
    return true;
  }

  // Une run reprise par seconde chance reste UNE run : la sim n'émet 'run:over' (donc
  // l'UI n'appelle onRunEnd) qu'une fois, après giveUp ou la mort définitive ; 'run:lost'
  // et 'run:revived' ne touchent pas aux stats. summary.revivesUsed sert aux succès.
  function onRunEnd(summary: RunSummary): string[] {
    let earned = Math.max(0, Math.round(summary.stats.fragmentsEarned));
    let daily: Record<string, DailyResult> = d.daily;
    if (summary.isDaily) {
      // Série calculée APRÈS enregistrement du jour ; bonus de série sur les ◆ de la run seulement
      // (pas sur les récompenses de succès).
      const date = summary.dailyDate ?? todayKey();
      daily = recordDaily(daily, date, { depth: summary.depth, score: summary.score, completedAt: now().toISOString(), mods: dailyMods(date) });
      // Série comptée sur l'historique élagué (30 dates) : cohérente avec dailyStreak().
      const streak = streakAt(daily, date);
      const rec = daily[date];
      if (rec) daily[date] = { ...rec, streak };
      earned = Math.round(earned * streakMultiplier(streak));
    }
    const stats = applyRunStats(d.stats, summary);
    const unlocked = checkAchievements(config.meta.achievements, d.achievements, { summary, stats });
    let bonus = 0;
    for (const id of unlocked) bonus += config.meta.achievements.find((a) => a.id === id)?.rewardFragments ?? 0;
    stats.totalFragments += earned + bonus;
    // Succès `unlocksElement` (nova, comet, lucky) : l'élément entre dans unlockedElements
    // via normalizeMeta (source = liste des succès).
    const achievements = [...d.achievements, ...unlocked];
    commit({
      ...d,
      meta: normalizeMeta({ ...d.meta, fragments: d.meta.fragments + earned + bonus }, config, achievements),
      stats,
      achievements,
      daily,
      currentRun: null,
    });
    return unlocked;
  }

  function setCurrentRun(snapshot: RunSnapshot | null): void {
    commit({ ...d, currentRun: snapshot });
  }

  function updateSettings(patch: Partial<Settings>): void {
    const s: Settings = { ...d.settings };
    if (typeof patch.sfx === 'number' && Number.isFinite(patch.sfx)) s.sfx = clamp01(patch.sfx);
    if (typeof patch.music === 'number' && Number.isFinite(patch.music)) s.music = clamp01(patch.music);
    if (patch.musicTrack !== undefined) s.musicTrack = parseMusicTrack(patch.musicTrack);
    commit({ ...d, settings: s });
  }

  function setOnboarded(): void {
    if (d.onboarded) return;
    commit({ ...d, onboarded: true });
  }

  function todayKey(): string {
    return dateKey(now());
  }

  function dailySeed(date: string = todayKey()): string {
    return dailySeedFor(date);
  }

  function dailyMods(date: string = todayKey()): string[] {
    return pickDailyMods(config.meta.runMods, date);
  }

  function dailyStreak(date: string = todayKey()): number {
    return streakAt(d.daily, date);
  }

  function reset(): void {
    safeRemove(storage, SAVE_KEY);
    load();
  }

  load();

  return {
    get data() {
      return d;
    },
    load,
    save,
    getModifiers,
    onRunEnd,
    buyNode,
    spendFragments,
    canBuyNode,
    toggleRunMod,
    setCurrentRun,
    updateSettings,
    setOnboarded,
    dailySeed,
    dailyMods,
    dailyStreak,
    dailyStreakMultiplier: streakMultiplier,
    todayKey,
    reset,
  };
}
