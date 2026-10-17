---
name: perf-web
description: Budget de performance Pegbreaker — 60 fps sur mobile moyen, zéro allocation dans la boucle, canvas efficace, mesure avec __pegbreaker.fps et Playwright CPU throttling, taille du bundle.
---

# Performance web — Pegbreaker

## Budget
- 16,6 ms par frame, cible interne : sim ≤ 3 ms, draw ≤ 6 ms, UI ≤ 1 ms sur un CPU 4× ralenti (Chrome DevTools / Playwright `Emulation.setCPUThrottlingRate`).
- Bundle JS gzip ≤ 120 ko. Aucune dépendance runtime.
- Temps jusqu'au premier tir possible ≤ 1 s après chargement sur réseau rapide.

## Interdits dans `step()` et `draw()`
- `new`, littéraux `{}`/`[]`, `.map/.filter/.reduce/.slice/.concat`, spread, `Array.from`, closures créées par frame, `JSON.*`, `structuredClone`, template strings pour le texte affiché (cache les chaînes de PV : les mettre à jour seulement quand `hp` change).
- `ctx.save()/restore()` en masse : préférer régler l'état une fois par groupe. `ctx.measureText` par frame (cache). Gradients/ombres créés par frame (`shadowBlur` est très coûteux : réservé aux sprites pré-rendus).
- `getBoundingClientRect` par frame (cache au resize). `document.querySelector` par frame (références gardées).

## Patterns
- Pools (balles, particules, nombres de dégâts, événements). Les événements de `step` peuvent être des objets réutilisés **si** `step` documente que le tableau est invalidé au prochain appel (c'est le cas : voir `Sim.step`).
- Collisions : broad phase par grille (les blocs sont déjà sur une grille : tester seulement les cellules voisines de la balle), pas O(balles × blocs).
- `ctx.setTransform` une fois par frame pour passer en unités plateau ; dessin des sprites par `drawImage` (pré-rendus).
- Device pixel ratio plafonné à 2.
- Texte : les nombres de PV sont dessinés par `fillText` avec `textAlign center` ; si > 40 blocs, pré-rendre les chiffres 0-9 en sprites.
- `requestAnimationFrame` seul ; pas de `setInterval`. Onglet caché → `visibilitychange` met en pause.

## Mesure
- `window.__pegbreaker.fps` (moyenne glissante 1 s) exposé par `main.ts`.
- Playwright : `const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });` puis lire `fps` pendant une volée de 30 balles.
- Profil local : `npm run dev`, DevTools Performance, chercher les barres jaunes (scripting) > 8 ms et les GC (dents de scie mémoire = allocations).

## Checklist
- [ ] Mémoire plate sur 2 minutes de jeu (pas de dents de scie > 2 Mo).
- [ ] fps ≥ 55 en CPU 4× avec 30 balles et 500 particules.
- [ ] `npm run build` : taille du bundle notée dans le rapport.
