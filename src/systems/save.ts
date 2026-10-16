// systems/save.ts — format SaveData v1 : défauts, lecture tolérante, gel superficiel.
import type { BallElement, DailyResult, GlobalStats, MetaState, RunSnapshot, SaveData, Settings } from '../core/types';

export const SAVE_KEY = 'pegbreaker.save.v1';
export const BACKUP_KEY = 'pegbreaker.save.backup';
export const SAVE_VERSION = 1;

export const DEFAULT_SETTINGS: Readonly<Settings> = { sfx: 0.8, music: 0.5 };

export function defaultStats(): GlobalStats {
  return { runs: 0, bestDepth: 0, bestWave: 0, bestCombo: 0, bestShotDamage: 0, bestScore: 0, totalFragments: 0, totalBlocks: 0 };
}

/** Les reliques non verrouillables (toutes au J3) sont ajoutées par meta.normalizeMeta. */
export function defaultMetaState(): MetaState {
  return {
    fragments: 0,
    nodes: {},
    unlockedElements: ['stone'],
    unlockedRelics: [],
    activeRunMods: [],
  };
}

/** Sauvegarde vierge (avant l'application des nœuds gratuits, faite par createMeta). */
export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    meta: defaultMetaState(),
    stats: defaultStats(),
    achievements: [],
    daily: {},
    currentRun: null,
    settings: { ...DEFAULT_SETTINGS },
    onboarded: false,
  };
}

export type ParseResult = { ok: true; data: SaveData } | { ok: false; reason: 'missing' | 'corrupt' | 'version' };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const uniq = <T>(a: readonly T[]): T[] => Array.from(new Set(a));

/** Merge superficiel typé : chaque clé du défaut est prise de `raw` si le type correspond. Clés inconnues ignorées. */
function mergeSection<T extends object>(def: T, raw: unknown): T {
  if (!isObj(raw)) return def;
  const out = { ...def } as Record<string, unknown>;
  for (const [k, dv] of Object.entries(def)) {
    const rv = raw[k];
    if (rv === undefined) continue;
    if (typeof dv === 'number' ? isNum(rv) : Array.isArray(dv) ? isStrArr(rv) : typeof dv === typeof rv && !Array.isArray(rv)) out[k] = rv;
  }
  return out as T;
}

function parseNodes(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (isNum(v) && v >= 0) out[k] = Math.floor(v);
  return out;
}

function parseDaily(raw: unknown): Record<string, DailyResult> {
  const out: Record<string, DailyResult> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isObj(v) || !isNum(v['depth']) || !isNum(v['score'])) continue;
    const r: DailyResult = { depth: v['depth'], score: v['score'], completedAt: typeof v['completedAt'] === 'string' ? v['completedAt'] : '' };
    if (isStrArr(v['mods'])) r.mods = [...v['mods']];
    if (isNum(v['streak'])) r.streak = Math.max(0, Math.floor(v['streak']));
    out[k] = r;
  }
  return out;
}

function parseRun(raw: unknown): RunSnapshot | null {
  // Contrôle léger : la sim valide le reste à la reprise.
  if (!isObj(raw) || typeof raw['seed'] !== 'string' || typeof raw['phase'] !== 'string' || !Array.isArray(raw['volley'])) return null;
  return raw as unknown as RunSnapshot;
}

/** Lecture tolérante d'une chaîne brute. Ne touche pas au stockage. */
export function parseSave(rawText: string | null): ParseResult {
  if (rawText === null) return { ok: false, reason: 'missing' };
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!isObj(raw)) return { ok: false, reason: 'corrupt' };
  if (raw['version'] !== SAVE_VERSION) return { ok: false, reason: 'version' };

  const def = defaultSave();
  const meta = mergeSection(def.meta, raw['meta']);
  meta.nodes = parseNodes(isObj(raw['meta']) ? raw['meta']['nodes'] : undefined);
  meta.fragments = Math.max(0, meta.fragments);
  meta.unlockedElements = uniq(meta.unlockedElements) as BallElement[];
  meta.unlockedRelics = uniq(meta.unlockedRelics);
  meta.activeRunMods = uniq(meta.activeRunMods);
  const settings = mergeSection(def.settings, raw['settings']);
  return {
    ok: true,
    data: {
      version: SAVE_VERSION,
      meta,
      stats: mergeSection(def.stats, raw['stats']),
      achievements: isStrArr(raw['achievements']) ? uniq(raw['achievements']) : [],
      daily: parseDaily(raw['daily']),
      currentRun: parseRun(raw['currentRun']),
      settings: { ...settings, sfx: clamp01(settings.sfx), music: clamp01(settings.music) },
      onboarded: raw['onboarded'] === true,
    },
  };
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Gel superficiel des sections (copy-on-write) : l'objet exposé par `MetaSystem.data` et
 * ses sections (meta, nodes, listes, stats, daily, settings) sont gelés. `currentRun` n'est
 * PAS gelé (snapshot de la sim, éventuellement repassé à createSim).
 */
export function freezeSave(d: SaveData): Readonly<SaveData> {
  Object.freeze(d.meta.nodes);
  Object.freeze(d.meta.unlockedElements);
  Object.freeze(d.meta.unlockedRelics);
  Object.freeze(d.meta.activeRunMods);
  Object.freeze(d.meta);
  Object.freeze(d.stats);
  Object.freeze(d.achievements);
  for (const v of Object.values(d.daily)) {
    if (v.mods) Object.freeze(v.mods);
    Object.freeze(v);
  }
  Object.freeze(d.daily);
  Object.freeze(d.settings);
  return Object.freeze(d);
}
