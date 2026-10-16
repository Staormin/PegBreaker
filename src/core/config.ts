// core/config.ts — propriétaire : architecte. Charge et valide la config JSON.
import type { GameConfig } from './types';
import balls from '../config/balls.json';
import blocks from '../config/blocks.json';
import waves from '../config/waves.json';
import relics from '../config/relics.json';
import economy from '../config/economy.json';
import meta from '../config/meta.json';
import contracts from '../config/contracts.json';

function req(obj: unknown, path: string[], file: string): void {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object' || !(key in (cur as Record<string, unknown>))) {
      throw new Error(`config/${file}.json : clé manquante "${path.join('.')}"`);
    }
    cur = (cur as Record<string, unknown>)[key];
  }
}

export function validateConfig(c: GameConfig): GameConfig {
  req(c.balls, ['defs'], 'balls');
  req(c.balls, ['tierDamageMultiplier'], 'balls');
  req(c.balls, ['comboMilestones'], 'balls');
  req(c.blocks, ['board', 'cols'], 'blocks');
  req(c.blocks, ['board', 'rows'], 'blocks');
  req(c.blocks, ['board', 'ballRadius'], 'blocks');
  req(c.blocks, ['board', 'ballSpeed'], 'blocks');
  req(c.blocks, ['drops', 'weights'], 'blocks');
  req(c.waves, ['baseHp'], 'waves');
  req(c.waves, ['growthPerWave'], 'waves');
  req(c.waves, ['densityByWave'], 'waves');
  req(c.waves, ['start', 'elements'], 'waves');
  req(c.relics, ['defs'], 'relics');
  req(c.economy, ['shop', 'prices'], 'economy');
  req(c.economy, ['score'], 'economy');
  req(c.meta, ['nodes'], 'meta');
  req(c.contracts, ['defs'], 'contracts');
  req(c.economy, ['revive', 'cost'], 'economy');
  if (!c.balls.defs.some((d) => d.id === 'stone')) throw new Error('config/balls.json : "stone" obligatoire');
  const maxSpeedMult = Math.max(1, ...Object.values(c.waves.runModEffects ?? {}).map((e) => e.ballSpeedMult ?? 1));
  if ((c.blocks.board.ballSpeed * maxSpeedMult) / 240 > c.blocks.board.ballRadius) {
    throw new Error('config/blocks.json : ballSpeed trop élevée pour le sous-pas de 240 Hz (tunneling)');
  }
  return c;
}

export function loadConfig(): GameConfig {
  return validateConfig({
    balls: balls as unknown as GameConfig['balls'],
    blocks: blocks as unknown as GameConfig['blocks'],
    waves: waves as unknown as GameConfig['waves'],
    relics: relics as unknown as GameConfig['relics'],
    economy: economy as unknown as GameConfig['economy'],
    meta: meta as unknown as GameConfig['meta'],
    contracts: contracts as unknown as GameConfig['contracts'],
  });
}
