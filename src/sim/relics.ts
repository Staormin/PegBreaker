// sim/relics.ts — reliques : effets par id (relics.json → value, params, requiresElement).
import type { BallElement, RelicDef, RelicId } from '../core/types';
import type { Ctx } from './ctx';

/**
 * Clés optionnelles ajoutées à relics.json (non typées dans core/types.ts, demande faite) :
 * - params : paramètres numériques supplémentaires quand `value` ne suffit pas ;
 * - requiresElement : relique proposée seulement si la volée contient cet élément.
 */
interface RelicExtra {
  params?: Record<string, number>;
  requiresElement?: BallElement;
}

export function relicDef(ctx: Ctx, id: RelicId): RelicDef | undefined {
  for (const d of ctx.cfg.relics.defs) if (d.id === id) return d;
  return undefined;
}

export function relicParam(def: RelicDef, key: string, fallback: number): number {
  const v = (def as RelicDef & RelicExtra).params?.[key];
  return typeof v === 'number' ? v : fallback;
}

export function relicRequiredElement(def: RelicDef): BallElement | undefined {
  return (def as RelicDef & RelicExtra).requiresElement;
}

/** Recalcule le cache des effets de reliques (à appeler après tout changement de state.relics). */
export function refreshRelics(ctx: Ctx): void {
  const r = ctx.relic;
  r.bouncy = 0;
  r.piggy = 0;
  r.firstblood = false;
  r.bigboom = 1;
  r.safetynet = false;
  r.magnet = false;
  r.ricochet = 0;
  r.pegCombo = 1;
  r.heartHeal = 1;
  r.coinMult = 1;
  r.pyroRadius = 1;
  r.emberRatio = 0;
  r.lightningChains = 1;
  r.frozenMult = 1;
  r.ghostCombo = 1;
  r.anvilRatio = 0;
  r.anvilRadius = 0;
  r.catalyst = 0;
  r.splitParts = 2;
  r.alchemy = 0;
  r.radar = 1;
  r.berserk = 0;
  for (const id of ctx.s.relics) {
    const def = relicDef(ctx, id);
    if (!def) continue;
    const v = def.value;
    switch (id) {
      case 'bouncy':
        r.bouncy += v;
        break;
      case 'piggy':
        r.piggy = v;
        break;
      case 'firstblood':
        r.firstblood = true;
        break;
      case 'bigboom':
        r.bigboom *= v;
        break;
      case 'safetynet':
        r.safetynet = true;
        break;
      case 'magnet':
        r.magnet = true;
        break;
      case 'ricochet':
        r.ricochet += v;
        break;
      case 'flipper':
        r.pegCombo = Math.max(r.pegCombo, v);
        break;
      case 'gourmand':
        r.heartHeal = Math.max(r.heartHeal, v);
        break;
      case 'pactole':
        r.coinMult *= v;
        break;
      case 'pyromane':
        r.pyroRadius *= relicParam(def, 'radiusMult', v);
        r.emberRatio = relicParam(def, 'emberRatio', 0);
        break;
      case 'paratonnerre':
        r.lightningChains = Math.max(r.lightningChains, Math.round(v));
        break;
      case 'permafrost':
        r.frozenMult *= v;
        break;
      case 'spectre':
        r.ghostCombo = Math.max(r.ghostCombo, v);
        break;
      case 'enclume':
        r.anvilRatio = v;
        r.anvilRadius = relicParam(def, 'radius', 0);
        break;
      case 'catalyseur':
        r.catalyst += v;
        break;
      case 'mitose':
        r.splitParts = Math.max(r.splitParts, Math.round(v));
        break;
      case 'alchimie':
        r.alchemy += Math.round(v);
        break;
      case 'radar':
        r.radar *= v;
        break;
      case 'berserk':
        r.berserk += v;
        break;
      default:
        break;
    }
  }
}

export function addRelic(ctx: Ctx, id: RelicId): void {
  if (ctx.s.relics.includes(id)) return;
  ctx.s.relics.push(id);
  refreshRelics(ctx);
}
