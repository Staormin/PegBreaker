---
name: playtest-qa
description: QA automatisée de Pegbreaker — bot Playwright qui joue via window.__pegbreaker, détection crash/softlock/erreurs console, métriques de fun (temps avant première récompense, décisions/min, durée de run, moments morts), format du rapport docs/qa/*.md.
---

# Playtest QA — Pegbreaker

Le QA **ne corrige jamais** le code du jeu : il écrit des tests dans `tests/e2e/`, des rapports dans `docs/qa/`, et décrit précisément les bugs (étapes, seed, état).

## Accès au jeu
`window.__pegbreaker: DebugApi` (voir `core/types.ts`) : `sim` (état + actions), `bus.onAny`, `eventCounts`, `setSpeed(n)`, `fps`, `errors`, `firstRewardAt`.

```ts
const api = () => (window as any).__pegbreaker;
await page.goto('/'); await page.waitForFunction(() => (window as any).__pegbreaker?.sim);
const state = await page.evaluate(() => api().sim.state);
```
Pour jouer : préférer le **vrai input** (pointer events sur le canvas) pour les tests d'intégration, et les appels directs `sim.aim/fire` pour les tests de volume (10 runs).

## Stratégies de bot (dans `tests/e2e/bots.ts`)
- `naive` : vise le bloc le plus bas avec un jitter aléatoire ±10°. Simule un joueur débutant.
- `greedy` : pour 24 angles candidats, utilise `sim.preview(dir)` et choisit l'angle dont le premier impact touche le bloc le plus bas à gauche/droite d'un mur (favorise les coincements) ; choisit toujours la récompense `ball` si la volée < 8, sinon la relique rare.
- Récompense : clic sur la carte via le DOM (`[data-reward-index]`) pour tester l'UI, ou `sim.chooseReward`.

## Métriques à produire (par run et agrégées)
| Métrique | Définition | Cible |
|---|---|---|
| Temps avant première récompense | `firstRewardAt − navigationStart` | < 10 s (bot naïf avec délais humains : 1,5 s de visée) |
| Décisions / minute | (tirs + choix de récompense + achats) / minutes simulées | ≥ 8 |
| Durée d'une run | `stats.durationMs` + temps d'UI | run 1 : 3-5 min ; run 5 : 6-10 min |
| Moments morts | fenêtres > 5 s sans aucun événement de feedback (`ball:*`, `block:*`, `drop:*`, `combo:*`, `reward:*`) hors écrans de choix | 0 |
| Progression run1→run5 | dégâts max/tir, vague atteinte, taille de volée | strictement croissants avec la méta ; stables sans méta |
| Erreurs console | `page.on('console')` type error + `api().errors` | 0 |
| fps | `api().fps` min sur la run | ≥ 55 (CPU 4× : ≥ 50) |

## Détection
- **Crash** : exception, `errors.length > 0`, page qui ne répond plus (`page.evaluate` timeout).
- **Softlock** : `phase` inchangée et `eventCounts` figés pendant 10 s simulées hors `reward/shop/gameover` ; ou `firing` > `maxVolleyMs + 2 s`.
- **Invariants** après chaque tir : `hp ≤ maxHp`, `0 ≤ balles.pos ≤ bornes`, `volley.length ≥ 1`, aucun `NaN` dans `state` (`JSON.stringify` et regex `NaN|null` sur les champs numériques), `blocks` sans doublon de cellule.

## Format du rapport `docs/qa/<jalon>.md`
1. Résumé en 5 lignes : verdict (OK / à corriger), les 3 problèmes majeurs.
2. Tableau des métriques (ci-dessus) par run et moyenne.
3. Bugs : ID, gravité (bloquant / majeur / mineur), seed, étapes, attendu/observé, fichier suspect si évident.
4. Observations de fun : ce qui est satisfaisant, ce qui est plat, 3 propositions concrètes d'ajustement (paramètre JSON + valeur suggérée).
5. Captures (`test-results/*.png`) : début de run, volée de 30 balles, écran de récompense, mobile 375 × 812.

## Checklist
- [ ] `npm run build` puis `npm run test:e2e` passent (le webServer Playwright sert `dist/`).
- [ ] Les tests sont déterministes (seed fixée via `sim.restart('qa-1')`) et finissent < 3 min.
- [ ] Rapport écrit avec les chiffres réels, pas d'estimation.
