---
name: engine-conventions
description: Conventions du projet Pegbreaker (Vite + TypeScript + Canvas 2D natif) — structure, propriétaires, API Sim, boucle, pooling, événements, checklist de fin de tâche.
---

# Conventions moteur — Pegbreaker

Lis d'abord `docs/ARCHITECTURE.md` et `src/core/types.ts`. **`core/` est en lecture seule** : si un type te manque, termine ta tâche avec un contournement local et demande le changement dans ton rapport.

## Règles
- TypeScript strict, `noUncheckedIndexedAccess` : `arr[i]` est `T | undefined`, gère-le (ou utilise `for..of`).
- Pas de `any`, pas de classe exposée dans l'état : `RunState` est du JSON pur (`structuredClone` doit marcher).
- Unités logiques dans la sim (1 cellule = 1), pixels uniquement dans `render/` et `ui/input.ts`.
- La sim n'importe **jamais** `document`, `window`, `Date`, `Math.random`, `performance`. Tout aléa passe par `createRng` (`core/rng.ts`). Tout temps vient du `dtMs` de `step`.
- Chaque module exporte une fonction `createX(...)` qui renvoie un objet implémentant l'interface de `types.ts`. Pas de singletons, pas d'état global de module.
- Les événements sont **produits** par la sim (renvoyés par `step`) et **consommés** par les autres via `bus.on('type', h)`. Ne jamais émettre d'événement depuis render/audio (sauf `ui:*` depuis ui).

## Boucle et pas fixe
```ts
// main.ts (architecte) — la sim reçoit des pas déjà scalés
acc += Math.min(dtReal, 100) * time.timeScale;
while (acc >= FIXED) { for (const e of sim.step(FIXED)) bus.emit(e); acc -= FIXED; }
renderer.draw(sim.state, dtReal);
```
Dans la sim, `step(dtMs)` découpe en sous-pas de `1000/240` ms pour la physique (pas de tunneling : vitesse × sous-pas < rayon, vérifié par `core/config.ts`).

## Pooling
```ts
// pattern : tableau + compteur, jamais de splice dans la boucle chaude
const pool: Ball[] = []; let live = 0;
function acquire(): Ball { const b = pool[live] ?? (pool[live] = makeBall()); live++; return b; }
function release(i: number): void { live--; const t = pool[i]!; pool[i] = pool[live]!; pool[live] = t; }
```
`RunState.balls` doit rester un tableau sérialisable : expose uniquement les `live` premières balles (`balls.length = live` est acceptable si le tableau appartient à l'état).

## Collisions (sim)
- Balle = cercle ; bloc = AABB (cellule `col..col+width`, `row..row+1`) ; peg = cercle de rayon 0,3 au centre de la cellule.
- Résolution : trouver l'axe de pénétration minimale, repousser la balle, réfléchir la vitesse (`core/math.reflect`), émettre `ball:bounce`.
- Murs : x ∈ [0, cols], plafond y = 0, sol y = rows (ligne du joueur) → `ball:grounded`.

## Tests
- Unitaires Vitest colocalisés `*.test.ts`. La sim doit avoir : déterminisme (`même seed → même snapshot après 200 tirs`), robustesse (`1 000 tirs aléatoires : aucun NaN, aucune balle hors [0,cols]×[0,rows]`), et un test par mécanique.
- Lance `npx vitest run <ton-dossier>` et `npx tsc --noEmit`. Les erreurs TypeScript **hors de tes dossiers** ne sont pas de ton ressort : signale-les, ne les corrige pas.

## Checklist de fin de tâche
- [ ] Je n'ai écrit que dans mes dossiers (`git status` pour vérifier).
- [ ] `npx tsc --noEmit` ne montre aucune erreur dans mes fichiers.
- [ ] Mes tests passent ; aucune constante d'équilibrage en dur (tout vient de `config`).
- [ ] Aucune allocation dans `step`/`draw` (pas de `new`, `[...]`, `{}` , `.map/.filter` par frame).
- [ ] Rapport final : fichiers touchés, ce qui marche, ce qui manque, demandes de changement dans `core/`.
