---
name: procedural-assets
description: Assets 100 % code pour Pegbreaker — palette imposée, sprites canvas pré-rendus (offscreen), formes des blocs/balles/drops, icône SVG, fond. Aucun fichier image externe.
---

# Assets procéduraux — Pegbreaker

## Palette (imposée)
```ts
export const PALETTE = {
  bg0: '#0b0f1a', bg1: '#121a2b', grid: '#1b2740', wall: '#2a3a5c',
  text: '#e8ecf5', textDim: '#8a94a8', accent: '#ffe95c', danger: '#ff5e5e', good: '#5cff9d',
  stone: '#cfd6e6', fire: '#ff7a3d', lightning: '#ffe95c', ice: '#7fe4ff', ghost: '#c08cff', lead: '#6b7280', split: '#5cff9d',
  block: '#4f7cff', peg: '#e8ecf5', explosive: '#ff5e5e', heart: '#ff7ab8', armored: '#8a94a8', boss: '#b23cff',
} as const;
```
Les couleurs des éléments/blocs sont aussi dans les JSON de config : **la config fait foi**, la palette sert au reste de l'UI.

## Principes
- Formes simples, lisibles à 360 px de large : bloc = rectangle arrondi (rayon 12 % de la cellule) avec un liseré plus clair en haut (1 px) et une ombre plus sombre en bas ; les PV en gras centrés, blanc, taille ∝ hauteur de cellule × 0,42, contour sombre 3 px pour la lisibilité.
- Pré-rendre dans des `OffscreenCanvas` (ou canvas cachés) à la résolution d'affichage, régénérer au `resize()`. Un sprite par (kind, taille). **Jamais** de `createRadialGradient` dans la boucle de dessin.
- Balles : disque plein couleur élément + reflet blanc décalé (−30 %, −30 %), rang 2 = anneau, rang 3 = double anneau + léger glow (sprite pré-rendu avec `shadowBlur`, une fois).
- Peg : disque clair avec un point central sombre.
- Blindé : bande hachurée sur la face protégée.
- Explosif : triangle « ! » en négatif.
- Cœur : forme de cœur par deux arcs + triangle.
- Boss : rectangle large, deux yeux (disques) qui suivent la balle la plus proche (effet gratuit et très efficace).
- Fond : dégradé vertical bg0→bg1 pré-rendu + grille très discrète (alpha 0,06) + 20 « poussières » qui dérivent lentement.
- Icône PWA : `public/icon.svg` dessiné à la main (balle + bloc), référencé dans le manifest (`ui-dev`).

## Snippet : sprite pré-rendu
```ts
function makeBlockSprite(w: number, h: number, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
  const g = c.getContext('2d')!; const r = h * 0.12;
  g.fillStyle = color; g.beginPath(); g.roundRect(1, 1, w - 2, h - 2, r); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(3, 2, w - 6, 2);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(3, h - 4, w - 6, 2);
  return c;
}
```

## Checklist
- [ ] Aucun `<img>`, aucune URL d'image, aucune police externe (system-ui / sans-serif).
- [ ] Sprites régénérés au resize, jamais par frame.
- [ ] Lisible en 360 × 640 et en 1440 × 900 (capture d'écran Playwright des deux).
