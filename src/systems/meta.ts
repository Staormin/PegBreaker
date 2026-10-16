// systems/meta.ts — le Puits : effets des nœuds, achat, calcul des MetaModifiers.
import type { BallElement, GameConfig, MetaModifiers, MetaNode, MetaState } from '../core/types';

/** Clés numériques de MetaModifiers qu'un nœud peut augmenter. */
type NumericKey = 'bonusHp' | 'bonusStartBalls' | 'coinMultiplier' | 'fragmentMultiplier' | 'freeRerolls';
const NUMERIC_KEYS: readonly NumericKey[] = ['bonusHp', 'bonusStartBalls', 'coinMultiplier', 'fragmentMultiplier', 'freeRerolls'];

export type NodeEffect =
  | { kind: 'stat'; key: NumericKey }
  | { kind: 'element'; id: BallElement }
  | { kind: 'relic'; id: string }
  | { kind: 'runMod'; id: string }
  | { kind: 'unknown' };

export function parseEffect(effect: string, config: GameConfig): NodeEffect {
  if ((NUMERIC_KEYS as readonly string[]).includes(effect)) return { kind: 'stat', key: effect as NumericKey };
  const i = effect.indexOf(':');
  if (i < 0) return { kind: 'unknown' };
  const type = effect.slice(0, i);
  const id = effect.slice(i + 1);
  if (type === 'unlockElement') {
    const def = config.balls.defs.find((d) => d.id === id);
    return def ? { kind: 'element', id: def.id } : { kind: 'unknown' };
  }
  if (type === 'unlockRelic') return config.relics.defs.some((d) => d.id === id) ? { kind: 'relic', id } : { kind: 'unknown' };
  if (type === 'runMod') return config.meta.runMods.some((d) => d.id === id) ? { kind: 'runMod', id } : { kind: 'unknown' };
  return { kind: 'unknown' };
}

export function findNode(config: GameConfig, id: string): MetaNode | undefined {
  return config.meta.nodes.find((n) => n.id === id);
}

export function nodeLevel(meta: MetaState, id: string): number {
  return meta.nodes[id] ?? 0;
}

/** Coût du prochain niveau, ou null si niveau max atteint. */
export function nextCost(node: MetaNode, level: number): number | null {
  return level < node.costs.length ? (node.costs[level] ?? null) : null;
}

export function canBuy(meta: MetaState, config: GameConfig, nodeId: string): boolean {
  const node = findNode(config, nodeId);
  if (!node) return false;
  const cost = nextCost(node, nodeLevel(meta, nodeId));
  if (cost === null) return false;
  if (!node.requires.every((r) => nodeLevel(meta, r) >= 1)) return false;
  return meta.fragments >= cost;
}

/**
 * Relique verrouillable : référencée par au moins un nœud `unlockRelic:<id>`.
 * Les autres sont toujours débloquées (au J3, aucune n'est verrouillée).
 */
function lockableRelics(config: GameConfig): Set<string> {
  const s = new Set<string>();
  for (const n of config.meta.nodes) {
    const e = parseEffect(n.effect, config);
    if (e.kind === 'relic') s.add(e.id);
  }
  return s;
}

/**
 * Normalise un MetaState (nouvel objet) :
 * - nœuds de coût 0 sans prérequis achetés d'office (niveau 1) — ex. el_fire, el_lightning ;
 * - niveaux plafonnés à costs.length ;
 * - listes de déblocage = union(stocké, effets des nœuds achetés), 'stone' toujours présent,
 *   reliques non verrouillables toujours présentes ;
 * - activeRunMods restreint aux mods disponibles.
 */
export function normalizeMeta(meta: MetaState, config: GameConfig): MetaState {
  const nodes = { ...meta.nodes };
  for (const n of config.meta.nodes) {
    const lvl = nodes[n.id] ?? 0;
    if (lvl === 0 && n.costs[0] === 0 && n.requires.length === 0) nodes[n.id] = 1;
    else if (lvl > n.costs.length) nodes[n.id] = n.costs.length;
  }
  const elements = new Set<BallElement>(['stone', ...meta.unlockedElements]);
  const lockable = lockableRelics(config);
  const relics = new Set<string>(meta.unlockedRelics);
  for (const r of config.relics.defs) if (!lockable.has(r.id)) relics.add(r.id);
  const available = new Set<string>();
  for (const n of config.meta.nodes) {
    if ((nodes[n.id] ?? 0) < 1) continue;
    const e = parseEffect(n.effect, config);
    if (e.kind === 'element') elements.add(e.id);
    else if (e.kind === 'relic') relics.add(e.id);
    else if (e.kind === 'runMod') available.add(e.id);
  }
  // Ordre stable : ordre de la config (lisible, sauvegarde déterministe).
  return {
    fragments: meta.fragments,
    nodes,
    unlockedElements: config.balls.defs.map((d) => d.id).filter((id) => elements.has(id)),
    unlockedRelics: config.relics.defs.map((d) => d.id).filter((id) => relics.has(id)),
    activeRunMods: meta.activeRunMods.filter((id) => available.has(id)),
  };
}

/** Mods de run disponibles (nœud `runMod:<id>` acheté). */
export function availableRunMods(meta: MetaState, config: GameConfig): string[] {
  const out: string[] = [];
  for (const n of config.meta.nodes) {
    if (nodeLevel(meta, n.id) < 1) continue;
    const e = parseEffect(n.effect, config);
    if (e.kind === 'runMod' && !out.includes(e.id)) out.push(e.id);
  }
  return out;
}

/**
 * MetaModifiers pour createSim.
 * NOTE fragmentMultiplier : il ne contient QUE les bonus des nœuds du Puits. Les
 * multiplicateurs des mods de run actifs ne sont PAS repliés dedans, car la sim les
 * applique déjà elle-même (sim/machine.ts buildSummary : fragMult = meta.fragmentMultiplier
 * × Π runMods[id].fragmentMultiplier). Les replier ici les appliquerait deux fois.
 * Pour l'affichage, utiliser `effectiveFragmentMultiplier`.
 */
export function computeModifiers(meta: MetaState, config: GameConfig): MetaModifiers {
  const sums: Record<NumericKey, number> = { bonusHp: 0, bonusStartBalls: 0, coinMultiplier: 0, fragmentMultiplier: 0, freeRerolls: 0 };
  for (const n of config.meta.nodes) {
    const lvl = Math.min(nodeLevel(meta, n.id), n.costs.length);
    if (lvl < 1) continue;
    const e = parseEffect(n.effect, config);
    if (e.kind === 'stat') sums[e.key] += lvl * n.valuePerLevel;
  }
  const norm = normalizeMeta(meta, config);
  const r = (v: number): number => Math.round(v * 1e6) / 1e6; // évite 1.2000000000000002
  return {
    bonusHp: sums.bonusHp,
    bonusStartBalls: sums.bonusStartBalls,
    coinMultiplier: r(1 + sums.coinMultiplier), // multiplicateurs : 1 + somme des bonus
    fragmentMultiplier: r(1 + sums.fragmentMultiplier),
    freeRerolls: sums.freeRerolls,
    unlockedElements: norm.unlockedElements,
    unlockedRelics: norm.unlockedRelics,
    runMods: norm.activeRunMods,
  };
}

/** Multiplicateur de fragments réellement appliqué en fin de run (méta × mods actifs), pour l'UI. */
export function effectiveFragmentMultiplier(mods: MetaModifiers, config: GameConfig): number {
  let m = mods.fragmentMultiplier;
  for (const id of mods.runMods) m *= config.meta.runMods.find((d) => d.id === id)?.fragmentMultiplier ?? 1;
  return m;
}
