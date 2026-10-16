// sim/relics.ts — reliques : effets par id (relics.json → value).
import type { RelicDef, RelicId } from '../core/types';
import type { Ctx } from './ctx';

export function relicDef(ctx: Ctx, id: RelicId): RelicDef | undefined {
  for (const d of ctx.cfg.relics.defs) if (d.id === id) return d;
  return undefined;
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
  for (const id of ctx.s.relics) {
    const def = relicDef(ctx, id);
    if (!def) continue;
    switch (id) {
      case 'bouncy':
        r.bouncy += def.value;
        break;
      case 'piggy':
        r.piggy = def.value;
        break;
      case 'firstblood':
        r.firstblood = true;
        break;
      case 'bigboom':
        r.bigboom *= def.value;
        break;
      case 'safetynet':
        r.safetynet = true;
        break;
      case 'magnet':
        r.magnet = true;
        break;
      default:
        // relique inconnue du code (J4 : 20 reliques) : ignorée
        break;
    }
  }
}

export function addRelic(ctx: Ctx, id: RelicId): void {
  if (ctx.s.relics.includes(id)) return;
  ctx.s.relics.push(id);
  refreshRelics(ctx);
}
