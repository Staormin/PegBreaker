// audio/audio.test.ts — propriétaire : audio-dev. Node (pas de WebAudio) : tout doit être inoffensif.
import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../core/events';
import type { GameEvent } from '../core/types';
import { createAudio } from './index';
import { bounceFreq } from './sfx';

const P = { x: 1, y: 1 };
const EVENTS: GameEvent[] = [
  { type: 'run:started', seed: 's' },
  { type: 'volley:start', count: 30, from: P, dir: P },
  { type: 'ball:bounce', ballId: 1, pos: P, normal: P, surface: 'block', combo: 40 },
  { type: 'block:hit', blockId: 1, pos: P, damage: 10, combo: 2, element: 'fire', hpLeft: 1, crit: true },
  { type: 'boss:spawned', bossId: 'b', blockId: 2 },
  { type: 'rows:advanced', wave: 5, newRow: true },
  { type: 'ui:click' },
  { type: 'run:over', summary: { seed: 's', depth: 1, wave: 1, stats: { shots: 0, blocksDestroyed: 0, bestCombo: 0, bestShotDamage: 0, totalDamage: 0, coinsEarned: 0, fragmentsEarned: 0, fusions: 0, bossesKilled: 0, durationMs: 0, perfectWaves: 0 }, relics: [], volley: [], isDaily: false, dailyDate: null, score: 0 } },
];

describe('audio sans WebAudio', () => {
  it('est inoffensif : unlock, volumes et événements ne lèvent rien et ne loguent rien', () => {
    const err = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const bus = createEventBus();
    const audio = createAudio(bus, { sfx: 0.8, music: 0.5 });
    expect(audio.unlocked).toBe(false);
    for (const e of EVENTS) bus.emit(e);
    audio.unlock();
    audio.setSfxVolume(0);
    audio.setMusicVolume(1);
    for (const e of EVENTS) bus.emit(e);
    expect(audio.unlocked).toBe(false);
    expect(audio.debug.engine.nodesCreated).toBe(0);
    expect(audio.debug.contextState).toBe('none');
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    audio.dispose();
  });

  it('pitch de rebond : un demi-ton par combo, plafonné à 24', () => {
    expect(bounceFreq(0)).toBeCloseTo(220);
    expect(bounceFreq(12)).toBeCloseTo(440);
    expect(bounceFreq(24)).toBeCloseTo(880);
    expect(bounceFreq(160)).toBeCloseTo(880);
  });
});
