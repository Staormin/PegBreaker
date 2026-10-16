# QA — Plan fun, lot 1 (F1 à F7)

Build mesuré : arbre de travail du 2026-10-16 (lot 1 non commité, version affichée `0.4.0-j4`), bundle **195,3 ko brut, 67,95 ko gzip** (budget 120 ko). Référence « avant » : build `7a33cab`, [`final.md`](final.md) et [`final-metrics.json`](final-metrics.json), restés intacts.

Pour rejouer : `fuser -k 4173/tcp; npm run build && npm run test:e2e`. Dernier passage : **35 tests sur 35 verts en 2 min 46** (budget 8 min). Ce total compte 1 échec attendu (`test.fail`) qui documente le bug F6-01.

Données brutes :

| Fichier | Contenu |
|---|---|
| [`lot1-fun.json`](lot1-fun.json) | 5 runs naïf et 5 runs « contrats » : métriques par run, moyennes, et le bloc `before` |
| [`lot1-metrics.json`](lot1-metrics.json) | `metrics.spec` sur le build du lot 1 : naïf et greedy **sans éventail** (même bot qu'avant) |
| [`lot1-progression.json`](lot1-progression.json) | progression de la run 1 à la run 5 avec méta |
| `lot1-*.json` | autres sorties de la suite (feel, audio, mobile, hors ligne, onboarding) |

## 1. Résumé

**Verdict : à corriger (1 bug majeur), mais le lot 1 multiplie nettement le fun mesuré.**

- Pour un débutant, l'éventail (F1) double les tirs à combo ≥ 5 (**20 % → 39 %**) et allonge la run 1 de **2,6 à 4,1 min**. La cible FUN.md (≥ 4 min) est atteinte.
- Les contrats (F2) donnent un objectif à presque chaque vague : 6 à 10 contrats par run, réussis à **39 %** (naïf) et **52 %** (bot qui les lit). Deux contrats sont presque impossibles : « Ramasse 20 pièces » (**19 %**) et « Nettoie en 6 tirs » (**17 %**).
- **Problème 1, F6-01 (majeur)** : une run jouée depuis un lien de défi n'est jamais créditée. L'écran de fin affiche « +34 ◆ » et « Nouveau record », mais `stats.runs` et les fragments restent à 0.
- **Problème 2, F1-01 (design)** : l'ouverture dépend de la longueur du geste. **83 %** des tirs d'un débutant ouvrent l'éventail sans qu'il le veuille. Et l'éventail domine : même pour faire du combo, la rafale serrée contre un mur fait moins bien (**32 %** de combo ≥ 5 contre **42 %**).
- **Problème 3, F3-01 (fun)** : la balle dorée se dilue avec la volée. Elle pèse **16 %** des dégâts à 5 balles, mais **3 %** à 29 balles.

## 2. Tableau avant / après

« Avant » : build `7a33cab`, bot naïf sans éventail, seeds qa-1 à qa-5.

Les colonnes « après » portent sur le même build du lot 1, mesuré de trois façons :

| Colonne | Bot | Éventail |
|---|---|---|
| **sans éventail** | naïf de `metrics.spec` | jamais ouvert |
| **naïf** | naïf de `fun.spec` | geste de débutant de 40 à 320 px CSS, converti comme `ui/input.ts` |
| **contrats** | naïf qui lit le contrat et prend la seconde chance | geste de débutant, sauf dans les cas de contrat |

Le bot « contrats » vise un mur en rafale serrée pour les contrats de combo et de casse. Pour les contrats de pièces et de balles, il vise les blocs proches des drops. Il ouvre l'éventail à fond quand une rangée compte au moins 4 blocs et que le contrat demande de nettoyer la vague en N tirs.

| Métrique (moyenne sur 5 runs) | Cible | Avant | Après, sans éventail | Après, naïf | Après, contrats |
|---|---|---|---|---|---|
| Décisions par tir (direction, + 1 si ouverture ≠ 0) | ≥ 2 | 1,0 | 1,0 | **1,83** (83 % involontaires) | **1,61** |
| Décisions/min (temps joueur) | ≥ 8 | 18,5 | 18,5 | 27,4 | 22,7 |
| Tirs à combo ≥ 5 | ≥ 30 % (bot qui suit les contrats) | 10 % | 20 % | **39 %** | **44 %** ✅ |
| Tirs à combo ≥ 8 (combo affiché sur la balle, F7) | — | — | — | 21 % | 28 % |
| Contrats offerts par run | — | — | — | 6,2 | 10,0 |
| Contrats réussis par run | — | — | — | 2,4 (39 %) | **5,2 (52 %)** |
| Durée de la run 1 (temps joueur) | ≥ 4 min | 2,64 min | 2,58 min | **4,08 min** ✅ | 8,44 min |
| Vague de la première mort | 3-4 | 5,2 | 5,2 | 6,6 | 9,2 |
| Vague finale | — | 5,2 | 5,2 | 6,6 | 11,0 |
| Runs reprises par seconde chance | — | — | — | 0 (abandonne) | **5/5** (gratuite en run 1) |
| Gain de la revanche | — | — | — | — | **+1,8 vague**, profondeur +23,8 (+30 %) |
| Première récompense (qa-1, vitesse 1, 1,5 s de visée) | < 10 s | 2,2 s | 2,3 s | 2,19 s | — |
| Premier écran de choix (temps joueur) | ~25 s | 23,8 s | 19,6 s | 20,1 s | 14,4 s |
| Balle dorée : lancers par tir | 1 | — | — | 1,00 | 1,00 |
| Balle dorée : part des dégâts | — | — | — | 16 % | 8 % |
| Tirs où la balle dorée casse un bloc | — | — | — | 21 % | 14 % |
| Moments morts (> 5 s sans feedback) | 0 | 0 | 0 | **0** (trou max 1,55 s) | **0** (0,9 s) |
| Erreurs console et page | 0 | 0 | 0 | **0** | **0** |
| `run:over` par run terminée | 1 | — | 1 | 1 | 1 |

Ce qu'il faut retenir :

- **L'éventail fait presque tout.** Sur le même build, le même bot naïf passe de 20 % à 39 % de combo ≥ 5 dès qu'il ouvre l'éventail. Sa vague de mort passe de 5,2 à 6,6 et sa run de 2,6 à 4,1 min.
- **Le 10 % → 20 % sans éventail** vient du reste du lot : rééquilibrage de `waves.json`, balle dorée.
- **Greedy sans éventail** ([`lot1-metrics.json`](lot1-metrics.json)) : vague de mort 7,6 (5,4 avant), combo ≥ 5 à 30 % (20 % avant), run de 4,3 min.

### Runs « après », par seed

| Bot / seed | Tirs | Déc./tir | Combo ≥ 5 | Contrats offerts / réussis / ratés | Durée (min) | 1re mort (vague) | Vague finale | Profondeur | Revanche | Or : part des dégâts |
|---|---|---|---|---|---|---|---|---|---|---|
| naïf qa-1 | 29 | 1,86 | 24 % | 4 / 2 / 1 | 1,84 | 4 | 4 | 29 | non | 21 % |
| naïf qa-2 | 88 | 1,84 | 44 % | 9 / 6 / 3 | 7,19 | 10 | 10 | 88 | non | 12 % |
| naïf qa-3 | 46 | 1,83 | 33 % | 5 / 2 / 3 | 3,38 | 6 | 6 | 46 | non | 15 % |
| naïf qa-4 | 48 | 1,88 | 42 % | 6 / 1 / 5 | 3,41 | 6 | 6 | 48 | non | 18 % |
| naïf qa-5 | 62 | 1,74 | 50 % | 7 / 1 / 6 | 4,58 | 7 | 7 | 62 | non | 13 % |
| contrats qa-1 | 72 | 1,79 | 43 % | 7 / 4 / 2 | 5,52 | 7 | 8 | 72 | oui | 12 % |
| contrats qa-2 | 204 | 1,71 | 61 % | 18 / 11 / 7 | **17,89** | 16 | 19 | 204 | oui | 3 % |
| contrats qa-3 | 108 | 1,56 | 46 % | 10 / 5 / 5 | 8,59 | 11 | 12 | 108 | oui | 4 % |
| contrats qa-4 | 57 | 1,40 | 28 % | 7 / 2 / 4 | 3,66 | 6 | 7 | 57 | oui | 14 % |
| contrats qa-5 | 80 | 1,60 | 44 % | 8 / 4 / 4 | 6,56 | 6 | 9 | 80 | oui | 9 % |

Un contrat qui n'est ni réussi ni raté était encore actif à la mort.

### Contrats, par type (les 10 runs)

| Contrat | Offerts | Réussis | Taux | Lecture |
|---|---|---|---|---|
| `destroyInOneShot` (smash3 / smash5) | 12 | 10 | **83 %** | bon objectif ; la rafale serrée au mur marche (7 sur 8 pour le bot contrats) |
| `reachCombo` (combo8 / combo16) | 15 | 10 | 67 % | bon |
| `killWithElement` (fire3 / bolt3) | 6 | 4 | 67 % | bon |
| `noDamage` (clean) | 10 | 5 | 50 % | OK |
| `goldenKill` (gold2) | 5 | 2 | 40 % | OK |
| `collectBalls` (balls2) | 5 | 2 | 40 % | OK |
| `collectCoins` (coins20) | 16 | 3 | **19 %** | trop dur : 0 sur 6 pour le naïf |
| `clearUnderShots` (fast6) | 12 | 2 | **17 %** | trop dur, même avec l'éventail plein sur les rangées pleines |

## 3. Verdict par mécanisme

| # | Mécanisme | Verdict | Chiffre |
|---|---|---|---|
| F1 | Tir en éventail | **multiplie le fun** (réserve F1-01) | Combo ≥ 5 : 20 % → 39 %. Run 1 : 2,6 → 4,1 min. Vague de mort : 5,2 → 6,6. Mais 83 % des ouvertures sont involontaires, et l'éventail est dominant. |
| F2 | Contrats de vague | **multiplie le fun** (2 contrats à revoir) | 6,2 à 10 contrats par run. Réussite : 39 % (naïf), 52 % (bot qui les lit). Le bot qui lit les contrats va 2,6 vagues plus loin avant sa première mort (9,2 contre 6,6). coins20 : 19 %, fast6 : 17 %. |
| F3 | Balle dorée | **neutre** | Exactement 1 par volée (1,00). 16 % des dégâts à 5-10 balles, mais **3 à 4 %** à 20-29 balles (qa-2, qa-3 en « contrats »). Elle ne casse un bloc que dans 14 à 21 % des tirs. |
| F4 | Seconde chance | **multiplie le fun** | 5 runs sur 5 la prennent en run 1. Gain : **+1,8 vague**, profondeur +30 %. Une seule `run:over` par run, `stats.runs` = 1 après revanche puis abandon. Coût payant débité, et débit persisté. |
| F5 | Presque-record | **neutre** (pas mesurable par bot ; fonctionne) | `.hud-record` « Record V7 » affiché. L'écran revanche dit « À N vagues du record ». En défi, « Nouveau record » s'affiche pour une run qui n'est pas enregistrée (F6-01). |
| F6 | Carte de score et défi par lien | **à revoir** | Carte 1080×1350 PNG de **336 ko**, lien `?seed=qa-1&goal=33` copié, téléchargement déclenché. Le défi rejoue la même graine **à l'identique** (P33 contre P33, déterministe). Mais la run de défi n'est pas créditée (F6-01), et l'égalité s'affiche « ✗ Défi raté » (F6-02). |
| F7 | Combo visible sur la balle | **neutre** (non vérifié à l'image) | Le combo ≥ 8 apparaît sur 21 % des tirs du naïf et 28 % de ceux du bot contrats. Le rendu canvas n'est pas vérifiable par le DOM ; aucune capture ne le montre de façon fiable. |

## 4. Bugs

| ID | Gravité | Seed / test | Étapes | Attendu | Observé | Fichier suspect |
|---|---|---|---|---|---|---|
| **F6-01** | **majeur** | `qa-1`, `share.spec.ts` « BUG F6-01 connu » (`test.fail`) | 1. Ouvrir `/?seed=qa-1&goal=10` sur un profil vierge. 2. Jouer jusqu'à la mort (bot naïf, vitesse 8). 3. Abandonner. 4. Lire `meta.data`. | La run de défi compte : `stats.runs` = 1, fragments crédités comme affichés, record enregistré | L'écran affiche « **+34 ◆** » et « ★ Nouveau record : vague 4 ». Pourtant `stats.runs` = **0**, `fragments` = **0**, `bestWave` = 0. Pour un ami qui ouvre le lien, sa première run ne compte pas. Autre effet : la revanche reste gratuite à chaque défi, car `stats.runs` reste à 0. | `src/main.ts` : `bus.on('run:over')` fait `if (forcedSeed) return`, et `persistRun` fait de même. `?seed=` sert à la fois au debug QA et au lien de défi. Piste : ne sauter `onRunEnd` que si `goal` est absent, ou prévoir un paramètre QA dédié. |
| F6-02 | mineur (UX) | `qa-1`, `share.spec.ts` | Rejouer le défi P33 et finir à P33. | « Égalité » ou un message neutre | « ✗ Défi raté : P33 / P33 » ; capture `fun-shots/08-defi-resultat.png` | `src/ui/screens/gameover.ts` (`won = summary.depth > goal`, sans cas d'égalité) |
| F4-01 | mineur (contrat d'interface) | `rev-1`, `revive.spec.ts` (annotation `ui:screen`) | Mourir, l'écran « Revanche ? » s'ouvre, cliquer « Seconde chance ». | `ui:screen` vaut `'revive'` : le type `UiScreen` l'inclut depuis le lot 1 | Le bus reçoit `'gameover'`, puis `'game'` après la revanche, et `ui.screen` renvoie `'gameover'`. Un consommateur (audio, analytics) croit à une fin de run qui n'a pas eu lieu. Le DOM, lui, est correct : `#ui[data-screen="revive"]`. | `src/ui/index.ts` (l. ~207 `pub = next === 'revive' ? 'gameover' : next`, et le getter `screen`). Le commentaire « 'revive' n'existe pas dans UiScreen » est périmé. |
| F4-02 | info | `revive.spec.ts`, cas payant | Profil avec `stats.runs` = 1 et 100 ◆, puis mort et revanche. | Débit de 25 ◆ (consigne et `HEAD`) | Débit de **30 ◆** (100 → 70, persisté). `src/config/economy.json` non commité : `revive.cost` 25 → 30. Le test suit la config. | `src/config/economy.json` : à confirmer par l'équilibrage |
| F2-01 | mineur (équilibrage) | qa-1 à qa-5 | Voir la table des contrats. | Contrats réussissables environ une fois sur deux | `coins20` : 3 sur 16. `fast6` : 2 sur 12. | `src/config/contracts.json` |
| F1-01 | mineur (design) | qa-1 à qa-5 | Un débutant vise en glissant plus ou moins loin. | L'ouverture est un choix | Dès 90 px de geste, l'éventail s'ouvre, ce qui touche 83 % des tirs du naïf. Le bot qui vise exprès en rafale serrée pour les combos fait **32 %** de combo ≥ 5, contre **42 %** au naïf éventail ouvert. Donc « ouvrir » est toujours le bon choix, et la seconde décision n'en est pas une. | `src/ui/input.ts` (`SPREAD_DEAD_PX` = 90), `src/config/blocks.json` (`maxSpreadDeg`) |

Observation sur le harnais (pas un bug du jeu) : les événements émis par une action hors `step()`, comme `run:revived` après `sim.revive()`, n'arrivent sur le bus et dans `eventCounts` qu'au pas suivant. Les tests les attendent donc par `expect.poll`.

Toujours vrai depuis [`final.md`](final.md) : progression méta non monotone (J5-03). Profondeur de la run 1 à la run 5 (bot greedy) : 25 → 140 → 67 → 67 → 61, dans [`lot1-progression.json`](lot1-progression.json).

## 5. Observations de fun

**Ce qui est satisfaisant**
- L'éventail rend les volées spectaculaires (capture 01) : le débutant combote deux fois plus, et la run 1 tient enfin 4 minutes.
- Le bandeau de contrat est lisible (« Casse 3 blocs en un tir 0/3 · +12 », capture 02). Le contrat de casse (83 %) et ceux de combo (67 %) apprennent quoi chercher.
- La revanche est un vrai « encore une » : 100 % de prise, +30 % de profondeur. Le message « Première descente : c'est offert » est clair (capture 04).
- La carte de partage est propre (capture 05). Le défi est parfaitement reproductible : même graine et même jeu donnent la même profondeur.

**Ce qui est plat**
- La balle dorée disparaît dans une volée de 20 balles ou plus (3 % des dégâts).
- La seconde décision par tir est subie, pas choisie (F1-01).
- La run 1 du bot « contrats » dure **8,4 min** en moyenne, et jusqu'à **17,9 min** (qa-2) : avec revanche et contrats, un bon joueur fait une run 1 très longue.

**Trois propositions chiffrées pour le lot 2**

1. **Contrats atteignables** : dans `contracts.json`, `coins20.target` passe de 20 à **12**, et `fast6.target` de 6 à **8**. But : passer de 19 % et 17 % à environ 50 % de réussite, comme `noDamage`. Les textes suivent `{n}`.
2. **Balle dorée qui compte** : dans `balls.json`, `lastBallMultiplier` passe de 2 à **4**. But : remonter la part de dégâts de la balle dorée de 8 % à 15 % ou plus pour le bot contrats, et viser au moins 25 % des tirs où elle casse un bloc. Au-delà, une demande `core/` (voir le rapport) : un multiplicateur qui croît avec la taille de la volée.
3. **Rendre la rafale serrée intéressante** : dans `blocks.json`, `board.maxSpreadDeg` passe de 14 à **10**. Côté UI, `SPREAD_DEAD_PX` passe de 90 à 150 px (constante de `ui/input.ts`, pas de JSON). But : moins de 50 % d'ouvertures involontaires, et que la rafale serrée au mur égale ou dépasse l'éventail pour le combo ≥ 5 (aujourd'hui 32 % contre 42 %). À remesurer avec `fun.spec.ts`.

## 6. Captures (`docs/qa/fun-shots/`)

| Fichier | Contenu |
|---|---|
| `01-eventail-ouvert.png` | geste de 400 px, ouverture 1, éventail de visée et curseur rafale ↔ éventail |
| `02-bandeau-contrat.png` | bandeau « Casse 3 blocs en un tir 0/3 · +12 », seed `fun-c<i>`, HUD « Record V7 » |
| `03-balle-doree.png` | balle dorée en vol, en fin de rafale (sim à ×0,25) |
| `04-ecran-revanche.png` | « Revanche ? », gratuit en run 1, compte à rebours, bandeau de contrat visible au-dessus |
| `05-carte-partage.png` | **le PNG téléchargé** par « Partager » (1080×1350, 336 ko) |
| `06-fin-de-run-partage.png` | fin de run après le partage (« Lien copié · image téléchargée ») |
| `07-defi-badge.png` | page ouverte depuis le lien : badge « Défi : battre P33 » |
| `08-defi-resultat.png` | fin du défi : « ✗ Défi raté : P33 / P33 » (F6-02) et « Rejouer le défi » |
| `suite/` | captures de la suite (smoke, mobile, hors ligne, feel, Puits) sur ce build |

## 7. Harnais (ce passage)

- **`bots.ts`** :
  - nouveau bot `contracts` ;
  - politique de mort `onLost` : `giveUp` par défaut, `none` pour que le test pilote l'écran, ou `reviveIfAffordable`, qui clique sur `[data-action="revive"]` dans le DOM ;
  - mode `spreadMode: 'drag'` pour l'éventail ;
  - recueil de `run:lost`, `run:revived`, `run:over`, `contract:*`, de la balle dorée (`ball:launched.golden` et `block:hit.ballId`) et de `reward:offered.source` ;
  - le contrat de la vague 1, tiré avant l'installation du bot, est compté.
- **Sorties** : `docs/qa/lot1-*.json` et `docs/qa/fun-shots/suite/`. Les fichiers `final-*` et `final-shots/` restent la référence « avant ».
- **`smoke.spec.ts`** : la mort passe par « Revanche ? » et « Abandonner » via le DOM. Le test vérifie qu'aucune `run:over` n'arrive avant la décision, puis qu'il y en a exactement une.
- **Nouveaux fichiers** : `fun.spec.ts`, `revive.spec.ts`, `share.spec.ts`. `share.spec.ts` contient le `test.fail` de F6-01.
