// render/index.ts — renderer canvas 2D de Pegbreaker (propriétaire : feel-artist).
// Lit RunState en lecture seule et s'abonne au bus pour le feedback. Ne touche jamais à la sim
// ni au temps : pas de hit-stop, pas de slow-mo, pas de secousse, pas de flash plein écran
// (choix produit : tout le feedback reste local, à l'endroit de l'événement).
import type { EventBus, Unsubscribe } from '../core/events';
import type { BallElement, GameConfig, Renderer, RunState, Vec2 } from '../core/types';
import { boardToScreen, computeLayout, createLayout, MAX_DPR, screenToBoard } from './layout';
import { buildSprites, type SpriteBudget, type Sprites } from './sprites';
import { createParticles, P_CRYSTAL, P_SHARD, P_SPARK, PRIO_HIGH, PRIO_LOW, PRIO_NORMAL } from './particles';
import { createDamageNumbers, formatNumber, FONT_BUCKETS } from './damageNumbers';
import { createVfx } from './vfx';
import { createFrameDrawer } from './draw';
import { createFusions } from './fusion';
import { buildBackdrops } from './backdrop';
import { buildColors, ELEMENT_INDEX, ELEMENTS, FAMILY_INDEX, KIND_INDEX, PALETTE, shade } from './palette';

export { PALETTE } from './palette';

/** slot unique pour le libellé « COMBO ×N » (évite l'empilement quand plusieurs balles franchissent un palier) */
const COMBO_SLOT = -2;
/** slot du libellé « CONTRAT ✓ » */
const CONTRACT_SLOT = -3;
const CONTRACT_LABEL = 'CONTRAT \u2713';

export interface PegRenderer extends Renderer {
  /** désabonne le renderer du bus (démo, hot reload). Hors interface Renderer. */
  dispose(): void;
  /** résolution interne courante (≤ 2, baisse si la machine rame) */
  readonly dpr: number;
  /** durée de la dernière bascule de qualité adaptative (ms) */
  readonly qualitySwitchMs: number;
  /** QA : force une baisse de qualité (même chemin que la bascule adaptative) ; false si déjà au minimum */
  debugLowerQuality(step: number): boolean;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  bus: EventBus,
  config: GameConfig,
): PegRenderer {
  // canvas transparent : le fond statique est posé en CSS (backdrop.ts), bien moins cher
  // que de re-remplir tout le canvas à chaque frame
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('render: contexte 2D indisponible');
  const board = config.blocks.board;
  const colors = buildColors(config);
  const layout = createLayout(board.cols, board.rows);
  const particles = createParticles();
  const numbers = createDamageNumbers();
  const vfx = createVfx();
  let sprites: Sprites | null = null;
  /** budget de créations de sprites par frame (remis à zéro par le dessin) */
  const spriteBudget: SpriteBudget = { n: 0 };
  let frame = 0;
  let lastState: Readonly<RunState> | null = null;
  let backdrops: string[] = [];
  let backdropWave = -1;
  let backdropLevel = 0;
  let appliedBackdrop = '';

  function applyBackdrop(): void {
    const s = backdrops[backdropLevel] ?? backdrops[0];
    if (s !== undefined && s !== appliedBackdrop) {
      canvas.style.background = s;
      appliedBackdrop = s;
    }
  }
  function rebuildBackdrops(wave: number): void {
    backdropWave = wave;
    backdrops = buildBackdrops(layout, wave);
    // même géométrie CSS (changement de qualité = DPR seul) : chaîne identique, pas de re-style
    applyBackdrop();
  }

  const EL_DIVINE_I = ELEMENT_INDEX.divine;
  const fusions = createFusions((x, y, element, tier, forge) => {
    const c = colors.element[element] ?? PALETTE.stone;
    if (forge) {
      // forge : flash + anneaux + particules de la couleur de l'hybride (dorés pour la Divine)
      const divine = element === EL_DIVINE_I;
      const fc = divine ? PALETTE.gold : c;
      vfx.flashCircle(x, y, divine ? 0.9 : 0.7, 200, '#ffffff');
      vfx.ring(x, y, 0.1, divine ? 1.8 : 1.3, 360, fc, 0.12);
      vfx.ring(x, y, 0.05, divine ? 1.1 : 0.8, 280, '#ffffff', 0.05);
      particles.burst(x, y, divine ? 34 : 24, fc, P_SPARK, 2.5, 7, 0, Math.PI, 0.25, 0.45, 0.04, 0.08, 0, PRIO_HIGH);
      particles.burst(x, y, 10, divine ? PALETTE.goldLight : shade(c, 0.5), P_CRYSTAL, 1, 3.5, 0, Math.PI, 0.3, 0.55, 0.05, 0.09, 1, PRIO_HIGH);
      if (divine) vfx.rays(x, y, 420, PALETTE.gold, 16, 1.6);
      return;
    }
    vfx.flashCircle(x, y, 0.5 + 0.1 * tier, 170, '#ffffff');
    vfx.ring(x, y, 0.1, 0.8 + 0.2 * tier, 280, c, 0.09);
    vfx.ring(x, y, 0.05, 0.5, 200, '#ffffff', 0.04);
    particles.burst(x, y, 10 + 4 * tier, c, P_SPARK, 2, 6, 0, Math.PI, 0.2, 0.4, 0.04, 0.08, 0);
  });

  // Qualité adaptative. La résolution interne effective = min(DPR de l'écran, plafond surface,
  // plafond mobile, cran de qualité), arrondie au 0,25 inférieur.
  // - Plafond surface (J5-01) : backing store ≤ ~1,6 Mpx (720×1280 CSS → 1,25 ; 540×960 → 1,75).
  // - Plafond mobile (J2-02) : 1,5 si DPR ≥ 2 et canvas ≤ 600 px CSS.
  // - Bascule préventive (J5-01) : sur volley:start d'au moins 18 balles, si le dernier tir
  //   comparable a eu une frame moyenne > 17,5 ms, on baisse d'un cran (0,25) AVANT la 1re balle.
  // - Bascule réactive (secours, J2-02) : 12 frames > 18,5 ms sur 20 → −0,5, même en pleine volée.
  // Jamais de remontée automatique (pas d'oscillation) ; un resize() garde le cran de qualité.
  const SLOW_FRAME_MS = 18.5;
  const SLOW_WINDOW = 20;
  const SLOW_TRIGGER = 12;
  const MOBILE_MAX_CSS_W = 600;
  const MAX_BACKING_PX = 1.6e6;
  const BIG_VOLLEY = 18;
  // Le dt de rAF est calé sur la vsync : à 60 fps parfaits il vaut 16,7 ms, donc un seuil de 15 ms
  // déclencherait toujours. 17,5 ms ≈ moyenne < 57 fps (au moins une frame sautée sur ~20).
  const PREVENTIVE_AVG_MS = 17.5;
  /** cran de qualité (baisses adaptatives) ; MAX_DPR = aucun */
  let qualityCap = MAX_DPR;
  const slowRing = new Uint8Array(SLOW_WINDOW);
  let slowIdx = 0;
  let slowCount = 0;
  let qualityCooldown = 0;
  /** durée (ms) de la dernière régénération pour changement de qualité (QA) */
  let lastQualitySwitchMs = 0;
  // mesure par volée (pour la bascule préventive)
  let volleyCount = 0;
  let volleyFrames = 0;
  let volleyMs = 0;
  /** frame moyenne (ms) du dernier tir d'au moins BIG_VOLLEY balles ; 0 = inconnu */
  let lastBigVolleyAvg = 0;

  const quarterFloor = (v: number): number => Math.floor(v * 4 + 1e-6) / 4;

  /** plafond de résolution hors cran de qualité, pour la taille CSS courante */
  function structuralCap(): number {
    const parent = canvas.parentElement;
    const cssW = parent ? parent.clientWidth : canvas.clientWidth;
    const cssH = parent ? parent.clientHeight : canvas.clientHeight;
    const devDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    let cap = MAX_DPR;
    if (cssW > 0 && cssH > 0) cap = Math.min(cap, Math.sqrt(MAX_BACKING_PX / (cssW * cssH)));
    if (devDpr >= 2 && cssW > 0 && cssW <= MOBILE_MAX_CSS_W) cap = Math.min(cap, 1.5);
    return cap;
  }

  function effectiveCap(): number {
    const devDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const c = Math.min(devDpr, structuralCap(), qualityCap);
    return c <= 1 ? 1 : quarterFloor(c);
  }

  /** baisse la résolution de `step` et régénère (renvoie false si déjà au minimum) */
  function lowerQuality(step: number): boolean {
    if (layout.dpr <= 1) return false;
    qualityCap = Math.max(1, quarterFloor(layout.dpr - step));
    const t0 = performance.now();
    doResize();
    lastQualitySwitchMs = performance.now() - t0;
    slowRing.fill(0);
    slowCount = 0;
    qualityCooldown = 30; // laisse retomber la frame de régénération avant de re-mesurer
    return true;
  }

  function trackFrame(dtMs: number, state: Readonly<RunState>): void {
    if (state.phase === 'firing' && dtMs > 0 && dtMs < 100) { volleyFrames++; volleyMs += dtMs; }
    if (qualityCooldown > 0) { qualityCooldown--; return; }
    if (dtMs <= 0 || dtMs >= 100 || frame <= 60) return;
    const slow = dtMs > SLOW_FRAME_MS ? 1 : 0;
    slowCount += slow - (slowRing[slowIdx] ?? 0);
    slowRing[slowIdx] = slow;
    slowIdx = (slowIdx + 1) % SLOW_WINDOW;
    if (slowCount >= SLOW_TRIGGER && state.phase !== 'gameover') lowerQuality(0.5);
  }

  function doResize(): Sprites {
    computeLayout(layout, canvas, effectiveCap());
    // régénération paresseuse : la génération courante sert de repli (blit à l'échelle) pendant
    // que les sprites de la nouvelle résolution sont construits au plus SPRITE_BUILD_BUDGET par frame
    const s = buildSprites(layout, colors, config, sprites, spriteBudget);
    sprites = s;
    numbers.rebuildFonts(layout);
    drawer.rebuildFonts();
    rebuildBackdrops(backdropWave < 1 ? 1 : backdropWave);
    return s;
  }

  function ensureSprites(): Sprites {
    return sprites ?? doResize();
  }

  const drawer = createFrameDrawer({
    ctx, layout, particles, numbers, vfx, fusions, colors,
    onPowerLevel(level) { backdropLevel = level; applyBackdrop(); },
    ballRadius: board.ballRadius,
    maxSpreadDeg: board.maxSpreadDeg,
    getSprites: ensureSprites,
    budget: spriteBudget,
  });

  // ------------------------------------------------------------------
  // Événements → feedback (allocation tolérée ici : hors boucle de dessin)
  // ------------------------------------------------------------------
  const kindColor = (k: number): string => colors.kind[k] ?? PALETTE.block;
  const elemColor = (e: keyof typeof ELEMENT_INDEX): string => colors.element[ELEMENT_INDEX[e]] ?? PALETTE.stone;
  const subs: Unsubscribe[] = [];
  const EL_BOMB = ELEMENT_INDEX.bomb, EL_NOVA = ELEMENT_INDEX.nova, EL_VAMPIRE = ELEMENT_INDEX.vampire;
  const EL_ECHO = ELEMENT_INDEX.echo, EL_BOOMERANG = ELEMENT_INDEX.boomerang;
  const F_HYBRID_I = FAMILY_INDEX.hybrid;
  const steamColor = colors.element[ELEMENT_INDEX.steam] ?? PALETTE.ice;
  const supernovaColor = colors.element[ELEMENT_INDEX.supernova] ?? PALETTE.heart;
  const supernovaCore = shade(supernovaColor, 0.7);
  const missileColor = colors.element[ELEMENT_INDEX.missile] ?? PALETTE.fire;
  const laserColor = colors.element[ELEMENT_INDEX.laser] ?? PALETTE.ice;
  const clusterColor = colors.element[ELEMENT_INDEX.cluster] ?? PALETTE.danger;
  /** Jugement : une seule bande dorée au sol par frame, même avec un éclair par bloc */
  let judgementFrame = -100;
  /** dernière destruction par le vampire / l'or (position + frame) : relie healed / drop:spawned à un point */
  let vampX = 0, vampY = 0, vampFrame = -100;
  let goldX = 0, goldY = 0, goldFrame = -100;
  /** cœur de l'explosion nova : couleur de config éclaircie (calculée une fois) */
  const novaCore = shade(colors.element[EL_NOVA] ?? PALETTE.heart, 0.7);
  /** flash rouge local de la rangée du joueur (brèche, dégâts) */
  const flashPlayerRow = (ms: number): void => {
    vfx.flashRect(0, board.rows - 1, board.cols, 1, ms, PALETTE.danger);
  };

  subs.push(bus.on('ball:bounce', (e) => {
    const dir = Math.atan2(e.normal.y, e.normal.x);
    const n = 3 + Math.floor(Math.random() * 3);
    if (e.surface === 'wall') {
      particles.burst(e.pos.x, e.pos.y, n, '#b8c8ff', P_SPARK, 2, 5, dir, 0.9, 0.1, 0.22, 0.03, 0.05, 0, PRIO_LOW);
      // micro-flash du mur à l'impact (0,08 s)
      if (Math.abs(e.normal.x) > 0.5) vfx.flashRect(e.normal.x > 0 ? 0 : board.cols - 0.06, e.pos.y - 0.3, 0.06, 0.6, 80, '#9fb4e0');
      else vfx.flashRect(e.pos.x - 0.3, 0, 0.6, 0.06, 80, '#9fb4e0');
    } else {
      particles.burst(e.pos.x, e.pos.y, n, PALETTE.text, P_SPARK, 2, 5.5, dir, 1.0, 0.1, 0.22, 0.03, 0.05, 0, PRIO_LOW);
      if (e.surface === 'peg' && lastState) {
        // squash du peg le plus proche (les pegs ne reçoivent pas forcément block:hit)
        const blocks = lastState.blocks;
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i]!;
          if (b.kind !== 'peg') continue;
          const dx = b.col + 0.5 - e.pos.x, dy = b.row + 0.5 - e.pos.y;
          if (dx * dx + dy * dy < 0.36) { vfx.blockFx(b.id).squashT = 0; break; }
        }
      }
    }
  }));

  /** coup d'une balle dorée : id mémorisé depuis ball:launched.golden, sinon Ball.golden de l'état */
  function hitByGolden(ballId: number): boolean {
    if (drawer.isGoldenId(ballId)) return true;
    const st = lastState;
    if (!st) return false;
    const balls = st.balls;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]!;
      if (b.id === ballId) return b.golden === true;
    }
    return false;
  }

  subs.push(bus.on('block:hit', (e) => {
    // dégâts de la Divine (et de la balle dorée) en or
    numbers.add(e.pos.x, e.pos.y - 0.1, e.damage, e.crit, e.blockId, e.element === 'divine' || hitByGolden(e.ballId));
    const fx = vfx.blockFx(e.blockId);
    fx.squashT = 0;
    const c = elemColor(e.element);
    particles.burst(e.pos.x, e.pos.y, 2, c, P_SPARK, 1.5, 4, 0, Math.PI, 0.1, 0.2, 0.03, 0.05, 0, PRIO_LOW);
    const ei = ELEMENT_INDEX[e.element];
    if (colors.family[ei] === F_HYBRID_I) {
      // hybride : une étincelle de chaque parent
      const ia = colors.recipeA[ei] ?? -1, ib = colors.recipeB[ei] ?? -1;
      if (ia >= 0) particles.burst(e.pos.x, e.pos.y, 2, colors.element[ia] ?? c, P_SPARK, 1.5, 4, 0, Math.PI, 0.1, 0.2, 0.03, 0.05, 0, PRIO_LOW);
      if (ib >= 0) particles.burst(e.pos.x, e.pos.y, 2, colors.element[ib] ?? c, P_SPARK, 1.5, 4, 0, Math.PI, 0.1, 0.2, 0.03, 0.05, 0, PRIO_LOW);
    }
    // signatures d'impact des nouvelles balles (locales, ≤ 300 ms)
    switch (e.element) {
      case 'acid': {
        // éclat vert à l'impact + gouttes ; la teinte persistante suit Block.acidCharges (draw.ts)
        const bx = Number.isNaN(fx.hp) ? Math.floor(e.pos.x) : fx.x, by = Number.isNaN(fx.hp) ? Math.floor(e.pos.y) : fx.y;
        vfx.flashRect(bx + 0.05, by + 0.05, fx.w - 0.1, 0.9, 260, c);
        particles.burst(bx + fx.w * 0.5, by + 0.95, 6, c, P_SHARD, 0.2, 1.2, Math.PI / 2, 0.5, 0.35, 0.55, 0.04, 0.07, 7, PRIO_NORMAL);
        break;
      }
      case 'shock':
        vfx.ring(e.pos.x, e.pos.y, 0.05, 0.45, 160, c, 0.05);
        break;
      case 'void':
        // implosion : anneau qui se referme vers le point d'impact
        vfx.ring(e.pos.x, e.pos.y, 0.5, 0.05, 200, c, 0.06);
        break;
      case 'rust':
        particles.burst(e.pos.x, e.pos.y, 5, c, P_SHARD, 0.8, 2.5, Math.PI / 2, 1.2, 0.3, 0.5, 0.04, 0.07, 6, PRIO_LOW);
        break;
      case 'lucky':
        if (e.crit) { vfx.flashCircle(e.pos.x, e.pos.y, 0.28, 140, c); particles.burst(e.pos.x, e.pos.y, 6, c, P_CRYSTAL, 1, 3, 0, Math.PI, 0.2, 0.35, 0.05, 0.08, 0, PRIO_NORMAL); }
        break;
      case 'pierce':
      case 'wraith':
        vfx.flashCircle(e.pos.x, e.pos.y, 0.18, 90, '#ffffff');
        break;
      case 'hammer':
        // coup lourd : anneau sombre court + éclats
        vfx.ring(e.pos.x, e.pos.y, 0.05, 0.5, 180, c, 0.08);
        particles.burst(e.pos.x, e.pos.y, 6, c, P_SHARD, 1, 3, Math.PI / 2, 1.3, 0.3, 0.5, 0.05, 0.08, 6, PRIO_LOW);
        break;
      case 'divine':
        vfx.flashCircle(e.pos.x, e.pos.y, 0.24, 110, PALETTE.goldLight);
        break;
      default:
    }
  }));

  subs.push(bus.on('block:destroyed', (e) => {
    const fx = vfx.peekBlockFx(e.blockId);
    const k = KIND_INDEX[e.kind];
    const w = fx ? fx.w : e.width;
    const cx = fx ? fx.x + w * 0.5 : e.pos.x;
    const cy = fx ? fx.y + 0.5 : e.pos.y;
    const n = Math.min(40, (8 + Math.floor(Math.random() * 7)) * (w > 1 ? 2 : 1));
    particles.burst(cx, cy, n, kindColor(k), P_SHARD, 3, 8, -Math.PI / 2, Math.PI, 0.35, 0.6, 0.07, 0.13, 7);
    particles.burst(cx, cy, 4, '#ffffff', P_SPARK, 3, 7, -Math.PI / 2, Math.PI, 0.1, 0.2, 0.04, 0.06, 0);
    vfx.flashRect(cx - w * 0.5 + 0.05, cy - 0.45, w - 0.1, 0.9, 70, '#ffffff');
    vfx.releaseBlockFx(e.blockId);
    if (e.element === 'vampire') { vampX = e.pos.x; vampY = e.pos.y; vampFrame = frame; }
    else if (e.element === 'gold') { goldX = cx; goldY = cy; goldFrame = frame; }
  }));

  subs.push(bus.on('block:explode', (e) => {
    const x = e.pos.x, y = e.pos.y;
    switch (e.element) {
      case 'divine': {
        // nova de la Divine : onde dorée + rayons
        const rr = Math.max(0.6, e.radius);
        vfx.ring(x, y, 0.15, rr, 280, PALETTE.gold, 0.16);
        vfx.ring(x, y, 0.05, rr * 0.7, 220, '#ffffff', 0.05);
        vfx.flashCircle(x, y, rr * 0.45, 130, PALETTE.goldLight);
        vfx.rays(x, y, 300, PALETTE.gold, 12, rr);
        particles.burst(x, y, 14, PALETTE.gold, P_CRYSTAL, 2, 6, 0, Math.PI, 0.2, 0.4, 0.04, 0.08, 0.5, PRIO_HIGH);
        return;
      }
      case 'supernova': {
        // grande onde rose (rayon 2 u), double, + gerbe de rayons
        const rr = Math.max(1.2, e.radius);
        vfx.ring(x, y, 0.2, rr, 380, supernovaColor, 0.22);
        vfx.ring(x, y, 0.1, rr * 0.7, 320, '#ffffff', 0.07);
        vfx.ring(x, y, 0.05, rr * 1.15, 480, supernovaColor, 0.06);
        vfx.flashCircle(x, y, rr * 0.45, 160, supernovaCore);
        vfx.rays(x, y, 400, supernovaColor, 18, rr);
        particles.burst(x, y, 30, supernovaColor, P_SPARK, 4, 11, 0, Math.PI, 0.2, 0.45, 0.05, 0.09, 0, PRIO_HIGH);
        particles.burst(x, y, 10, '#ffffff', P_CRYSTAL, 2, 6, 0, Math.PI, 0.25, 0.45, 0.05, 0.08, 1, PRIO_HIGH);
        return;
      }
      case 'steam': {
        // nuage pâle qui gonfle et monte, liseré de vapeur
        const rr = Math.max(0.6, e.radius);
        vfx.puff(x, y, rr * 0.5, rr * 1.35, 560, 0.3, 0.55);
        vfx.puff(x + (Math.random() < 0.5 ? -0.35 : 0.35) * rr, y + 0.1, rr * 0.3, rr * 0.9, 480, 0.4, 0.4);
        vfx.ring(x, y, 0.1, rr, 300, steamColor, 0.06);
        particles.burst(x, y, 12, '#eef8ff', P_SHARD, 0.4, 1.6, -Math.PI / 2, Math.PI, 0.35, 0.6, 0.06, 0.12, -1.5, PRIO_NORMAL);
        particles.burst(x, y, 6, elemColor('ice'), P_CRYSTAL, 0.8, 2.5, 0, Math.PI, 0.3, 0.5, 0.05, 0.08, 1, PRIO_NORMAL);
        return;
      }
      case 'missile': {
        // explosion orange vif + fumée, plus sèche que la bombe
        const rr = Math.max(0.5, e.radius);
        vfx.ring(x, y, 0.1, rr, 230, missileColor, 0.15);
        vfx.ring(x, y, 0.05, rr * 0.7, 180, '#ffffff', 0.05);
        vfx.flashCircle(x, y, rr * 0.55, 110, '#ffe0b0');
        particles.burst(x, y, 16, missileColor, P_SPARK, 4, 10, 0, Math.PI, 0.15, 0.3, 0.05, 0.08, 0, PRIO_HIGH);
        particles.burst(x, y, 8, '#3a3f4b', P_SHARD, 1, 3, -Math.PI / 2, 1.3, 0.35, 0.55, 0.07, 0.12, 2, PRIO_NORMAL);
        return;
      }
      case 'cluster': {
        // mini-bombe de la grappe : petite explosion rose + fumée
        const rr = Math.max(0.4, e.radius);
        vfx.ring(x, y, 0.08, rr, 220, clusterColor, 0.1);
        vfx.flashCircle(x, y, rr * 0.5, 100, '#ffffff');
        particles.burst(x, y, 10, clusterColor, P_SPARK, 3, 7, 0, Math.PI, 0.12, 0.28, 0.04, 0.07, 0, PRIO_HIGH);
        particles.burst(x, y, 5, '#3a3f4b', P_SHARD, 1, 3, -Math.PI / 2, 1.2, 0.3, 0.5, 0.06, 0.1, 2, PRIO_NORMAL);
        return;
      }
      default:
    }
    // couleur de la source : champ `element` de l'événement, sinon balle suivie la plus proche
    let src = -1;
    if (e.element === 'explosive') src = -2;
    else if (e.element !== undefined) src = ELEMENT_INDEX[e.element];
    else src = drawer.nearestElement(e.pos.x, e.pos.y, 0.8);
    const c = src === -2 ? kindColor(KIND_INDEX.explosive)
      : src === EL_BOMB || src === EL_NOVA || (src >= 0 && colors.family[src] === F_HYBRID_I) ? colors.element[src] ?? PALETTE.danger
        : src === EL_DIVINE_I ? PALETTE.gold : elemColor('fire');
    const core = src === EL_NOVA ? novaCore : src === EL_BOMB ? '#ffffff' : '#ffe0b0';
    vfx.ring(e.pos.x, e.pos.y, 0.15, Math.max(0.5, e.radius), 250, c, 0.16);
    vfx.ring(e.pos.x, e.pos.y, 0.05, Math.max(0.4, e.radius * 0.75), 200, '#ffffff', 0.06);
    vfx.flashCircle(e.pos.x, e.pos.y, Math.max(0.4, e.radius * 0.6), 120, core);
    particles.burst(e.pos.x, e.pos.y, 14, c, P_SPARK, 4, 9, 0, Math.PI, 0.15, 0.35, 0.05, 0.08, 0, PRIO_HIGH);
    if (src === EL_BOMB) {
      // bombe : fumée sombre qui retombe
      particles.burst(e.pos.x, e.pos.y, 10, '#3a3f4b', P_SHARD, 1.5, 4, -Math.PI / 2, 1.3, 0.35, 0.6, 0.08, 0.14, 3, PRIO_NORMAL);
    } else if (src === EL_NOVA) {
      vfx.rays(e.pos.x, e.pos.y, 300, c, 10, Math.max(0.8, e.radius));
    }
  }));

  subs.push(bus.on('combo:milestone', (e) => {
    // gradation lisible sans secousse ni gel : 1 = petit éclat, 2 = gerbe de rayons,
    // 3 = grandes ondes + particules + gros libellé + tous les blocs « sautent »
    const lvl = e.level;
    const x = e.pos.x, y = e.pos.y;
    const label = `COMBO ×${e.combo}`;
    // libellé gardé à l'intérieur du plateau (il est large)
    const lx = Math.min(board.cols - 1.3, Math.max(1.3, x));
    if (lvl === 1) {
      vfx.flashCircle(x, y, 0.35, 140, PALETTE.accent);
      vfx.ring(x, y, 0.1, 0.9, 260, PALETTE.accent, 0.06);
      particles.burst(x, y, 8, PALETTE.accent, P_SPARK, 2.5, 6, 0, Math.PI, 0.15, 0.3, 0.04, 0.06, 0, PRIO_HIGH);
      numbers.addLabel(lx, y - 0.35, label, PALETTE.accent, 5, COMBO_SLOT);
    } else if (lvl === 2) {
      vfx.flashCircle(x, y, 0.6, 180, PALETTE.accent);
      vfx.ring(x, y, 0.1, 1.5, 320, PALETTE.accent, 0.1);
      vfx.rays(x, y, 320, PALETTE.accent, 14, 1.4);
      particles.burst(x, y, 22, PALETTE.accent, P_SPARK, 3, 8, 0, Math.PI, 0.2, 0.4, 0.05, 0.08, 0, PRIO_HIGH);
      numbers.addLabel(lx, y - 0.4, label, PALETTE.accent, 8, COMBO_SLOT);
    } else {
      vfx.flashCircle(x, y, 1.0, 240, '#ffffff');
      vfx.ring(x, y, 0.2, 3.4, 500, PALETTE.accent, 0.18);
      vfx.ring(x, y, 0.1, 2.2, 400, '#ffffff', 0.08);
      vfx.ring(x, y, 0.05, 1.2, 300, PALETTE.accent, 0.05);
      vfx.rays(x, y, 450, '#ffffff', 24, 2.8);
      particles.burst(x, y, 48, PALETTE.accent, P_SPARK, 4, 11, 0, Math.PI, 0.25, 0.5, 0.06, 0.1, 0, PRIO_HIGH);
      particles.burst(x, y, 16, '#ffffff', P_SHARD, 3, 7, 0, Math.PI, 0.3, 0.5, 0.05, 0.09, 4, PRIO_HIGH);
      numbers.addLabel(lx, y - 0.45, label, PALETTE.accent, FONT_BUCKETS - 1, COMBO_SLOT);
      // onde : tous les blocs « sautent »
      if (lastState) {
        const blocks = lastState.blocks;
        for (let i = 0; i < blocks.length; i++) vfx.blockFx(blocks[i]!.id).squashT = 0;
      }
    }
  }));

  subs.push(bus.on('player:healed', (e) => {
    // vampire : petit cœur rouge au point de la destruction qui a soigné
    if (e.source === 'vampire' || (e.source === undefined && frame - vampFrame <= 1)) {
      if (frame - vampFrame > 3) return; // pas de position connue
      vfx.heart(vampX, vampY - 0.1, 600, colors.element[EL_VAMPIRE] ?? PALETTE.danger, 0.14);
      particles.burst(vampX, vampY, 5, PALETTE.heart, P_SPARK, 1, 3, -Math.PI / 2, 1, 0.15, 0.3, 0.03, 0.05, 0, PRIO_NORMAL);
    }
  }));

  subs.push(bus.on('player:damaged', () => {
    flashPlayerRow(360);
  }));

  subs.push(bus.on('drop:collected', (e) => {
    const c = e.kind === 'coin' ? PALETTE.coin : e.kind === 'fragment' ? PALETTE.fragment : e.kind === 'heart' ? PALETTE.heart : PALETTE.good;
    particles.burst(e.pos.x, e.pos.y, 8, c, P_SPARK, 2, 5, 0, Math.PI, 0.15, 0.3, 0.04, 0.06, 0);
    vfx.flashCircle(e.pos.x, e.pos.y, 0.3, 120, c);
    vfx.ring(e.pos.x, e.pos.y, 0.1, 0.45, 200, c, 0.05);
    if (e.value > 0) numbers.addLabel(e.pos.x, e.pos.y - 0.2, `+${formatNumber(e.value)}`, c, 1);
  }));

  subs.push(bus.on('volley:fusion', (e) => {
    fusions.start(e.pos.x, e.pos.y, ELEMENT_INDEX[e.element], e.tier);
  }));

  subs.push(bus.on('reward:chosen', (e) => {
    if (e.option.kind !== 'fuse') return;
    const x = lastState ? lastState.launchPos.x : board.cols / 2;
    const y = lastState ? lastState.launchPos.y - 0.6 : board.rows - 0.8;
    fusions.start(x, y, ELEMENT_INDEX[e.option.element], e.option.tier);
  }));

  subs.push(bus.on('lightning:chain', (e) => {
    if (e.element === 'laser') {
      // laser : faisceau droit (colonne) + éclats à l'arrivée
      vfx.beam(e.from.x, e.from.y, e.to.x, e.to.y, 220, laserColor, 0.26);
      particles.burst(e.to.x, e.to.y, 5, laserColor, P_SPARK, 2, 5, 0, Math.PI, 0.1, 0.2, 0.03, 0.05, 0, PRIO_NORMAL);
      return;
    }
    if (e.element === 'divine') {
      // Jugement : éclair doré depuis le sol vers le bloc + onde au sol
      const gy = board.rows - 0.02;
      const gx = e.from.y >= board.rows - 1 ? e.from.x : e.to.x;
      vfx.bolt(gx, gy, e.to.x, e.to.y, 260, PALETTE.gold);
      vfx.ring(gx, gy, 0.05, 0.7, 320, PALETTE.gold, 0.08);
      vfx.flashCircle(e.to.x, e.to.y, 0.35, 160, PALETTE.goldLight);
      particles.burst(e.to.x, e.to.y, 8, PALETTE.gold, P_CRYSTAL, 1.5, 4, 0, Math.PI, 0.2, 0.4, 0.04, 0.07, 0.5, PRIO_HIGH);
      if (frame !== judgementFrame) {
        judgementFrame = frame;
        vfx.flashRect(0, board.rows - 0.14, board.cols, 0.14, 320, PALETTE.gold);
        vfx.ring(board.cols / 2, gy, 0.2, board.cols * 0.6, 420, PALETTE.goldLight, 0.1);
      }
      return;
    }
    const prism = e.element === 'prism';
    const c = prism ? elemColor('prism') : elemColor('lightning');
    vfx.bolt(e.from.x, e.from.y, e.to.x, e.to.y, prism ? 160 : 120, c);
    particles.burst(e.to.x, e.to.y, 4, prism ? PALETTE.heart : c, P_SPARK, 2, 5, 0, Math.PI, 0.1, 0.2, 0.03, 0.05, 0);
  }));

  subs.push(bus.on('block:frozen', (e) => {
    particles.burst(e.pos.x, e.pos.y, 7, elemColor('ice'), P_CRYSTAL, 0.8, 2.5, -Math.PI / 2, Math.PI, 0.3, 0.55, 0.07, 0.12, 1.5);
    vfx.ring(e.pos.x, e.pos.y, 0.1, 0.55, 220, elemColor('ice'), 0.05);
  }));

  subs.push(bus.on('boss:spawned', (e) => {
    // arrivée du boss : onde et gerbe locales sur le bloc (son « pop » d'apparition s'y ajoute)
    const blocks = lastState ? lastState.blocks : null;
    if (!blocks) return;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (b.id !== e.blockId) continue;
      const x = b.col + b.width * 0.5, y = b.row + 0.5;
      vfx.ring(x, y, 0.3, b.width * 0.9, 400, kindColor(KIND_INDEX.boss), 0.12);
      vfx.rays(x, y, 380, kindColor(KIND_INDEX.boss), 18, 1.6);
      break;
    }
  }));

  subs.push(bus.on('boss:killed', (e) => {
    particles.burst(e.pos.x, e.pos.y, 40, kindColor(KIND_INDEX.boss), P_SHARD, 3, 9, 0, Math.PI, 0.4, 0.6, 0.08, 0.16, 6, PRIO_HIGH);
    vfx.ring(e.pos.x, e.pos.y, 0.2, 2.5, 400, PALETTE.accent, 0.12);
    vfx.flashCircle(e.pos.x, e.pos.y, 1.2, 200, '#ffffff');
    vfx.rays(e.pos.x, e.pos.y, 420, PALETTE.accent, 24, 2.4);
  }));

  subs.push(bus.on('block:breached', (e) => {
    drawer.noteBreached(e.blockId);
    flashPlayerRow(220);
  }));

  // Forge : les deux parents convergent (300 ms) puis flash + anneaux + particules au pos
  subs.push(bus.on('shop:forged', (e) => {
    fusions.startForge(e.pos.x, e.pos.y, ELEMENT_INDEX[e.result], ELEMENT_INDEX[e.parents[0]], ELEMENT_INDEX[e.parents[1]]);
  }));

  // F3 — balle dorée : mémorisée par id, petit éclat or au point de lancement
  subs.push(bus.on('ball:launched', (e) => {
    if (e.element === 'divine') {
      vfx.flashCircle(e.pos.x, e.pos.y, 0.4, 160, PALETTE.goldLight);
      vfx.rays(e.pos.x, e.pos.y, 280, PALETTE.gold, 8, 0.8);
      particles.burst(e.pos.x, e.pos.y, 10, PALETTE.gold, P_CRYSTAL, 1.5, 4, -Math.PI / 2, 1.2, 0.2, 0.35, 0.03, 0.06, 0, PRIO_HIGH);
    }
    if (!e.golden) return;
    drawer.markGolden(e.ballId);
    vfx.flashCircle(e.pos.x, e.pos.y, 0.32, 140, PALETTE.gold);
    vfx.ring(e.pos.x, e.pos.y, 0.08, 0.6, 240, PALETTE.gold, 0.05);
    particles.burst(e.pos.x, e.pos.y, 10, PALETTE.gold, P_SPARK, 2, 5, -Math.PI / 2, 1.2, 0.15, 0.3, 0.03, 0.06, 0, PRIO_HIGH);
  }));

  // Contrats : réussite = onde verte + gerbe au centre du haut du plateau + « CONTRAT ✓ » 800 ms.
  // contract:failed : rien ici (l'UI grise le bandeau).
  subs.push(bus.on('contract:completed', () => {
    const x = board.cols / 2, y = 1.3;
    vfx.ring(x, y, 0.15, 2.2, 420, PALETTE.good, 0.1);
    vfx.ring(x, y, 0.05, 1.2, 300, '#ffffff', 0.04);
    vfx.flashCircle(x, y, 0.45, 160, PALETTE.good);
    particles.burst(x, y, 22, PALETTE.good, P_SPARK, 2.5, 7, 0, Math.PI, 0.2, 0.45, 0.04, 0.08, 0, PRIO_HIGH);
    numbers.addLabel(x, y + 0.2, CONTRACT_LABEL, PALETTE.good, 6, CONTRACT_SLOT, 0.8);
  }));

  // Seconde chance : voile progressif (sans mouvement) puis levée + onde blanche depuis la ligne du joueur
  subs.push(bus.on('run:lost', () => {
    drawer.setLost();
  }));
  subs.push(bus.on('run:revived', () => {
    drawer.revive();
    vfx.flashRect(0, board.rows - 1, board.cols, 1, 180, PALETTE.textDim);
  }));

  subs.push(bus.on('ball:split', (e) => {
    const src: BallElement = e.element ?? (ELEMENTS[drawer.nearestElement(e.pos.x, e.pos.y, 0.6)] ?? 'split');
    if (src === 'cluster') {
      // grappe : les mini-bombes jaillissent (mèches + fumée), anneau rose
      vfx.ring(e.pos.x, e.pos.y, 0.05, 0.7, 240, clusterColor, 0.07);
      vfx.flashCircle(e.pos.x, e.pos.y, 0.3, 110, clusterColor);
      particles.burst(e.pos.x, e.pos.y, 10, PALETTE.accent, P_SPARK, 2.5, 6, -Math.PI / 2, 1.3, 0.15, 0.3, 0.03, 0.05, 0, PRIO_HIGH);
      particles.burst(e.pos.x, e.pos.y, 6, '#3a3f4b', P_SHARD, 1, 2.5, -Math.PI / 2, 1.2, 0.3, 0.5, 0.06, 0.1, 2, PRIO_NORMAL);
      return;
    }
    if (src === 'crystal') {
      // le cristal éclate : éclats pâles en étoile + anneau blanc
      const c = elemColor('crystal');
      particles.burst(e.pos.x, e.pos.y, 14, c, P_CRYSTAL, 2, 6, 0, Math.PI, 0.25, 0.45, 0.06, 0.11, 2, PRIO_HIGH);
      particles.burst(e.pos.x, e.pos.y, 6, '#ffffff', P_SPARK, 3, 7, 0, Math.PI, 0.1, 0.2, 0.03, 0.05, 0, PRIO_NORMAL);
      vfx.ring(e.pos.x, e.pos.y, 0.05, 0.6, 200, '#ffffff', 0.05);
      vfx.flashCircle(e.pos.x, e.pos.y, 0.3, 110, c);
      return;
    }
    const c = src === 'split' ? elemColor('split') : elemColor(src);
    particles.burst(e.pos.x, e.pos.y, 6, c, P_SPARK, 2, 5, 0, Math.PI, 0.12, 0.25, 0.03, 0.06, 0);
    vfx.flashCircle(e.pos.x, e.pos.y, 0.22, 90, c);
  }));

  subs.push(bus.on('drop:spawned', (e) => {
    vfx.ring(e.pos.x, e.pos.y, 0.05, 0.35, 160, PALETTE.text, 0.04);
    if (e.kind !== 'coin') return;
    // pièce : petit reflet doré ; lâchée par la balle d'or (destruction à côté, même frame) : éclat
    const dx = e.pos.x - goldX, dy = e.pos.y - goldY;
    if (frame - goldFrame <= 1 && dx * dx + dy * dy < 1) {
      vfx.flashCircle(e.pos.x, e.pos.y, 0.32, 160, PALETTE.gold);
      vfx.rays(e.pos.x, e.pos.y, 260, PALETTE.gold, 8, 0.6);
      particles.burst(e.pos.x, e.pos.y, 10, PALETTE.gold, P_CRYSTAL, 1, 4, -Math.PI / 2, 1.4, 0.25, 0.45, 0.05, 0.08, 3, PRIO_NORMAL);
    } else {
      particles.burst(e.pos.x, e.pos.y, 3, PALETTE.goldLight, P_CRYSTAL, 0.5, 1.5, -Math.PI / 2, 1.2, 0.2, 0.35, 0.04, 0.06, 0, PRIO_LOW);
    }
  }));

  subs.push(bus.on('ball:grounded', (e) => {
    particles.burst(e.pos.x, e.pos.y, 2, PALETTE.textDim, P_SPARK, 0.5, 1.5, -Math.PI / 2, 0.8, 0.1, 0.2, 0.03, 0.04, 0, PRIO_LOW);
    const el = drawer.elementOf(e.ballId);
    if (el === EL_ECHO) {
      // écho : la copie fantôme repart d'ici → onde translucide double
      const c = colors.element[EL_ECHO] ?? PALETTE.split;
      vfx.ring(e.pos.x, e.pos.y - 0.05, 0.05, 0.55, 260, c, 0.04);
      vfx.ring(e.pos.x, e.pos.y - 0.05, 0.05, 0.9, 380, c, 0.025);
    } else if (el === EL_BOOMERANG) {
      vfx.ring(e.pos.x, e.pos.y - 0.05, 0.05, 0.4, 200, colors.element[EL_BOOMERANG] ?? PALETTE.fire, 0.04);
    }
  }));

  subs.push(bus.on('run:started', () => {
    particles.clear(); numbers.clear(); vfx.clear(); fusions.clear(); drawer.clearTrails(); drawer.suppressSpawnPop(); drawer.clearOverlays();
  }));
  // mesure par volée + bascule préventive (avant la 1re balle : la rafale part ~60 ms après)
  subs.push(bus.on('volley:start', (e) => {
    volleyCount = e.count;
    volleyFrames = 0;
    volleyMs = 0;
    if (e.count >= BIG_VOLLEY && lastBigVolleyAvg > PREVENTIVE_AVG_MS && sprites) lowerQuality(0.25);
  }));
  subs.push(bus.on('volley:end', () => {
    if (volleyCount >= BIG_VOLLEY && volleyFrames >= 20) lastBigVolleyAvg = volleyMs / volleyFrames;
  }));
  // rows:advanced : volontairement rien — l'interpolation easeOutBack dans draw suffit.

  // ------------------------------------------------------------------
  // API Renderer
  // ------------------------------------------------------------------
  return {
    draw(state, dtMs) {
      lastState = state;
      ensureSprites();
      if (state.wave !== backdropWave) rebuildBackdrops(state.wave); // changement de vague : rare
      const dt = (dtMs > 100 ? 100 : dtMs < 0 ? 0 : dtMs) / 1000;
      frame++;
      trackFrame(dtMs, state);
      vfx.update(dt);
      particles.update(dt);
      fusions.update(dt);
      numbers.update(dt);
      drawer.draw(state, dt, frame);
    },
    resize() {
      doResize();
    },
    screenToBoard(px: number, py: number): Vec2 {
      ensureSprites();
      return screenToBoard(layout, px, py);
    },
    boardToScreen(p: Vec2): Vec2 {
      ensureSprites();
      return boardToScreen(layout, p);
    },
    /** résolution interne courante (qualité adaptative), pour QA */
    get dpr() {
      return layout.dpr;
    },
    /** durée de la dernière bascule de qualité (ms), pour QA */
    get qualitySwitchMs() {
      return lastQualitySwitchMs;
    },
    debugLowerQuality(step: number) {
      return lowerQuality(step);
    },
    get particleCount() {
      return particles.count;
    },
    dispose() {
      for (const u of subs) u();
      subs.length = 0;
    },
  };
}
