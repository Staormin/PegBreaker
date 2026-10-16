// =====================================================================
// core/types.ts — CONTRAT PARTAGÉ. Propriétaire : architecte.
// Aucun autre agent ne modifie ce fichier. Besoin d'un champ ? Demande-le
// dans ton rapport de fin de tâche, avec la justification.
// Unités : le plateau est en unités logiques (1 cellule = 1 unité).
// =====================================================================

export interface Vec2 {
  x: number;
  y: number;
}

// ----------------------------------------------------------------------
// Balles
// ----------------------------------------------------------------------

export type BallElement = 'stone' | 'fire' | 'lightning' | 'ice' | 'ghost' | 'lead' | 'split';
export type BallTier = 1 | 2 | 3;

/** Une balle dans la volée (inventaire du joueur), pas encore en vol. */
export interface VolleyBall {
  element: BallElement;
  tier: BallTier;
}

/** Une balle en vol. Objet poolé : réutilisé, jamais réalloué dans la boucle. */
export interface Ball {
  id: number;
  element: BallElement;
  tier: BallTier;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  /** rebonds consécutifs sur blocs/chevilles sans toucher le sol */
  combo: number;
  alive: boolean;
  /** pour 'split' : déjà divisée ? pour 'fire' : déjà explosé ? */
  triggered: boolean;
}

// ----------------------------------------------------------------------
// Blocs et drops
// ----------------------------------------------------------------------

export type BlockKind = 'normal' | 'armored' | 'explosive' | 'peg' | 'heart' | 'boss';

export interface Block {
  id: number;
  kind: BlockKind;
  /** colonne 0..cols-1 */
  col: number;
  /** rangée 0 = haut ; rows-1 = ligne du joueur (franchie = dégâts) */
  row: number;
  /** largeur en cellules (boss : plusieurs) */
  width: number;
  hp: number;
  maxHp: number;
  /** gelé : ne descend pas au prochain tour */
  frozen: boolean;
  /** 'armored' : face protégée, 'down' = seul le dessous est vulnérable */
  armorSide: 'none' | 'down';
  /** identifiant du pattern de boss (config waves.json) */
  bossId: string | null;
}

export type DropKind = 'coin' | 'ball' | 'fragment' | 'heart';

export interface Drop {
  id: number;
  kind: DropKind;
  pos: Vec2;
  value: number;
  /** pour 'ball' : élément donné */
  element: BallElement | null;
}

// ----------------------------------------------------------------------
// Récompenses, reliques, boutique
// ----------------------------------------------------------------------

export type RelicId = string;

export type RewardOption =
  | { kind: 'ball'; element: BallElement; tier: BallTier }
  | { kind: 'relic'; relicId: RelicId }
  | { kind: 'coins'; amount: number }
  | { kind: 'heal'; amount: number }
  /** fusionne deux balles (element, tier-1) de la volée en une (element, tier) */
  | { kind: 'fuse'; element: BallElement; tier: BallTier };

export interface ShopItem {
  option: RewardOption;
  price: number;
  sold: boolean;
}

export interface ShopState {
  items: ShopItem[];
  rerollCost: number;
  rerollsUsed: number;
}

// ----------------------------------------------------------------------
// État de la run
// ----------------------------------------------------------------------

export type RunPhase =
  | 'aiming' // le joueur vise ; fire() possible
  | 'firing' // volée en vol ; recall() possible
  | 'advancing' // blocs qui descendent (animation courte, ~250 ms)
  | 'reward' // choix 1/3
  | 'shop'
  | 'gameover';

export interface RunStats {
  shots: number;
  blocksDestroyed: number;
  bestCombo: number;
  bestShotDamage: number;
  totalDamage: number;
  coinsEarned: number;
  fragmentsEarned: number;
  fusions: number;
  bossesKilled: number;
  /** vagues nettoyées sans perdre de PV */
  perfectWaves: number;
  /** ms simulés */
  durationMs: number;
}

export interface RunState {
  seed: string;
  phase: RunPhase;
  /** vague courante, commence à 1 */
  wave: number;
  /** tir courant dans la vague, commence à 0 */
  shotInWave: number;
  /** rangées restant à faire apparaître dans la vague */
  rowsLeftInWave: number;
  /** profondeur totale = nombre de tirs effectués dans la run */
  depth: number;
  hp: number;
  maxHp: number;
  coins: number;
  volley: VolleyBall[];
  balls: Ball[];
  blocks: Block[];
  drops: Drop[];
  relics: RelicId[];
  /** point de départ de la prochaine volée (sur la ligne du joueur) */
  launchPos: Vec2;
  /** direction de visée normalisée (y < 0 = vers le haut), null si aucune */
  aimDir: Vec2 | null;
  /** dégâts cumulés du tir en cours (pour l'affichage) */
  currentShotDamage: number;
  /** combo max du tir en cours */
  currentShotCombo: number;
  rewardOffer: RewardOption[] | null;
  shop: ShopState | null;
  /** nombre de balles encore à lancer dans la rafale en cours */
  pendingLaunches: number;
  /** progression 0..1 de l'animation 'advancing' */
  advanceProgress: number;
  stats: RunStats;
  /** état du PRNG (uint32) pour la reprise */
  rngState: number;
  /** facteur de rappel (1 = normal, >1 = accéléré par recall()) */
  recallSpeed: number;
}

/** Instantané sérialisable d'une run : identique à RunState (pas de classes). */
export type RunSnapshot = RunState & { internal?: unknown };

// ----------------------------------------------------------------------
// Événements (la sim produit ; render, audio, ui, systems consomment)
// ----------------------------------------------------------------------

export type GameEvent =
  | { type: 'run:started'; seed: string }
  | { type: 'run:over'; summary: RunSummary }
  | { type: 'volley:start'; count: number; from: Vec2; dir: Vec2 }
  | { type: 'ball:launched'; ballId: number; element: BallElement; tier: BallTier; pos: Vec2 }
  | { type: 'ball:bounce'; ballId: number; pos: Vec2; normal: Vec2; surface: 'wall' | 'block' | 'peg'; combo: number }
  | { type: 'ball:grounded'; ballId: number; pos: Vec2 }
  | { type: 'block:hit'; blockId: number; pos: Vec2; damage: number; combo: number; element: BallElement; hpLeft: number; crit: boolean }
  | { type: 'block:destroyed'; blockId: number; kind: BlockKind; pos: Vec2; width: number; element: BallElement }
  | { type: 'block:frozen'; blockId: number; pos: Vec2 }
  | { type: 'block:explode'; pos: Vec2; radius: number; damage: number }
  | { type: 'block:breached'; blockId: number; kind: BlockKind; damage: number }
  | { type: 'lightning:chain'; from: Vec2; to: Vec2; damage: number }
  | { type: 'ball:split'; pos: Vec2 }
  | { type: 'combo:milestone'; combo: number; pos: Vec2; level: 1 | 2 | 3 }
  | { type: 'volley:end'; shotDamage: number; bestCombo: number }
  | { type: 'volley:fusion'; element: BallElement; tier: BallTier; index: number; pos: Vec2 }
  | { type: 'rows:advanced'; wave: number; newRow: boolean }
  | { type: 'drop:spawned'; dropId: number; kind: DropKind; pos: Vec2 }
  | { type: 'drop:collected'; dropId: number; kind: DropKind; pos: Vec2; value: number }
  | { type: 'wave:cleared'; wave: number }
  | { type: 'boss:spawned'; bossId: string; blockId: number }
  | { type: 'boss:killed'; bossId: string; pos: Vec2 }
  | { type: 'reward:offered'; options: RewardOption[] }
  | { type: 'reward:chosen'; option: RewardOption }
  | { type: 'reward:skipped' }
  | { type: 'shop:opened'; shop: ShopState }
  | { type: 'shop:bought'; item: ShopItem }
  | { type: 'shop:rerolled'; cost: number }
  | { type: 'shop:left' }
  | { type: 'player:damaged'; amount: number; hpLeft: number }
  | { type: 'player:healed'; amount: number; hpLeft: number }
  | { type: 'meta:unlocked'; nodeId: string }
  | { type: 'achievement:unlocked'; achievementId: string }
  | { type: 'ui:click' }
  | { type: 'ui:screen'; screen: UiScreen };

export type UiScreen = 'title' | 'game' | 'reward' | 'shop' | 'gameover' | 'meta' | 'settings' | 'daily';

export interface RunSummary {
  seed: string;
  depth: number;
  wave: number;
  stats: RunStats;
  relics: RelicId[];
  volley: VolleyBall[];
  isDaily: boolean;
  dailyDate: string | null;
  /** score = somme pondérée (voir economy.json → score) */
  score: number;
}

// ----------------------------------------------------------------------
// API de la simulation (sim/) — pure, déterministe, sans DOM ni Date
// ----------------------------------------------------------------------

export interface MetaModifiers {
  bonusHp: number;
  bonusStartBalls: number;
  /** multiplicateur de pièces gagnées (1 = neutre) */
  coinMultiplier: number;
  /** multiplicateur de fragments du Puits UNIQUEMENT : la sim applique elle-même ceux des runMods actifs */
  fragmentMultiplier: number;
  freeRerolls: number;
  /** éléments pouvant apparaître dans les drops/offres ; 'stone' toujours présent */
  unlockedElements: BallElement[];
  unlockedRelics: RelicId[];
  /** modificateurs de run optionnels actifs (ids de meta.json → runMods) */
  runMods: string[];
}

export interface SimOptions {
  seed: string;
  meta: MetaModifiers;
  snapshot?: RunSnapshot;
  isDaily?: boolean;
  dailyDate?: string | null;
}

export interface Sim {
  readonly state: Readonly<RunState>;
  readonly config: GameConfig;
  /** Avance de dtMs (déjà multiplié par le timeScale). Renvoie les événements émis. Le tableau renvoyé est réutilisé : le copier si besoin. */
  step(dtMs: number): readonly GameEvent[];
  /** Direction de visée (normalisée en interne ; y doit être < 0, sinon clampée à un angle min). */
  aim(dir: Vec2): void;
  /** Annule la visée (aimDir = null). */
  cancelAim(): void;
  /** Tire la volée dans aimDir. Ne fait rien hors phase 'aiming' ou sans aimDir. */
  fire(): void;
  /** Accélère la fin de volée. Ne fait rien hors phase 'firing'. */
  recall(): void;
  chooseReward(index: number): void;
  skipReward(): void;
  buy(index: number): void;
  reroll(): void;
  leaveShop(): void;
  restart(seed?: string): void;
  /** Polyline de prévisualisation : départ, premier impact, et court segment réfléchi. */
  preview(dir: Vec2): Vec2[];
  snapshot(): RunSnapshot;
}

// ----------------------------------------------------------------------
// Configuration (src/config/*.json)
// ----------------------------------------------------------------------

export interface BoardConfig {
  cols: number;
  rows: number;
  ballRadius: number;
  ballSpeed: number;
  /** délai entre deux balles de la rafale (ms) */
  launchIntervalMs: number;
  /** durée de l'animation d'avancée des rangées (ms) */
  advanceDurationMs: number;
  /** angle minimal par rapport à l'horizontale (degrés) */
  minAimAngleDeg: number;
  /** durée max d'une volée avant rappel automatique (ms) */
  maxVolleyMs: number;
  recallSpeed: number;
  /** après ce délai (ms), la volée accélère progressivement jusqu'à recallSpeed (0 = désactivé) */
  autoSpeedupAfterMs: number;
}

export interface BallDef {
  id: BallElement;
  name: string;
  description: string;
  baseDamage: number;
  /** poids dans les tirages (0 = jamais en drop aléatoire) */
  weight: number;
  color: string;
}

export interface BallsConfig {
  tierDamageMultiplier: number;
  comboDamagePerBounce: number;
  comboMilestones: [number, number, number];
  /** nb max de balles dans la volée */
  maxVolley: number;
  /** 'fire' : rayon d'explosion en cellules ; dégâts = ratio × dégâts de la balle */
  fire: { radius: number; damageRatio: number };
  lightning: { chainRange: number; damageRatio: number };
  split: { maxSplitsPerShot: number; angleDeg: number };
  lead: { damageMultiplier: number };
  defs: BallDef[];
}

export interface BlockDef {
  kind: BlockKind;
  color: string;
  /** chance qu'un bloc normal soit remplacé par ce type (par vague, interpolé) */
  weightByWave: { wave: number; weight: number }[];
  /** PV relatifs à la base de la rangée (peg : ignoré) */
  hpRatio: number;
  explosionRadius?: number;
  explosionDamageRatio?: number;
}

export interface DropTable {
  /** probabilité qu'un bloc détruit lâche quelque chose */
  dropChance: number;
  weights: { kind: DropKind; weight: number }[];
  coinValue: { min: number; max: number };
  fragmentValue: { min: number; max: number };
  /** +1 balle garanti tous les N blocs détruits (0 = désactivé) */
  guaranteedBallEvery: number;
}

export interface BlocksConfig {
  board: BoardConfig;
  defs: BlockDef[];
  drops: DropTable;
  /** dégâts max infligés par un bloc qui franchit la ligne */
  breachDamageCap: number;
  /** dégâts infligés par un boss qui franchit la ligne (non plafonnés par breachDamageCap) */
  bossBreachDamage: number;
}

export interface BossDef {
  id: string;
  name: string;
  width: number;
  hpMultiplier: number;
  /** comportement implémenté dans sim/boss.ts, clé libre */
  behavior: 'regen' | 'spawner' | 'absorb';
  param: number;
}

export interface WavesConfig {
  /** PV de base rangée = baseHp × growthPerWave^(wave-1) × (1 + growthPerShot × shotInWave) */
  baseHp: number;
  /** si présent, remplace baseHp/growthPerWave : PV de base interpolés linéairement entre les points (extrapolés géométriquement au-delà du dernier) */
  hpByWave?: { wave: number; baseHp: number }[];
  growthPerWave: number;
  growthPerShot: number;
  hpVariance: { min: number; max: number };
  /** rangées par vague = rowsBase + rowsPerWave × (wave-1), plafonné */
  rowsBase: number;
  rowsPerWave: number;
  rowsMax: number;
  /** blocs par rangée, interpolé entre points */
  densityByWave: { wave: number; blocks: number }[];
  bossEvery: number;
  shopEvery: number;
  bosses: BossDef[];
  /** rangées présentes au début de chaque vague */
  startRows: number;
  /** éléments de départ et nombre de balles initiales */
  start: { hp: number; balls: number; elements: BallElement[] };
}

export type RelicRarity = 'common' | 'rare' | 'epic';

export interface RelicDef {
  id: RelicId;
  name: string;
  description: string;
  rarity: RelicRarity;
  /** paramètre numérique libre lu par l'implémentation dans sim/relics.ts */
  value: number;
  /** poids de tirage */
  weight: number;
  /** proposée seulement si la volée contient cet élément */
  requiresElement?: BallElement;
  /** paramètres libres lus par sim/relics.ts */
  params?: Record<string, number>;
}

export interface RelicsConfig {
  rarityWeights: Record<RelicRarity, number>;
  defs: RelicDef[];
}

export interface EconomyConfig {
  shop: {
    itemCount: number;
    prices: { ball: number; relicByRarity: Record<RelicRarity, number>; heal: number };
    rerollBase: number;
    rerollGrowth: number;
    healAmount: number;
  };
  /** fuseChance : probabilité qu'une option soit remplacée par une fusion quand une paire existe */
  reward: { skipCoins: number; optionCount: number; relicChance: number; fuseChance: number };
  score: { perDepth: number; perBlock: number; perDamage: number; perBoss: number };
  fragments: { perWave: number; perBoss: number; perDepth: number };
}

export interface MetaNode {
  id: string;
  branch: 'arsenal' | 'foundations' | 'depth';
  name: string;
  description: string;
  /** coût par niveau en fragments */
  costs: number[];
  /** effet par niveau : clé de MetaModifiers ou 'unlockElement:<id>' / 'unlockRelic:<id>' / 'runMod:<id>' */
  effect: string;
  valuePerLevel: number;
  requires: string[];
}

export interface RunModDef {
  id: string;
  name: string;
  description: string;
  fragmentMultiplier: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  rewardFragments: number;
  /** condition déclarative optionnelle (sinon : table par id dans systems/achievements.ts) */
  condition?: { stat: 'bestCombo' | 'bestShotDamage' | 'bestDepth' | 'bestWave' | 'bossesKilled' | 'wave' | 'maxTier' | 'isDaily' | 'perfectWaves'; gte: number };
}

export interface MetaConfig {
  nodes: MetaNode[];
  runMods: RunModDef[];
  achievements: AchievementDef[];
}

export interface GameConfig {
  balls: BallsConfig;
  blocks: BlocksConfig;
  waves: WavesConfig;
  relics: RelicsConfig;
  economy: EconomyConfig;
  meta: MetaConfig;
}

// ----------------------------------------------------------------------
// Sauvegarde (systems/)
// ----------------------------------------------------------------------

export interface Settings {
  sfx: number;
  music: number;
  shake: boolean;
  reduceMotion: boolean;
}

export interface MetaState {
  fragments: number;
  /** niveau acheté par nœud */
  nodes: Record<string, number>;
  unlockedElements: BallElement[];
  unlockedRelics: RelicId[];
  activeRunMods: string[];
}

export interface GlobalStats {
  runs: number;
  bestDepth: number;
  bestWave: number;
  bestCombo: number;
  bestShotDamage: number;
  bestScore: number;
  totalFragments: number;
  totalBlocks: number;
}

export interface DailyResult {
  depth: number;
  score: number;
  completedAt: string;
}

export interface SaveData {
  version: 1;
  meta: MetaState;
  stats: GlobalStats;
  achievements: string[];
  daily: Record<string, DailyResult>;
  currentRun: RunSnapshot | null;
  settings: Settings;
  /** le joueur a déjà vu l'onboarding */
  onboarded: boolean;
}

export interface MetaSystem {
  readonly data: Readonly<SaveData>;
  load(): void;
  save(): void;
  getModifiers(): MetaModifiers;
  /** crédite fragments, succès, stats, quotidien ; renvoie les succès débloqués */
  onRunEnd(summary: RunSummary): string[];
  buyNode(nodeId: string): boolean;
  canBuyNode(nodeId: string): boolean;
  toggleRunMod(id: string): void;
  setCurrentRun(snapshot: RunSnapshot | null): void;
  updateSettings(patch: Partial<Settings>): void;
  setOnboarded(): void;
  dailySeed(date?: string): string;
  todayKey(): string;
  reset(): void;
}

// ----------------------------------------------------------------------
// Contrôle du temps (main.ts implémente ; render/ui appellent)
// ----------------------------------------------------------------------

export interface TimeControl {
  /** gèle la sim pendant ms (hit-stop). Les appels se cumulent par max, pas par somme. */
  requestHitStop(ms: number): void;
  /** ralenti (scale dans ]0,1]) pendant ms */
  requestSlowMo(scale: number, ms: number): void;
  readonly timeScale: number;
}

// ----------------------------------------------------------------------
// Renderer, audio, UI
// ----------------------------------------------------------------------

export interface Renderer {
  /** dessine l'état ; dtMs réel écoulé (pour les effets, indépendant du hit-stop) */
  draw(state: Readonly<RunState>, dtMs: number): void;
  resize(): void;
  /** conversion pixel écran → unités plateau (pour ui/input) */
  screenToBoard(px: number, py: number): Vec2;
  boardToScreen(p: Vec2): Vec2;
  setReduceMotion(v: boolean): void;
  setShake(v: boolean): void;
  /** nombre de particules vivantes (QA/perf) */
  readonly particleCount: number;
  dispose?(): void;
}

export interface AudioSystem {
  unlock(): void;
  setSfxVolume(v: number): void;
  setMusicVolume(v: number): void;
  readonly unlocked: boolean;
}

export interface UI {
  show(screen: UiScreen): void;
  readonly screen: UiScreen;
  /** à appeler chaque frame pour le HUD (lecture seule de l'état) */
  update(state: Readonly<RunState>): void;
}

// ----------------------------------------------------------------------
// API de debug exposée sur window.__pegbreaker (pour Playwright / QA)
// ----------------------------------------------------------------------

export interface DebugApi {
  sim: Sim;
  renderer: Renderer;
  audio: AudioSystem | null;
  bus: import('./events').EventBus;
  meta: MetaSystem;
  /** compteur par type d'événement depuis le chargement */
  eventCounts: Record<string, number>;
  /** multiplie la vitesse de la sim (QA : jouer 10 runs vite) */
  setSpeed(mult: number): void;
  /** fps moyen sur la dernière seconde */
  fps: number;
  /** erreurs capturées (window.onerror, unhandledrejection) */
  errors: string[];
  /** horodatage performance.now() du premier événement 'block:destroyed' ou 'drop:collected' */
  firstRewardAt: number | null;
  version: string;
}
