// ui/options.ts — présentation d'une RewardOption (nom, description, couleur, icône SVG inline).
import type { BallElement, BallTier, GameConfig, RelicRarity, RewardOption } from '../core/types';
import { clip } from './dom';
import { appendBallShape, elementTable } from './elements';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TIER_SUFFIX: Record<BallTier, string> = { 1: '', 2: ' II', 3: ' III' };
const RARITY_LABEL: Record<RelicRarity, string> = { common: 'Commune', rare: 'Rare', epic: 'Épique' };
const RARITY_COLOR: Record<RelicRarity, string> = { common: '#cfd6e6', rare: '#7fe4ff', epic: '#c08cff' };

export interface OptionView {
  /** catégorie lisible (info jamais portée uniquement par la couleur) */
  kind: string;
  name: string;
  desc: string;
  color: string;
}

export function ballColor(config: GameConfig, element: BallElement): string {
  return elementTable(config).get(element).color;
}

export function ballName(config: GameConfig, element: BallElement): string {
  return elementTable(config).get(element).name;
}

export function describeOption(config: GameConfig, o: RewardOption): OptionView {
  switch (o.kind) {
    case 'ball': {
      const info = elementTable(config).get(o.element);
      return {
        kind: o.tier > 1 ? `Balle · rang ${o.tier}` : 'Balle',
        name: info.name + TIER_SUFFIX[o.tier],
        desc: info.desc,
        color: info.color,
      };
    }
    case 'relic': {
      const def = config.relics.defs.find((d) => d.id === o.relicId);
      const rarity: RelicRarity = def?.rarity ?? 'common';
      return {
        kind: `Relique · ${RARITY_LABEL[rarity]}`,
        name: def?.name ?? o.relicId,
        desc: clip(def?.description ?? ''),
        color: RARITY_COLOR[rarity],
      };
    }
    case 'coins':
      return { kind: 'Pièces', name: 'Bourse', desc: `+${o.amount} pièces`, color: '#ffe95c' };
    case 'heal':
      return { kind: 'Soin', name: 'Soin', desc: `+${o.amount} PV`, color: '#ff7ab8' };
    case 'fuse': {
      const name = ballName(config, o.element);
      const from = o.tier > 1 ? ((o.tier - 1) as BallTier) : 1;
      const mult = String(config.balls.tierDamageMultiplier).replace('.', ',');
      const full = `2 × ${name + TIER_SUFFIX[from]} → 1 × ${name + TIER_SUFFIX[o.tier]} (dégâts ×${mult})`;
      return {
        kind: `Fusion · rang ${o.tier}`,
        name: `Fusion : ${name + TIER_SUFFIX[o.tier]}`,
        // sans le multiplicateur si la phrase dépasse 60 caractères
        desc: full.length <= 60 ? full : clip(`2 × ${name + TIER_SUFFIX[from]} → 1 × ${name + TIER_SUFFIX[o.tier]}`),
        color: ballColor(config, o.element),
      };
    }
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/** Icône 48×48 dessinée en SVG inline, selon le type d'option. */
export function optionIcon(config: GameConfig, o: RewardOption): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 48 48', width: 48, height: 48, 'aria-hidden': 'true', class: 'opt-icon' });
  const v = describeOption(config, o);
  switch (o.kind) {
    case 'ball': {
      // silhouette de la famille, teintée de la couleur de l'élément
      const info = elementTable(config).get(o.element);
      svg.dataset.family = info.family;
      appendBallShape(svg, info.family, v.color, o.tier, info.colors);
      break;
    }
    case 'relic': {
      // amulette : losange facetté
      svg.append(svgEl('polygon', { points: '24,4 42,20 24,44 6,20', fill: v.color }));
      svg.append(svgEl('polygon', { points: '24,4 33,20 24,44 15,20', fill: '#ffffff', opacity: 0.25 }));
      svg.append(svgEl('line', { x1: 6, y1: 20, x2: 42, y2: 20, stroke: '#0b0f1a', 'stroke-width': 2, opacity: 0.5 }));
      break;
    }
    case 'coins': {
      svg.append(svgEl('circle', { cx: 20, cy: 28, r: 13, fill: '#c9a51f' }));
      svg.append(svgEl('circle', { cx: 28, cy: 20, r: 13, fill: '#ffe95c' }));
      svg.append(svgEl('circle', { cx: 28, cy: 20, r: 8, fill: 'none', stroke: '#c9a51f', 'stroke-width': 2.5 }));
      break;
    }
    case 'heal': {
      svg.append(svgEl('path', { d: 'M24 42 L7 25 A9.5 9.5 0 0 1 24 13 A9.5 9.5 0 0 1 41 25 Z', fill: '#ff7ab8' }));
      svg.append(svgEl('rect', { x: 21, y: 19, width: 6, height: 16, rx: 1.5, fill: '#ffffff' }));
      svg.append(svgEl('rect', { x: 16, y: 24, width: 16, height: 6, rx: 1.5, fill: '#ffffff' }));
      break;
    }
    case 'fuse': {
      // deux disques qui convergent vers un anneau central
      svg.append(svgEl('circle', { cx: 9, cy: 30, r: 6.5, fill: v.color, opacity: 0.85 }));
      svg.append(svgEl('circle', { cx: 39, cy: 30, r: 6.5, fill: v.color, opacity: 0.85 }));
      svg.append(svgEl('path', { d: 'M15 27 L19 25 M33 27 L29 25', stroke: v.color, 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
      // silhouette de famille au centre (réduite), anneau(x) du rang obtenu
      const info = elementTable(config).get(o.element);
      const fam = info.family;
      svg.dataset.family = fam;
      svg.append(svgEl('circle', { cx: 24, cy: 20, r: 13, fill: 'none', stroke: v.color, 'stroke-width': 3 }));
      if (o.tier >= 3) svg.append(svgEl('circle', { cx: 24, cy: 20, r: 17, fill: 'none', stroke: v.color, 'stroke-width': 2 }));
      const g = svgEl('g', { transform: 'translate(24 20) scale(0.62) translate(-24 -24)' });
      appendBallShape(g, fam, v.color, 1, info.colors);
      svg.append(g);
      break;
    }
  }
  return svg;
}
