import { describe, expect, it } from 'vitest';
import { loadConfig } from '../core/config';
import type { GameConfig, MetaNode, RunSummary } from '../core/types';
import { BACKUP_KEY, SAVE_KEY, createMemoryStorage, createMeta, effectiveFragmentMultiplier, reviveCost, type StorageLike } from './index';

const cfg = (): GameConfig => structuredClone(loadConfig());
const fixedNow = (): Date => new Date(2026, 9, 16, 14, 30); // 16 oct. 2026, heure locale

function summary(over: Partial<RunSummary> = {}, stats: Partial<RunSummary['stats']> = {}): RunSummary {
  return {
    seed: 's',
    depth: 40,
    wave: 6,
    relics: [],
    volley: [{ element: 'stone', tier: 1 }],
    isDaily: false,
    dailyDate: null,
    score: 5000,
    revivesUsed: 0,
    contractsCompleted: 0,
    ...over,
    stats: {
      shots: 40,
      blocksDestroyed: 60,
      perfectWaves: 0,
      bestCombo: 5,
      bestShotDamage: 500,
      totalDamage: 8000,
      coinsEarned: 40,
      fragmentsEarned: 45,
      fusions: 0,
      bossesKilled: 0,
      contractsCompleted: 0,
      durationMs: 120000,
      ...stats,
    },
  };
}

function withFragments(storage: StorageLike, c: GameConfig, n: number): ReturnType<typeof createMeta> {
  const m = createMeta(storage, c, fixedNow);
  m.onRunEnd(summary({}, { fragmentsEarned: n }));
  return m;
}

describe('sauvegarde', () => {
  it('stockage vide → défauts, nœuds gratuits achetés, stone + fire + lightning, reliques sauf les 4 verrouillées', () => {
    const c = cfg();
    const st = createMemoryStorage();
    const m = createMeta(st, c, fixedNow);
    const d = m.data;
    expect(d.version).toBe(1);
    expect(d.meta.fragments).toBe(0);
    expect(d.meta.nodes).toEqual({ el_fire: 1, el_lightning: 1 });
    expect(d.meta.unlockedElements).toEqual(['stone', 'fire', 'lightning']);
    const locked = ['mitose', 'alchimie', 'radar', 'berserk'];
    expect(d.meta.unlockedRelics).toEqual(c.relics.defs.map((r) => r.id).filter((id) => !locked.includes(id)));
    expect(m.getModifiers().unlockedRelics).toEqual(d.meta.unlockedRelics);
    expect(d.stats.runs).toBe(0);
    expect(d.achievements).toEqual([]);
    expect(d.currentRun).toBeNull();
    expect(d.settings).toEqual({ sfx: 0.8, music: 0.5 });
    expect(d.onboarded).toBe(false);
    expect(st.getItem(SAVE_KEY)).toBeNull(); // load n'écrit pas
  });

  it('JSON corrompu → copié dans le backup, défauts chargés', () => {
    const st = createMemoryStorage();
    st.setItem(SAVE_KEY, '{oops');
    const m = createMeta(st, cfg(), fixedNow);
    expect(st.getItem(BACKUP_KEY)).toBe('{oops');
    expect(st.getItem(SAVE_KEY)).toBeNull();
    expect(m.data.meta.fragments).toBe(0);
  });

  it('JSON valide mais non objet → backup', () => {
    const st = createMemoryStorage();
    st.setItem(SAVE_KEY, '42');
    createMeta(st, cfg(), fixedNow);
    expect(st.getItem(BACKUP_KEY)).toBe('42');
  });

  it('version 99 → backup + défauts', () => {
    const st = createMemoryStorage();
    const raw = JSON.stringify({ version: 99, meta: { fragments: 999 } });
    st.setItem(SAVE_KEY, raw);
    const m = createMeta(st, cfg(), fixedNow);
    expect(st.getItem(BACKUP_KEY)).toBe(raw);
    expect(m.data.meta.fragments).toBe(0);
  });

  it('champs manquants ou mal typés → défauts par section, stone toujours présent', () => {
    const st = createMemoryStorage();
    st.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        meta: { fragments: 120, unlockedElements: ['fire'], nodes: { hp: 2, bogus: 'x' } },
        stats: { runs: 12, bestCombo: 'beaucoup' },
        settings: { sfx: 0.3, shake: false, reduceMotion: true }, // anciennes clés : ignorées
        daily: { '2026-10-15': { depth: 7, score: 1234 }, bad: 3 },
      }),
    );
    const m = createMeta(st, cfg(), fixedNow);
    const d = m.data;
    expect(st.getItem(BACKUP_KEY)).toBeNull();
    expect(d.meta.fragments).toBe(120);
    expect(d.meta.nodes).toEqual({ hp: 2, el_fire: 1, el_lightning: 1 });
    expect(d.meta.unlockedElements).toContain('stone');
    expect(d.meta.unlockedRelics.length).toBeGreaterThan(0);
    expect(d.meta.activeRunMods).toEqual([]);
    expect(d.stats.runs).toBe(12);
    expect(d.stats.bestCombo).toBe(0);
    expect(d.stats.totalBlocks).toBe(0);
    expect(d.settings).toEqual({ sfx: 0.3, music: 0.5 });
    expect(d.achievements).toEqual([]);
    expect(d.daily).toEqual({ '2026-10-15': { depth: 7, score: 1234, completedAt: '' } });
    expect(d.currentRun).toBeNull();
    expect(d.onboarded).toBe(false);
  });

  it('save/load idempotent (JSON.stringify égal)', () => {
    const c = cfg();
    const st = createMemoryStorage();
    const m = withFragments(st, c, 500);
    m.buyNode('hp');
    m.buyNode('mod_glass');
    m.toggleRunMod('glass');
    m.updateSettings({ music: 0.2 });
    m.setOnboarded();
    m.onRunEnd(summary({ isDaily: true, dailyDate: '2026-10-16' }, { bestCombo: 12 }));
    const first = st.getItem(SAVE_KEY);
    expect(first).toBe(JSON.stringify(m.data));
    const m2 = createMeta(st, c, fixedNow);
    expect(JSON.stringify(m2.data)).toBe(first);
    m2.save();
    expect(st.getItem(SAVE_KEY)).toBe(first);
    m2.load();
    expect(JSON.stringify(m2.data)).toBe(first);
  });

  it('data est gelé (copy-on-write) et une ancienne référence ne change pas', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    const before = m.data;
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.meta)).toBe(true);
    expect(Object.isFrozen(before.settings)).toBe(true);
    m.updateSettings({ sfx: 0.1 });
    expect(before.settings.sfx).toBe(0.8);
    expect(m.data.settings.sfx).toBe(0.1);
    expect(m.data).not.toBe(before);
  });

  it('setItem / getItem / removeItem qui lèvent ne cassent rien', () => {
    const c = cfg();
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('nope');
      },
    };
    const m = createMeta(broken, c, fixedNow);
    expect(() => {
      m.save();
      m.onRunEnd(summary({}, { fragmentsEarned: 100 }));
      m.buyNode('hp');
      m.setCurrentRun(null);
      m.updateSettings({ music: 0.1 });
      m.reset();
    }).not.toThrow();
    // quota seulement : l'état en mémoire reste cohérent
    const quota = createMemoryStorage();
    quota.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const q = createMeta(quota, c, fixedNow);
    q.onRunEnd(summary({}, { fragmentsEarned: 100 }));
    expect(q.buyNode('hp')).toBe(true);
    expect(q.data.meta.nodes['hp']).toBe(1);
  });

  it('backup impossible (quota) → la sauvegarde originale n est pas supprimée', () => {
    const st = createMemoryStorage();
    st.setItem(SAVE_KEY, '{oops');
    const set = st.setItem.bind(st);
    st.setItem = (k, v) => {
      if (k === BACKUP_KEY) throw new Error('QuotaExceededError');
      set(k, v);
    };
    createMeta(st, cfg(), fixedNow);
    expect(st.getItem(SAVE_KEY)).toBe('{oops');
  });

  it('setCurrentRun sauvegarde immédiatement ; reset efface la clé et recharge les défauts', () => {
    const st = createMemoryStorage();
    const m = withFragments(st, cfg(), 50);
    const snap = { seed: 'x', phase: 'aiming', volley: [], wave: 2 } as unknown as Parameters<typeof m.setCurrentRun>[0];
    m.setCurrentRun(snap);
    expect(JSON.parse(st.getItem(SAVE_KEY) ?? '{}').currentRun.seed).toBe('x');
    expect(createMeta(st, cfg(), fixedNow).data.currentRun?.wave).toBe(2);
    m.reset();
    expect(st.getItem(SAVE_KEY)).toBeNull();
    expect(m.data.meta.fragments).toBe(0);
    expect(m.data.currentRun).toBeNull();
  });

  it('updateSettings borne les volumes ; setOnboarded persiste', () => {
    const st = createMemoryStorage();
    const m = createMeta(st, cfg(), fixedNow);
    m.updateSettings({ sfx: 3, music: -1 });
    expect(m.data.settings).toEqual({ sfx: 1, music: 0 });
    m.setOnboarded();
    expect(createMeta(st, cfg(), fixedNow).data.onboarded).toBe(true);
  });
});

describe('modificateurs', () => {
  /** Config de test couvrant chaque type d'effet. */
  function effectConfig(): GameConfig {
    const c = cfg();
    const n = (id: string, effect: string, valuePerLevel: number, costs: number[], requires: string[] = []): MetaNode => ({
      id,
      branch: 'foundations',
      name: id,
      description: '',
      costs,
      effect,
      valuePerLevel,
      requires,
    });
    const relicId = c.relics.defs[0]?.id ?? 'bouncy';
    c.meta.nodes = [
      n('hp', 'bonusHp', 1, [1, 1, 1]),
      n('balls', 'bonusStartBalls', 1, [1, 1]),
      n('coins', 'coinMultiplier', 0.1, [1, 1, 1]),
      n('frag', 'fragmentMultiplier', 0.25, [1, 1]),
      n('reroll', 'freeRerolls', 1, [1]),
      n('el_fire', 'unlockElement:fire', 1, [0]),
      n('el_ghost', 'unlockElement:ghost', 1, [1]),
      n('relic', `unlockRelic:${relicId}`, 1, [1]),
      n('mod_glass', 'runMod:glass', 1, [1]),
      n('mod_rush', 'runMod:rush', 1, [1]),
      n('weird', 'notAKey', 5, [1]),
    ];
    return c;
  }

  it('rien acheté : neutre, stone + fire (nœud gratuit), relique verrouillable absente', () => {
    const c = effectConfig();
    const mods = createMeta(createMemoryStorage(), c, fixedNow).getModifiers();
    expect(mods).toEqual({
      bonusHp: 0,
      bonusStartBalls: 0,
      coinMultiplier: 1,
      fragmentMultiplier: 1,
      freeRerolls: 0,
      unlockedElements: ['stone', 'fire'],
      unlockedRelics: c.relics.defs.slice(1).map((r) => r.id),
      runMods: [],
    });
  });

  it('chaque type d effet : niveau × valuePerLevel, déblocages, runMods disponibles ET actifs', () => {
    const c = effectConfig();
    const m = withFragments(createMemoryStorage(), c, 100);
    for (const id of ['hp', 'hp', 'balls', 'coins', 'coins', 'coins', 'frag', 'frag', 'reroll', 'el_ghost', 'relic', 'mod_glass', 'mod_rush', 'weird'])
      expect(m.buyNode(id)).toBe(true);
    let mods = m.getModifiers();
    expect(mods.bonusHp).toBe(2);
    expect(mods.bonusStartBalls).toBe(1);
    expect(mods.coinMultiplier).toBe(1.3);
    expect(mods.fragmentMultiplier).toBe(1.5);
    expect(mods.freeRerolls).toBe(1);
    expect(mods.unlockedElements).toEqual(['stone', 'fire', 'ghost']);
    expect(mods.unlockedRelics).toEqual(c.relics.defs.map((r) => r.id));
    expect(mods.runMods).toEqual([]); // disponibles mais pas activés
    expect(m.data.meta.unlockedElements).toContain('ghost');

    m.toggleRunMod('glass');
    m.toggleRunMod('rush');
    mods = m.getModifiers();
    expect(mods.runMods).toEqual(['glass', 'rush']);
    // Les multiplicateurs des mods ne sont PAS repliés (la sim les applique déjà) :
    expect(mods.fragmentMultiplier).toBe(1.5);
    expect(effectiveFragmentMultiplier(mods, c)).toBeCloseTo(1.5 * 2 * 1.5);
    m.toggleRunMod('glass');
    expect(m.getModifiers().runMods).toEqual(['rush']);
  });

  it('toggleRunMod ignore un mod non disponible ; un activeRunMods sauvegardé sans le nœud est filtré', () => {
    const c = cfg();
    const st = createMemoryStorage();
    st.setItem(SAVE_KEY, JSON.stringify({ version: 1, meta: { activeRunMods: ['glass'] } }));
    const m = createMeta(st, c, fixedNow);
    expect(m.getModifiers().runMods).toEqual([]);
    m.toggleRunMod('rush');
    expect(m.data.meta.activeRunMods).toEqual([]);
  });
});

describe('buyNode', () => {
  it('coût, débit, niveau max', () => {
    const c = cfg();
    const hp = c.meta.nodes.find((n) => n.id === 'hp');
    if (!hp) throw new Error('hp');
    const total = hp.costs.reduce((a, b) => a + b, 0);
    const m = withFragments(createMemoryStorage(), c, total + 5);
    for (let i = 0; i < hp.costs.length; i++) expect(m.buyNode('hp')).toBe(true);
    expect(m.data.meta.nodes['hp']).toBe(hp.costs.length);
    expect(m.data.meta.fragments).toBe(5);
    expect(m.canBuyNode('hp')).toBe(false);
    expect(m.buyNode('hp')).toBe(false);
    expect(m.getModifiers().bonusHp).toBe(hp.costs.length * hp.valuePerLevel);
  });

  it('fragments insuffisants → false, rien débité', () => {
    const c = cfg();
    const cost = c.meta.nodes.find((n) => n.id === 'el_split')?.costs[0] ?? 0;
    const m = withFragments(createMemoryStorage(), c, cost - 1);
    expect(m.canBuyNode('el_split')).toBe(false);
    expect(m.buyNode('el_split')).toBe(false);
    expect(m.data.meta.fragments).toBe(cost - 1);
  });

  it('requires : el_ice exige el_split ; débloque split puis ice dans unlockedElements', () => {
    const c = cfg();
    const st = createMemoryStorage();
    const m = withFragments(st, c, 1000);
    expect(m.canBuyNode('el_ice')).toBe(false);
    expect(m.buyNode('el_ice')).toBe(false);
    expect(m.buyNode('el_split')).toBe(true);
    expect(m.buyNode('el_ice')).toBe(true);
    expect(m.data.meta.unlockedElements).toEqual(['stone', 'fire', 'lightning', 'ice', 'split']);
    expect(m.buyNode('nope')).toBe(false);
    // persisté
    expect(createMeta(st, c, fixedNow).data.meta.nodes['el_ice']).toBe(1);
  });
});

describe('onRunEnd', () => {
  it('fragments, stats globales, currentRun = null', () => {
    const st = createMemoryStorage();
    const m = createMeta(st, cfg(), fixedNow);
    m.setCurrentRun({ seed: 'x', phase: 'aiming', volley: [] } as unknown as Parameters<typeof m.setCurrentRun>[0]);
    const got = m.onRunEnd(summary({ depth: 30, wave: 4, score: 3000 }, { fragmentsEarned: 33, blocksDestroyed: 50, bestCombo: 4, bestShotDamage: 200 }));
    expect(got).toEqual([]);
    m.onRunEnd(summary({ depth: 20, wave: 5, score: 4000 }, { fragmentsEarned: 10, blocksDestroyed: 7, bestCombo: 2, bestShotDamage: 300 }));
    expect(m.data.meta.fragments).toBe(43);
    expect(m.data.stats).toEqual({
      runs: 2,
      bestDepth: 30,
      bestWave: 5,
      bestCombo: 4,
      bestShotDamage: 300,
      bestScore: 4000,
      totalFragments: 43,
      totalBlocks: 57,
    });
    expect(m.data.currentRun).toBeNull();
    expect(JSON.parse(st.getItem(SAVE_KEY) ?? '{}').stats.runs).toBe(2);
  });

  it('succès débloqués une seule fois, récompense créditée', () => {
    const c = cfg();
    const reward = (id: string): number => c.meta.achievements.find((a) => a.id === id)?.rewardFragments ?? NaN;
    const m = createMeta(createMemoryStorage(), c, fixedNow);
    const s = summary({ wave: 15, volley: [{ element: 'fire', tier: 3 }] }, { fragmentsEarned: 0, bestCombo: 50, bestShotDamage: 5000, bossesKilled: 1, fusions: 2 });
    const got = m.onRunEnd(s);
    expect(got).toEqual(['combo15', 'combo50', 'fusion2', 'fusion3', 'wave5', 'wave10', 'wave15', 'shot5000']);
    const sum = got.reduce((a, id) => a + reward(id), 0);
    expect(m.data.meta.fragments).toBe(sum);
    expect(m.data.stats.totalFragments).toBe(sum);
    expect(m.onRunEnd(s)).toEqual([]);
    expect(m.data.meta.fragments).toBe(sum);
    expect(m.data.achievements).toEqual(got);
  });

  it('seuils : combo 14, tir 4999, vague 9, prof 79, score 19999, rang 1 → rien ; balle de rang 2 → fusion2', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    expect(m.onRunEnd(summary({ wave: 9, depth: 79, score: 19999, relics: ['a', 'b', 'c', 'd', 'e'], volley: Array.from({ length: 23 }, () => ({ element: 'stone' as const, tier: 1 as const })) }, { bestCombo: 14, bestShotDamage: 4999 }))).toEqual([]);
    expect(m.onRunEnd(summary({ volley: [{ element: 'stone', tier: 2 }] }))).toEqual(['fusion2']);
  });

  it('perfectwave n est jamais débloqué (non mesurable depuis RunSummary)', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    m.onRunEnd(summary({ wave: 20 }, { bestCombo: 100, bossesKilled: 3 }));
    expect(m.data.achievements).not.toContain('perfectwave');
  });

  it('quotidien : meilleur score conservé, daily1 une fois', () => {
    const c = cfg();
    const m = createMeta(createMemoryStorage(), c, fixedNow);
    const daily1 = c.meta.achievements.find((a) => a.id === 'daily1')?.rewardFragments ?? NaN;
    expect(m.onRunEnd(summary({ isDaily: true, dailyDate: '2026-10-16', score: 2000, depth: 20 }, { fragmentsEarned: 10 }))).toEqual(['daily1']);
    expect(m.data.meta.fragments).toBe(10 + daily1);
    m.onRunEnd(summary({ isDaily: true, dailyDate: '2026-10-16', score: 1000, depth: 30 }, { fragmentsEarned: 10 }));
    expect(m.data.daily['2026-10-16']).toEqual({ depth: 20, score: 2000, completedAt: fixedNow().toISOString(), mods: m.dailyMods('2026-10-16'), streak: 1 });
    m.onRunEnd(summary({ isDaily: true, dailyDate: '2026-10-16', score: 3000, depth: 25 }, { fragmentsEarned: 10 }));
    expect(m.data.daily['2026-10-16']?.score).toBe(3000);
    m.onRunEnd(summary({ isDaily: false, score: 99999 }));
    expect(Object.keys(m.data.daily)).toEqual(['2026-10-16']);
    expect(m.data.achievements.filter((a) => a === 'daily1')).toHaveLength(1);
  });

  it('historique quotidien plafonné à 30 dates (les plus anciennes supprimées)', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    for (let i = 1; i <= 35; i++) {
      const date = `2026-${i <= 31 ? '08' : '09'}-${String(i <= 31 ? i : i - 31).padStart(2, '0')}`;
      m.onRunEnd(summary({ isDaily: true, dailyDate: date }));
    }
    const keys = Object.keys(m.data.daily).sort();
    expect(keys).toHaveLength(30);
    expect(keys[0]).toBe('2026-08-06');
  });
});

describe('succès J3 (condition déclarative + repli par id)', () => {
  it('perfectwave via perfectWaves, depth80, score20k, relic6, volley24', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    const got = m.onRunEnd(
      summary(
        { depth: 80, score: 20000, relics: ['a', 'b', 'c', 'd', 'e', 'f'], volley: Array.from({ length: 24 }, () => ({ element: 'stone' as const, tier: 1 as const })) },
        { perfectWaves: 1 },
      ),
    );
    expect(got).toEqual(['perfectwave', 'depth80', 'relic6', 'volley24', 'score20k']);
    expect(m.onRunEnd(summary({ relics: ['a', 'b', 'c', 'd', 'e'] }, { perfectWaves: 0 }))).toEqual([]);
  });

  it('la condition du JSON prime sur la table par id ; id sans condition ni règle → jamais', () => {
    const c = cfg();
    const relic6 = c.meta.achievements.find((a) => a.id === 'relic6');
    if (!relic6) throw new Error('relic6');
    relic6.condition = { stat: 'bestCombo', gte: 3 }; // remplace la règle « 6 reliques »
    c.meta.achievements.push({ id: 'mystery', name: '?', description: '', rewardFragments: 99 });
    const m = createMeta(createMemoryStorage(), c, fixedNow);
    expect(m.onRunEnd(summary({ relics: [] }, { bestCombo: 3 }))).toEqual(['relic6']);
  });

  it('une relique verrouillée est débloquée par son nœud (requires respectés)', () => {
    const c = cfg();
    const m = withFragments(createMemoryStorage(), c, 2000);
    expect(m.buyNode('rel_mitose')).toBe(false); // requiert el_split
    expect(m.buyNode('el_split')).toBe(true);
    expect(m.buyNode('rel_mitose')).toBe(true);
    expect(m.buyNode('rel_radar')).toBe(false); // requiert rel_alchimie
    expect(m.buyNode('rel_alchimie')).toBe(true);
    const r = m.getModifiers().unlockedRelics;
    expect(r).toContain('mitose');
    expect(r).toContain('alchimie');
    expect(r).not.toContain('radar');
    expect(r).not.toContain('berserk');
  });
});

describe('rythme des succès (QA J3-01)', () => {
  it('les succès faciles (combo15, fusion2, wave5, perfectwave) rapportent ≤ 50 ◆ au total', () => {
    const c = cfg();
    const easy = ['combo15', 'fusion2', 'wave5', 'perfectwave'];
    const sum = c.meta.achievements.filter((a) => easy.includes(a.id)).reduce((t, a) => t + a.rewardFragments, 0);
    expect(sum).toBeLessThanOrEqual(50);
  });
});

describe('quotidien', () => {
  it('todayKey local et dailySeed déterministe', () => {
    const m = createMeta(createMemoryStorage(), cfg(), () => new Date(2026, 0, 5, 23, 59));
    expect(m.todayKey()).toBe('2026-01-05');
    expect(m.dailySeed()).toBe('daily-2026-01-05');
    expect(m.dailySeed('2026-10-16')).toBe('daily-2026-10-16');
    expect(m.dailySeed('2026-10-16')).toBe(createMeta(createMemoryStorage(), cfg()).dailySeed('2026-10-16'));
  });
});

describe('spendFragments (seconde chance)', () => {
  it('débite et sauvegarde si suffisant', () => {
    const st = createMemoryStorage();
    const m = withFragments(st, cfg(), 40);
    expect(m.spendFragments(25)).toBe(true);
    expect(m.data.meta.fragments).toBe(15);
    expect(JSON.parse(st.getItem(SAVE_KEY) ?? '{}').meta.fragments).toBe(15);
    expect(m.data.stats.totalFragments).toBe(40); // le cumul gagné ne baisse pas
    expect(m.spendFragments(15)).toBe(true);
    expect(m.data.meta.fragments).toBe(0);
  });

  it('insuffisant, négatif ou NaN → false sans effet', () => {
    const st = createMemoryStorage();
    const m = withFragments(st, cfg(), 20);
    const before = m.data;
    const saved = st.getItem(SAVE_KEY);
    expect(m.spendFragments(21)).toBe(false);
    expect(m.spendFragments(-5)).toBe(false);
    expect(m.spendFragments(Number.NaN)).toBe(false);
    expect(m.spendFragments(Number.POSITIVE_INFINITY)).toBe(false);
    expect(m.data).toBe(before);
    expect(st.getItem(SAVE_KEY)).toBe(saved);
  });

  it('zéro → true sans effet, même à 0 fragment', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    const before = m.data;
    expect(m.spendFragments(0)).toBe(true);
    expect(m.data).toBe(before);
    expect(m.data.meta.fragments).toBe(0);
  });

  it('reviveCost : gratuit pendant la run 1 (si freeOnFirstRun), puis economy.revive.cost', () => {
    const c = cfg();
    const m = createMeta(createMemoryStorage(), c, fixedNow);
    expect(reviveCost(m, c)).toBe(c.economy.revive.freeOnFirstRun ? 0 : c.economy.revive.cost);
    m.onRunEnd(summary({ revivesUsed: 1 }));
    expect(reviveCost(m, c)).toBe(c.economy.revive.cost);
    c.economy.revive.freeOnFirstRun = false;
    expect(reviveCost(createMeta(createMemoryStorage(), c, fixedNow), c)).toBe(c.economy.revive.cost);
  });
});

describe('succès lot 1 : contrats et seconde chance', () => {
  it('contracts3 : 3 contrats réussis dans la même run (2 → rien)', () => {
    const c = cfg();
    const m = createMeta(createMemoryStorage(), c, fixedNow);
    expect(m.onRunEnd(summary({ contractsCompleted: 2 }, { contractsCompleted: 2 }))).toEqual([]);
    // pas de cumul entre runs : 2 + 2 ne suffit pas
    expect(m.onRunEnd(summary({ contractsCompleted: 2 }, { contractsCompleted: 2 }))).toEqual([]);
    const frags = m.data.meta.fragments;
    expect(m.onRunEnd(summary({ contractsCompleted: 3 }, { contractsCompleted: 3, fragmentsEarned: 0 }))).toEqual(['contracts3']);
    expect(m.data.meta.fragments).toBe(frags + (c.meta.achievements.find((a) => a.id === 'contracts3')?.rewardFragments ?? NaN));
    expect(m.onRunEnd(summary({ contractsCompleted: 5 }))).toEqual([]);
  });

  it('phoenix : vague ≥ 6 après une seconde chance ; sans revanche ou vague 5 → rien', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    expect(m.onRunEnd(summary({ wave: 9, revivesUsed: 0 }))).toEqual([]);
    expect(m.onRunEnd(summary({ wave: 5, revivesUsed: 1 }))).toEqual([]);
    expect(m.onRunEnd(summary({ wave: 6, revivesUsed: 1 }))).toEqual(['phoenix']);
    expect(m.onRunEnd(summary({ wave: 9, revivesUsed: 1 }))).toEqual([]);
  });

  it('résumé ancien sans revivesUsed / contractsCompleted : aucun succès lot 1, pas de crash', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    const s = summary({ wave: 7 }) as Partial<RunSummary>;
    delete s.revivesUsed;
    delete s.contractsCompleted;
    expect(m.onRunEnd(s as RunSummary)).toEqual([]);
  });

  it('une run reprise par seconde chance compte comme une seule run', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    m.onRunEnd(summary({ wave: 8, revivesUsed: 1 }, { fragmentsEarned: 30 }));
    expect(m.data.stats.runs).toBe(1);
    expect(m.data.stats.bestWave).toBe(8);
    expect(m.data.currentRun).toBeNull();
  });
});

describe('F8 : quotidien muté et série', () => {
  const dayKey = (i: number): string => {
    const t = new Date(Date.UTC(2026, 0, 1 + i));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  };

  it('dailyMods : 2 mods éligibles distincts, déterministes, variables selon la date', () => {
    const c = cfg();
    const eligible = c.meta.runMods.filter((r) => r.dailyEligible).map((r) => r.id);
    const m = createMeta(createMemoryStorage(), c, fixedNow);
    const other = createMeta(createMemoryStorage(), cfg(), fixedNow);
    const pairs = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const date = dayKey(i);
      const p = m.dailyMods(date);
      expect(p).toHaveLength(2);
      expect(p[0]).not.toBe(p[1]);
      for (const id of p) expect(eligible).toContain(id);
      expect(m.dailyMods(date)).toEqual(p);
      expect(other.dailyMods(date)).toEqual(p);
      pairs.add(p.join('+'));
    }
    expect(pairs.size).toBeGreaterThan(1);
    expect(m.dailyMods()).toEqual(m.dailyMods('2026-10-16')); // défaut : todayKey()
  });

  it('dailyMods : jamais glass + rich (sur 2 000 dates), mods non éligibles exclus', () => {
    const c = cfg();
    const m = createMeta(createMemoryStorage(), c, fixedNow);
    let glass = 0;
    let rich = 0;
    for (let i = 0; i < 2000; i++) {
      const p = m.dailyMods(dayKey(i));
      expect(p.includes('glass') && p.includes('rich')).toBe(false);
      if (p.includes('glass')) glass++;
      if (p.includes('rich')) rich++;
    }
    expect(glass).toBeGreaterThan(0);
    expect(rich).toBeGreaterThan(0);
    // seuls glass et rich éligibles → un seul mod (pas de paire contradictoire)
    const c2 = cfg();
    for (const r of c2.meta.runMods) r.dailyEligible = r.id === 'glass' || r.id === 'rich';
    const m2 = createMeta(createMemoryStorage(), c2, fixedNow);
    for (let i = 0; i < 20; i++) expect(m2.dailyMods(dayKey(i))).toHaveLength(1);
    const c3 = cfg();
    for (const r of c3.meta.runMods) r.dailyEligible = r.id !== 'glass';
    const m3 = createMeta(createMemoryStorage(), c3, fixedNow);
    for (let i = 0; i < 200; i++) expect(m3.dailyMods(dayKey(i))).not.toContain('glass');
  });

  it('dailyStreak : 0, 1, 3 jours consécutifs, depuis la veille si aujourd hui non joué, trou', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    expect(m.dailyStreak()).toBe(0);
    const play = (date: string): void => void m.onRunEnd(summary({ isDaily: true, dailyDate: date }));
    play('2026-10-14');
    expect(m.dailyStreak('2026-10-14')).toBe(1);
    expect(m.dailyStreak('2026-10-15')).toBe(1); // veille jouée, jour non joué : série en cours
    expect(m.dailyStreak('2026-10-16')).toBe(0); // ni le jour ni la veille
    play('2026-10-15');
    play('2026-10-16');
    expect(m.dailyStreak()).toBe(3);
    expect(m.data.daily['2026-10-16']?.streak).toBe(3);
    play('2026-10-18'); // trou le 17
    expect(m.dailyStreak('2026-10-18')).toBe(1);
    expect(m.dailyStreak('2026-10-17')).toBe(3);
    // passage de mois / d'année
    const q = createMeta(createMemoryStorage(), cfg(), fixedNow);
    for (const date of ['2025-12-30', '2025-12-31', '2026-01-01', '2026-02-28', '2026-03-01'])
      q.onRunEnd(summary({ isDaily: true, dailyDate: date }));
    expect(q.dailyStreak('2026-01-01')).toBe(3);
    expect(q.dailyStreak('2026-03-01')).toBe(2);
  });

  it('dailyStreakMultiplier : 1 + 0,1 × (série − 1), plafonné à 2', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    expect(m.dailyStreakMultiplier(0)).toBe(1);
    expect(m.dailyStreakMultiplier(1)).toBe(1);
    expect(m.dailyStreakMultiplier(2)).toBe(1.1);
    expect(m.dailyStreakMultiplier(3)).toBe(1.2);
    expect(m.dailyStreakMultiplier(11)).toBe(2);
    expect(m.dailyStreakMultiplier(30)).toBe(2);
    expect(m.dailyStreakMultiplier(Number.NaN)).toBe(1);
  });

  it('onRunEnd quotidien : ◆ de run × multiplicateur de série (arrondi), succès non multipliés, run normale inchangée', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    const gain = (s: RunSummary): number => {
      const before = m.data.meta.fragments;
      m.onRunEnd(s);
      return m.data.meta.fragments - before;
    };
    m.onRunEnd(summary({ isDaily: true, dailyDate: '2026-10-13' }, { fragmentsEarned: 0 })); // daily1 consommé
    expect(gain(summary({ isDaily: true, dailyDate: '2026-10-14' }, { fragmentsEarned: 45 }))).toBe(Math.round(45 * 1.1));
    expect(gain(summary({ isDaily: true, dailyDate: '2026-10-15' }, { fragmentsEarned: 45 }))).toBe(Math.round(45 * 1.2));
    expect(gain(summary({ isDaily: false }, { fragmentsEarned: 45 }))).toBe(45);
    // rejouer le même jour : série inchangée (3), toujours ×1,2
    expect(gain(summary({ isDaily: true, dailyDate: '2026-10-15', score: 1 }, { fragmentsEarned: 45 }))).toBe(54);
    expect(m.data.stats.totalFragments).toBe(m.data.meta.fragments + 0); // aucun achat : cumul = solde
  });

  it('meilleur score conservé mais mods et streak mis à jour', () => {
    const m = createMeta(createMemoryStorage(), cfg(), fixedNow);
    m.onRunEnd(summary({ isDaily: true, dailyDate: '2026-10-16', score: 5000, depth: 50 }));
    const first = m.data.daily['2026-10-16'];
    expect(first?.streak).toBe(1);
    m.onRunEnd(summary({ isDaily: true, dailyDate: '2026-10-15', score: 10 }));
    m.onRunEnd(summary({ isDaily: true, dailyDate: '2026-10-16', score: 100, depth: 5 }));
    const r = m.data.daily['2026-10-16'];
    expect(r?.score).toBe(5000);
    expect(r?.depth).toBe(50);
    expect(r?.completedAt).toBe(first?.completedAt);
    expect(r?.streak).toBe(2);
    expect(r?.mods).toEqual(m.dailyMods('2026-10-16'));
  });

  it('historique 30 jours conservé (série plafonnée par l historique), mods/streak relus de la sauvegarde', () => {
    const st = createMemoryStorage();
    const m = createMeta(st, cfg(), fixedNow);
    for (let i = 0; i < 40; i++) m.onRunEnd(summary({ isDaily: true, dailyDate: dayKey(i) }));
    const keys = Object.keys(m.data.daily).sort();
    expect(keys).toHaveLength(30);
    expect(keys[0]).toBe(dayKey(10));
    expect(m.dailyStreak(dayKey(39))).toBe(30);
    expect(m.data.daily[dayKey(39)]?.streak).toBe(30);
    const back = createMeta(st, cfg(), fixedNow);
    expect(back.data.daily).toEqual(m.data.daily);
    expect(back.data.daily[dayKey(39)]?.mods).toEqual(m.dailyMods(dayKey(39)));
    expect(Object.isFrozen(back.data.daily[dayKey(39)]?.mods)).toBe(true);
  });
});
