# PEGBREAKER — Architecture

## Stack

**Vite + TypeScript + Canvas 2D natif** (pas de moteur). Trois raisons :
1. La physique est triviale (cercles contre rectangles/cercles, réflexion parfaite, < 100 entités) : un moteur n'apporterait que du poids et des abstractions à contourner pour le juice (hit-stop, time scale, shake maîtrisés à la main).
2. Zéro dépendance runtime : bundle < 100 ko, démarrage < 1 s sur mobile, build statique trivialement hors ligne.
3. La simulation est **pure et déterministe** (aucun accès au DOM ni à l'horloge), donc testable en Node avec Vitest à des milliers de tirs par seconde, et rejouable depuis une seed.

Outils : Vitest (unitaires sim), Playwright (bot de jeu headless, métriques de fun), ESLint non requis (tsc strict suffit).

## Arborescence et propriétaires

```
pegbreaker/
├── index.html                 architecte
├── package.json, vite.config.ts, tsconfig.json, playwright.config.ts   architecte
├── public/                    ui-dev        (manifest.webmanifest, icône SVG générée)
├── src/
│   ├── main.ts                architecte    bootstrap : crée sim, renderer, audio, UI ; boucle rAF ; expose window.__pegbreaker
│   ├── core/                  architecte    CONTRAT PARTAGÉ — modification uniquement via l'architecte
│   │   ├── types.ts           tous les types partagés (état, événements, config, sauvegarde, API Sim)
│   │   ├── events.ts          EventBus typé
│   │   ├── rng.ts             PRNG seedé (mulberry32) + hash de chaîne
│   │   ├── math.ts            Vec2, clamp, lerp, easing
│   │   └── config.ts          charge et valide les JSON de config/
│   ├── sim/                   gameplay-dev  simulation pure : physique, balles, blocs, volée, fusion, combo,
│   │                                        vagues, drops, machine à états de la run, offres de récompense, boutique
│   ├── systems/               systems-dev   sauvegarde, méta (le Puits), succès, défi quotidien, modificateurs méta → sim
│   ├── render/                feel-artist   renderer canvas, sprites procéduraux, particules, VFX (shake, flash, hit-stop), tweens, palette
│   ├── audio/                 audio-dev     moteur WebAudio, SFX synthétisés, musique générative, mixage
│   ├── ui/                    ui-dev        input (drag-to-aim), HUD, écrans (titre, récompense, boutique, fin, Puits), responsive, CSS
│   └── config/                JSON d'équilibrage, un propriétaire par fichier :
│       ├── balls.json         gameplay-dev   types de balles, dégâts, multiplicateur de rang
│       ├── blocks.json        gameplay-dev   types de blocs, drops
│       ├── waves.json         gameplay-dev   courbe PV/densité, apparition des types, boss
│       ├── relics.json        gameplay-dev   reliques et rareté
│       ├── economy.json       systems-dev    prix boutique, pièces, fragments, reroll
│       └── meta.json          systems-dev    arbre du Puits, succès
├── tests/
│   └── e2e/                   qa-tester     Playwright : bot autonome, métriques, détection crash/softlock
└── docs/                      architecte    DESIGN.md, ARCHITECTURE.md, TASKS.md, rapports QA (qa-tester écrit docs/qa/)
```

Tests unitaires : colocalisés `*.test.ts` dans le dossier du propriétaire.

**Règle absolue** : un agent n'écrit que dans ses dossiers. Besoin d'un type ou d'un événement supplémentaire → demande à l'architecte (dans son rapport de fin), il ne modifie pas `core/`.

## Modules et interfaces

Toutes les interfaces sont dans [`src/core/types.ts`](../src/core/types.ts). Résumé :

### `sim` → expose `createSim(config, options): Sim`
- `Sim.state: Readonly<RunState>` : état complet de la run, sérialisable (aucune classe, aucune fonction, aucun Map).
- `Sim.step(dtMs): GameEvent[]` : avance la simulation (sous-pas fixes internes, pas de tunneling à vitesse max) et renvoie les événements émis pendant ce pas. Le `dtMs` reçu est déjà multiplié par le `timeScale` (hit-stop) par `main.ts`.
- Actions : `aim(dir)`, `fire()`, `recall()`, `chooseReward(i)`, `skipReward()`, `buy(i)`, `reroll()`, `leaveShop()`, `restart(seed?)`.
- `Sim.preview(dir): Vec2[]` : points de la ligne de visée jusqu'au premier rebond inclus (pour le renderer).
- `Sim.snapshot()` / `createSim(..., { snapshot })` : reprise d'une run.
- Entrées de la sim : `GameConfig`, `MetaModifiers` (fournis par `systems`), seed. **Rien d'autre** : pas de DOM, pas de `Date`, pas de `Math.random`.

### `render` → expose `createRenderer(canvas, bus, time): Renderer`
- `Renderer.draw(state, alpha)` chaque frame ; lit `state` en lecture seule.
- S'abonne au `EventBus` pour les effets (particules, shake, flash, nombres de dégâts) et appelle `time.requestHitStop(ms)` / `time.requestSlowMo(scale, ms)` via l'interface `TimeControl` (implémentée dans `main.ts`).
- Gère le redimensionnement : plateau en unités logiques (7 × 10 cellules) → pixels avec un `fit` portrait.

### `audio` → expose `createAudio(bus, settings): AudioSystem`
- S'abonne au bus. Déverrouillage de l'`AudioContext` au premier pointerdown (fourni par `ui` via `AudioSystem.unlock()`).
- Tous les sons sont synthétisés (oscillateurs, bruit filtré, enveloppes). Pitch du rebond lié au combo.

### `ui` → expose `createUI(root, sim, bus, audio, meta): UI`
- Input : pointer events sur le canvas → `sim.aim(dir)` pendant le drag, `sim.fire()` au relâchement, bouton rappel → `sim.recall()`.
- HUD et écrans en DOM (HTML/CSS) superposés au canvas ; lisibles, grands boutons tactiles (≥ 48 px).
- Écrans : titre (apparaît uniquement au tout premier lancement, le jeu démarre direct ensuite), récompense, boutique, fin de run, le Puits, réglages.

### `systems` → expose `createMeta(storage): MetaSystem`
- `load()/save()` vers localStorage (clé `pegbreaker.save.v1`), migration par `version`.
- `getModifiers(): MetaModifiers` consommés par `createSim`.
- `onRunEnd(summary)` : crédite les fragments, vérifie les succès, journalise le quotidien.
- `dailySeed(date)` : seed déterministe depuis la date.

### `main.ts` (architecte)
- Boucle : `requestAnimationFrame` → accumulateur → `sim.step(fixedDt × timeScale)` → dispatch des événements sur le bus → `renderer.draw`.
- Implémente `TimeControl` (hit-stop : timeScale 0 pendant N ms ; slow-mo).
- Expose `window.__pegbreaker: DebugApi` (état, actions, compteurs d'événements, `setSpeed()`) pour Playwright.

## Système d'événements

`EventBus<GameEvent>` dans `core/events.ts` : `on(type, handler): unsubscribe`, `emit(event)`. `GameEvent` est une union discriminée sur `type` (voir `types.ts`) : `ball:bounce`, `block:hit`, `block:destroyed`, `block:breached`, `combo:milestone`, `volley:start`, `volley:end`, `volley:fusion`, `drop:spawned`, `drop:collected`, `wave:cleared`, `boss:spawned`, `reward:offered`, `reward:chosen`, `shop:opened`, `shop:bought`, `player:damaged`, `player:healed`, `run:started`, `run:over`, `meta:unlocked`, `ui:click`.

Règles : la sim **produit** des événements (renvoyés par `step`), elle ne s'abonne jamais. `render`, `audio`, `ui`, `systems` **consomment**. Un événement porte des données brutes (positions en unités logiques, valeurs), jamais de référence à un objet vivant.

## Données de config

JSON dans `src/config/`, importés statiquement (Vite les inline) et validés par `core/config.ts` au démarrage (erreur explicite si une clé manque). Toute constante d'équilibrage y vit : PV, dégâts, multiplicateurs, probabilités, prix, courbe. Le code ne contient **aucun nombre magique d'équilibrage**. Les formules sont décrites dans la skill `balancing`.

Plateau : 7 colonnes × 10 rangées logiques (rangée 0 en haut, rangée 9 = ligne du joueur). Cellule = 1 unité. Rayon de balle 0,12. Vitesse 14 u/s. Ces constantes géométriques sont dans `config/blocks.json` (`board`).

## Format de sauvegarde

`localStorage["pegbreaker.save.v1"]` → `SaveData` (voir `types.ts`) :

```json
{
  "version": 1,
  "meta": { "fragments": 120, "nodes": { "hp1": 2, "balls1": 1 }, "unlockedElements": ["stone","fire"], "unlockedRelics": ["bouncy"] },
  "stats": { "runs": 12, "bestDepth": 9, "bestCombo": 31, "bestShotDamage": 4120, "totalFragments": 600 },
  "achievements": ["combo10", "fusion2"],
  "daily": { "2026-10-16": { "depth": 7, "score": 1234 } },
  "currentRun": null,
  "settings": { "sfx": 0.8, "music": 0.5, "shake": true, "reduceMotion": false }
}
```

`currentRun` contient un `RunSnapshot` (état sérialisable de la sim + état du PRNG) pour reprendre après fermeture. Écriture : à chaque changement de phase de la run et toutes les 5 s en jeu. Lecture tolérante : clé manquante → valeur par défaut ; `version` inconnue → sauvegarde ignorée et renommée `pegbreaker.save.backup`.

## Conventions transverses

- TypeScript strict, `noUncheckedIndexedAccess`. Pas de `any`.
- Aucune allocation dans les boucles chaudes (sim `step`, renderer `draw`) : pools pour balles, particules, nombres de dégâts ; tableaux réutilisés.
- Unités logiques partout dans la sim ; la conversion pixels n'existe que dans `render` et `ui/input`.
- Textes UI en français, courts, icônes quand possible.
- Commits par tâche, message `T<ID>: <résumé>`.
