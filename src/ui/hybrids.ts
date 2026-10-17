// ui/hybrids.ts — présentation des hybrides et de la Divine (docs/HYBRIDS.md) : effet propre
// (formulé depuis `BallDef.params` de balls.json, au rang demandé), prix de vente, coût
// d'upgrade, liste et indices du codex. Fonctions pures (testables sans DOM).
import type { BallDef, BallElement, BallTier, GameConfig, VolleyBall } from '../core/types';
import { clip } from './dom';
import { elementTable, FAMILY_SINGULAR } from './elements';

const num = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');
const pct = (r: number): string => `${num(r * 100)} %`;

function defOf(config: GameConfig, e: BallElement): BallDef | undefined {
  return config.balls.defs.find((d) => d.id === e);
}

/** valeur d'un paramètre au rang `tier` (0 si absent) */
function param(def: BallDef | undefined, key: string, tier: BallTier): number {
  return def?.params?.[key]?.[tier - 1] ?? 0;
}

type Fmt = (p: (k: string) => number) => string;
/** effet propre par hybride (≤ 60 caractères) ; repli : description de la balle */
const OWN_EFFECT: Partial<Record<BallElement, Fmt>> = {
  steam: (p) => `Nuage : ${pct(p('cloudRatio'))} aux voisins + gel, ${p('cloudsPerShot')}/tir`,
  laser: (p) => `Le rayon frappe toute la colonne : ${pct(p('colRatio'))}`,
  cluster: (p) => `${p('count')} mini-bombes au sol (×${num(p('miniMult'))})`,
  wraith: (p) => `Traverse tout, +${num(p('perBlockPct'))} % par bloc (max ${p('capBlocks')})`,
  abyss: (p) => `Acide propagé à ${p('spread')} voisin(s), max ${p('capPerTurn')}/tour`,
  jackpot: (p) => `Crit ×${num(p('critMult'))} + pièce, fragment ${pct(p('fragChance'))}`,
  quake: (p) => `La rangée touchée recule d'une case, ${p('rowsPerShot')}×/tir`,
  missile: (p) => `+${num(p('accelPct'))} %/rebond (max ×${num(p('maxSpeedMult'))}), explose au ${p('explodeAtBounce')}e`,
  supernova: (p) => `Explosion à chaque palier : combo ×${p('comboMult')}`,
  plague: (p) => `Bloc rongé détruit : +1 PV (${p('healPerShot')}/tir), contagion ${p('spread')}`,
  choir: (p) => `${p('count')} balles miroirs, repartent du sol à ${pct(p('echoRatio'))}`,
  orbit: (p) => `${p('returns')} allers-retours, aimant ${num(p('magnetRadius'))} u, +${num(p('returnBonusPct'))} %`,
  hammer: (p) => `Dégâts ×${num(p('damageMult'))}, −${num(p('pctMaxHp'))} % PV max, repousse`,
  divine: (p) => `Nova à chaque rebond (${p('novaDamage')}), Jugement ${p('judgement')}`,
};

/** « effet propre » d'une hybride / de la Divine au rang `tier` (≤ 60 caractères) */
export function ownEffect(config: GameConfig, e: BallElement, tier: BallTier = 1): string {
  const def = defOf(config, e);
  const f = OWN_EFFECT[e];
  if (f && def?.params) return clip(f((k) => param(def, k, tier)));
  return clip(def?.description ?? '');
}

export function isForged(config: GameConfig, e: BallElement): boolean {
  const f = elementTable(config).get(e).family;
  return f === 'hybrid' || f === 'divine';
}

/** pièces rendues par la vente d'une balle (economy.sell) */
export function sellPrice(config: GameConfig, b: Readonly<VolleyBall>): number {
  const sell = config.economy.sell;
  if (!sell) return 0;
  const f = elementTable(config).get(b.element).family;
  if (f === 'divine') return sell.divine;
  const table = f === 'hybrid' ? sell.hybridByTier : sell.byTier;
  return table[b.tier - 1] ?? 0;
}

/** coût de l'upgrade d'une hybride (null si impossible : pas hybride, ou déjà rang III) */
export function upgradeCost(config: GameConfig, b: Readonly<VolleyBall>): number | null {
  const forge = config.economy.forge;
  if (!forge || b.tier >= 3) return null;
  if (elementTable(config).get(b.element).family !== 'hybrid') return null;
  return forge.upgradeCost[b.tier - 1] ?? null;
}

/** entrées du codex : les hybrides (ordre du JSON) puis la Divine */
export function codexEntries(config: GameConfig): BallElement[] {
  const t = elementTable(config);
  const hybrids = t.list.filter((i) => i.family === 'hybrid').map((i) => i.id);
  const divine = t.list.filter((i) => i.family === 'divine').map((i) => i.id);
  return [...hybrids, ...divine];
}

/** indice d'une recette inconnue : familles des parents (« élémentaire + élémentaire ») */
export function recipeHint(config: GameConfig, e: BallElement): string {
  const t = elementTable(config);
  const info = t.get(e);
  if (info.family === 'divine' || !info.recipe) return 'hybride III + hybride III';
  return `${FAMILY_SINGULAR[t.get(info.recipe[0]).family]} + ${FAMILY_SINGULAR[t.get(info.recipe[1]).family]}`;
}

/** « Feu III + Glace III » ou, pour la Divine, « Hybride III + Hybride III » */
export function recipeLabel(config: GameConfig, e: BallElement): string {
  const t = elementTable(config);
  const info = t.get(e);
  if (!info.recipe) return 'Hybride III + Hybride III';
  return `${t.get(info.recipe[0]).name} III + ${t.get(info.recipe[1]).name} III`;
}

/** Catalyseur (ShopItem.catalyst) : recette dont `element` est un parent, de préférence celle
 *  dont l'autre parent est dans la volée (rang le plus haut d'abord). null si aucune recette. */
export function catalystRecipe(
  config: GameConfig,
  element: BallElement,
  volley: readonly Readonly<VolleyBall>[],
): { partner: BallElement; result: BallElement } | null {
  let best: { partner: BallElement; result: BallElement; score: number } | null = null;
  for (const info of elementTable(config).list) {
    const r = info.recipe;
    if (!r || (r[0] !== element && r[1] !== element)) continue;
    const partner = r[0] === element ? r[1] : r[0];
    let score = 0;
    for (const b of volley) if (b.element === partner) score = Math.max(score, b.tier);
    if (!best || score > best.score) best = { partner, result: info.id, score };
  }
  return best ? { partner: best.partner, result: best.result } : null;
}
