# QA final des lots fun (lot 1, lot 1 bis, lot 2)

Build mesuré : commit `3d1593f` (« Lot 1 bis »), arbre `src/` propre, version affichée `0.4.0-j4`. Bundle : 195,8 ko brut, **68,1 ko gzip** (budget 120 ko).

Pour rejouer : `fuser -k 4173/tcp; npm run build && npm run test:e2e`. Dernier passage : **37 tests sur 37 verts en 3 min 44** (budget 10 min). La suite ne contient plus aucun `test.fail` : F6-01 est corrigé et couvert par `challenge.spec.ts`.

Références et données :

| Fichier | Contenu |
|---|---|
| [`final.md`](final.md), [`final-metrics.json`](final-metrics.json) | « avant » : build `7a33cab`, avant les lots fun |
| [`fun-lot1.md`](fun-lot1.md), [`lot1-fun.json`](lot1-fun.json) | « lot 1 » : rapport précédent |
| [`fun-final.json`](fun-final.json) | ce passage : 4 groupes de bots × 5 seeds |
| [`fun-final-metrics.json`](fun-final-metrics.json) | ce passage, `metrics.spec` : naïf et greedy sans éventail, et perf |
| `fun-final-*.json` | autres sorties de la suite |

## 1. Résumé

**Verdict : OK pour les mécanismes (F2 à F9 fonctionnent et sont testés de bout en bout), à revoir pour l'éventail (F1).**

- **Problème 1, F1-02 (majeur, fun)** : l'éventail s'ouvre encore sans que le joueur le veuille, dans **61 %** des tirs d'un débutant (cible < 20 %). Ce chiffre dépend du modèle de geste : avec un geste qui va du lanceur jusqu'à la cible, on monte à **93 %**. Depuis la pénalité de dégâts, ces ouvertures coûtent cher. Rafale serrée systématique : vague de mort **9,8** en moyenne. Éventail systématique : **5,2**. La décision s'est inversée au lieu de devenir un vrai choix.
- **Problème 2, F5-03 (majeur, équilibrage)** : les runs sont bimodales. Le même bot naïf meurt en vague 4-5 en environ 2 min (3 seeds sur 5), ou fait boule de neige jusqu'en vague 15-19 en 12 à 18 min (qa-1, qa-2). La médiane de la run 1 vaut **2,3 min** (cible ≥ 4 min), alors que la moyenne affiche 7,4 min.
- **Problème 3, F9-01 (mineur)** : le coffre de boss de qa-2 propose 3 reliques **rares**. FUN.md promet « épique garantie ». La perf HiDPI régresse aussi un peu : DPR 2, CPU 4×, min 42 fps contre 53.

## 2. Tableau : avant, lot 1, final

### Les bots

Tous jouent en profil vierge, `?seed=qa-N&qa=1` (run non créditée), à vitesse 8.

| Nom | Comportement |
|---|---|
| **naïf** | geste de débutant de 40 à 320 px CSS, converti comme `ui/input.ts` (zone morte 150, plage 220) ; ne veut jamais ouvrir l'éventail |
| **serré** | spread toujours à 0 |
| **éventail** | spread toujours à 1 |
| **conditionnel** | bot « contrats » : 0 au mur pour les contrats de combo et de casse, 1 sur une rangée d'au moins 4 blocs pour « nettoie en N tirs », sinon le geste du naïf ; prend la seconde chance |

Les cellules donnent la moyenne, puis la médiane entre parenthèses quand la distribution est bimodale.

| Métrique | Cible | Avant (`final.md`) | Lot 1 naïf | Lot 1 conditionnel | **Final naïf** | Final serré | Final éventail | Final conditionnel |
|---|---|---|---|---|---|---|---|---|
| Décisions par tir (direction, + 1 si ouverture ≠ 0) | ≥ 2 | 1,0 | 1,83 | 1,61 | 1,61 | 1,00 | 1,99 | 1,46 |
| **Ouvertures involontaires du naïf** (modèle A, geste de 40 à 320 px) | < 20 % | — | 83 % | — | **61 %** ❌ | — | — | — |
| Idem, modèle B (geste du lanceur à la cible, 406 px en moyenne) | < 20 % | — | — | — | **93 %** ❌ | — | — | — |
| Décisions/min (temps joueur) | ≥ 8 | 18,5 | 27,4 | 22,7 | 24,8 | 17,9 | 29,6 | 24,8 |
| Tirs à combo ≥ 5 | ≥ 30 % | 10 % | 39 % | 44 % | **42 %** (40 %) | 27 % (22 %) | 40 % | 30 % |
| Combo ≥ 5 pendant un contrat de combo ou de casse | — | — | 42 % | 32 % | 59 % | 18 % | 51 % | 35 % |
| Contrats offerts par run | — | — | 6,2 | 10,0 | 9,0 | 9,4 | 4,8 | 6,4 |
| Contrats réussis par run (taux) | — | — | 2,4 (39 %) | 5,2 (52 %) | **5,8 (64 %)** | 5,4 (57 %) | 2,4 (50 %) | 2,8 (44 %) |
| Durée de la run 1 (temps joueur) | ≥ 4 min | 2,64 min | 4,08 (3,41) | 8,44 (6,57) | **7,42 (2,34)** | 6,40 (5,04) | 3,04 (3,23) | 3,80 (3,84) |
| Vague de la première mort | — | 5,2 | 6,6 (6) | 9,2 | 9,4 (5) | 9,8 (9) | 5,2 (5) | 5,2 |
| Vague finale | — | 5,2 | 6,6 | 11,0 (9) | 9,4 | 9,8 | 5,2 | 7,0 (7) |
| Runs reprises par seconde chance | — | — | — | 5/5 | — | — | — | **5/5** |
| Gain de la revanche | — | — | — | +1,8 vague, +23,8 de profondeur | — | — | — | **+1,8 vague, +19,2** |
| Première récompense (qa-1, vitesse 1, 1,5 s de visée) | < 10 s | 2,2 s | 2,19 s | — | **2,20 s** | — | — | — |
| Premier écran de choix (temps joueur) | ~25 s | 23,8 s | 20,2 s | 14,4 s | 17,4 s | 19,6 s | 17,0 s | 14,1 s |
| Balle dorée : part des dégâts | — | — | 16 % | 8 % | **23 %** | 20 % | 24 % | **25 %** |
| Tirs où la balle dorée casse un bloc | — | — | 21 % | 14 % | 28 % | 25 % | 28 % | 24 % |
| Moments morts (> 5 s sans feedback) | 0 | 0 | 0 | 0 | **0** (trou max 1,55 s) | 0 | 0 | 0 |
| Erreurs console et page | 0 | 0 | 0 | 0 | **0** | 0 | 0 | 0 |
| `run:over` par run terminée | 1 | — | 1 | 1 | 1 | 1 | 1 | 1 |

Lecture :

- **Le serré l'emporte maintenant sur l'éventail.** Vague 9,8 contre 5,2, profondeur 94 contre 41, dégâts max par tir 23 811 contre 1 484. L'ouverture « au jugé » du conditionnel ne fait pas mieux que le serré.
- **L'éventail donne toujours plus de combos ≥ 5** (40 % contre 27 %), mais il tue moins. Le combo n'est donc plus un bon indicateur de progression.
- **Les données sont bruitées** : 5 seeds, et des runs bimodales. Les médianes du serré (vague 9, 5 min) contre celles du naïf (vague 5, 2,3 min) disent la même chose : l'ouverture involontaire pénalise le débutant.
- **`metrics.spec`**, bot naïf sans éventail : vague de mort 9,8, 6,4 min. Le bot greedy fait moins bien (vague 4,8, 2,1 min) : son heuristique, fondée sur `preview`, n'est plus adaptée. C'est une limite du harnais, pas un bug.

### Contrats, par type (les 20 runs finales)

Taux du lot 1 entre parenthèses.

| Contrat (cible) | Offerts | Réussis | Taux |
|---|---|---|---|
| `noDamage` (clean) | 14 | 12 | **86 %** |
| `destroyInOneShot` (smash3 / smash5 → 4) | 29 | 21 | 72 % (83 %) |
| `collectBalls` (balls2) | 11 | 7 | 64 % |
| `reachCombo` (combo8 / combo16 → 10) | 19 | 12 | 63 % (67 %) |
| `killWithElement` (fire3 / bolt3) | 13 | 6 | 46 % |
| `collectCoins` (coins20 → 10) | 34 | 14 | **41 %** (19 %) |
| `clearUnderShots` (fast6 → 8) | 22 | 9 | **41 %** (17 %) |
| `goldenKill` (gold2) | 6 | 1 | **17 %**, le plus dur à présent |
| **Total** | 148 | 82 | **55 %** |

## 3. Verdict par mécanisme

| # | Mécanisme | Verdict | Chiffre |
|---|---|---|---|
| F1 | Tir en éventail | **à revoir** | 61 % d'ouvertures involontaires (cible < 20 %), 93 % avec le modèle B. Serré : vague 9,8. Éventail : vague 5,2. La pénalité de 0,15 a inversé la stratégie dominante, sans créer de dilemme. |
| F2 | Contrats de vague | **multiplie le fun** | 55 % de réussite (39 % au lot 1). Les deux contrats impossibles passent à 41 %. Le naïf en réussit 5,8 par run. Reste `gold2` à 17 %. |
| F3 | Balle dorée progressive | **multiplie le fun** | 23 à 25 % des dégâts (8 à 16 % au lot 1). Elle casse un bloc dans 24 à 28 % des tirs. Elle se dilue encore dans les volées de plus de 25 balles : 5 à 7 % sur qa-1 et qa-2 du naïf, où la volée plafonne à ×5. |
| F4 | Seconde chance | **multiplie le fun** | Prise dans 5 runs sur 5 (gratuite en run 1), pour +1,8 vague. `ui:screen` vaut `'revive'` deux fois puis `'gameover'` une fois. Une seule `run:over`, et `stats.runs` = 1. Cas payant : **35 ◆** débités (coût actuel de `economy.json`) et persistés. |
| F5 | Presque-record | **neutre** (pas mesurable par bot) | « Record V7 » dans le HUD, « Nouveau record : vague 9 » à la fin du défi, désormais crédité. |
| F6 | Carte et défi par lien | **multiplie le fun** | Carte PNG 1080×1350 de 372 ko, lien copié. Le défi rejoue la même profondeur (P82 contre P82), affiché « = Égalité : P82 » avec `data-result="tie"`. Victoire et défaite vérifiées. Run créditée : `stats.runs` 1 à 3, +214 ◆. |
| F7 | Combo visible sur la balle | **neutre** (pas vérifié à l'image) | Combo ≥ 8 sur 24 % des tirs du naïf. |
| F8 | Quotidien muté et série | **multiplie le fun** | Le badge affiche les 2 mutateurs, identiques à `meta.dailyMods()` (`rich`, `inferno` le 2026-10-16). Même seed sur deux chargements. `daily[today]` contient `mods` et `streak` 1. Après 3 jours simulés : série **4**, ◆ = round(37 × 1,3) = 48 (vérifié au fragment près). Calendrier : 4 jours joués, et « ×1,82 » affiché (mutateurs ×1,4, série ×1,3). |
| F9 | Coffre de boss | **multiplie le fun** (réserve F9-01) | qa-2 avec le bot greedy : boss tué en vague 5, profondeur 28. 3 cartes face cachée, 2 révélations, la 3e est verrouillée (`data-locked`, bouton désactivé, clic forcé sans effet). « Prendre » émet 1 `reward:chosen` avec l'option de la carte, puis `rewardSource` est effacé. Les 3 reliques sont rares, aucune épique. |

## 4. Bugs et points restants

| ID | Gravité | Seed / test | Étapes | Attendu | Observé | Fichier suspect |
|---|---|---|---|---|---|---|
| **F1-02** | **majeur (fun)** | qa-1 à qa-5, `fun.spec.ts` | Le joueur vise en glissant ; un geste de plus de 150 px ouvre l'éventail. | < 20 % d'ouvertures involontaires ; serré et éventail à peu près à égalité, chacun utile selon la situation | 61 % (modèle A) et 93 % (modèle B : la cible est en moyenne à **406 px** du lanceur, alors que la zone morte fait 150 px). Éventail systématique : vague 5,2 contre 9,8 pour le serré. | `src/ui/input.ts` (`SPREAD_DEAD_PX`, couplage longueur → ouverture), `src/config/balls.json` (`spreadDamagePenalty` 0,15) |
| **F5-03** | **majeur (équilibrage)** | naïf qa-1 et qa-2 contre qa-3 à qa-5 | Runs naïves. | Run 1 de 4 à 6 min pour la plupart des joueurs | Bimodal : 2,1 à 2,3 min (mort en vague 4-5), ou 12,7 à 17,8 min (vague 15-19). Médiane 2,3 min. `hpByWave` reste non monotone : vague 4 = **500**, vague 5 = 330 (mur de la vague 4). | `src/config/waves.json` (`hpByWave`) |
| F9-01 | mineur | qa-2, `chest.spec.ts` | Tuer le premier boss avec un profil vierge. | « Épique garantie » (FUN.md, F9) | `paratonnerre`, `firstblood`, `pyromane` : 3 rares. `makeBossOptions` documente « rares/épiques si possible ». | `src/sim/rewards.ts` (`makeBossOptions`), ou FUN.md à aligner |
| F2-02 | mineur (équilibrage) | 20 runs | — | Réussite d'environ 50 % | `gold2` (`goldenKill` 2) : 1 sur 6 (17 %) | `src/config/contracts.json` |
| F4-03 | info (design) | `rev-1`, `rev-paid` | Mourir en vague 4 avec des blocs uniquement dans les 3 rangées du bas, puis prendre la revanche. | — | La revanche vide le plateau, la vague est nettoyée aussitôt, et l'on passe directement à la récompense. C'est généreux mais cohérent avec `sim/machine.ts` (`revive` → `clearWave`). Les tests acceptent les deux cas. | — |
| J5-01b | mineur (perf) | `metrics.spec.ts` perf, lancé seul (`--workers=1`) | Volée de 30 balles, 7 éléments, CPU 4×, 720×1280. | ≥ 55 fps | DPR 2 : min **42**, moyenne 55, frame max 41 ms (53 / 58,3 au passage précédent). DPR 1,5 : min 50. Mobile 375×812 : 60 / 60. Pendant la suite complète en parallèle, les chiffres ne sont pas significatifs (CPU partagé). | `src/render/` |
| J5-03 | mineur | `prog`, `progression.spec.ts` | 5 runs avec méta. | Profondeur croissante | 23 → 38 → 38 → **153** → 96 | `src/config/meta.json` |

Corrigés depuis `fun-lot1.md`, vérifiés par un test vert :

- **F6-01** : une run de défi est créditée (`challenge.spec.ts`, `share.spec.ts`). Le `test.fail` a été retiré.
- **F6-02** : égalité affichée « = Égalité : P82 », avec `data-result="tie"`.
- **F4-01** : `ui:screen` vaut `'revive'` (`revive.spec.ts`).
- **F2-01** : `coins20` et `fast6` passent de 19 % et 17 % à 41 %.
- **F3-01** : la part de la balle dorée passe de 8 % à 25 % pour le conditionnel.

## 5. Cinq pistes pour la suite

1. **Découpler l'ouverture du geste (F1-02).** L'ouverture se règle au curseur « rafale ↔ éventail » déjà affiché sous le plateau, ou par un appui long. Elle ne dépend plus de la longueur du drag. À défaut, `SPREAD_DEAD_PX` passe de 150 à **280** (modèle A : 14 % d'involontaires). Le modèle B reste au-dessus de 80 %, d'où la préférence pour le découplage. But : moins de 20 % d'ouvertures involontaires.
2. **Rendre l'éventail compétitif.** Dans `balls.json`, `spreadDamagePenalty` passe de 0,15 à **0,06**. But : écart de vague de mort entre serré et éventail systématique ≤ 1, contre 4,6 aujourd'hui. Avec `fun.spec.ts`, le conditionnel devrait battre les deux.
3. **Casser la bimodalité.** Dans `waves.json`, `hpByWave` vague 4 passe de 500 à **380** (supprime le mur, puisque la vague 5 est à 330). La vague 12 passe de 1 500 à **2 000**, et la vague 15 de 4 000 à **5 500** (freine la boule de neige). But : médiane de la run 1 entre 4 et 6 min, et aucune run naïve au-delà de 10 min.
4. **Coffre fidèle à la promesse (F9-01).** Une carte du coffre de boss est toujours épique quand une épique est débloquée ; sinon, afficher « rare » sans promettre plus. Dans `contracts.json`, `gold2.target` passe de 2 à **1** (17 % → environ 50 %).
5. **Perf HiDPI (J5-01b).** Plafonner le DPR à 1,25 dès 20 balles en phase `aiming`, comme pour la bascule préventive. But : min ≥ 55 fps en DPR 2, CPU 4×, mesuré avec `--workers=1`.

## 6. Captures (`docs/qa/fun-final-shots/`)

| Fichier | Contenu |
|---|---|
| `01-eventail-ouvert.png` | geste de 400 px, ouverture 1 |
| `02-bandeau-contrat.png` | bandeau de contrat actif, « Record V7 » |
| `03-balle-doree.png` | balle dorée en vol |
| `04-ecran-revanche.png` | « Revanche ? », gratuite |
| `05-carte-partage.png` | PNG téléchargé par « Partager » (P82, 372 ko) |
| `06` à `08` | fin de run et partage, badge du défi, défi à égalité |
| `09-coffre-ferme.png`, **`10-coffre-revele.png`** | coffre de boss : 3 cartes cachées, puis 2 révélées avec la 3e verrouillée |
| **`11-quotidien-mutateurs.png`** | `?daily=1` : badge QUOTIDIEN avec 2 mutateurs, 3 PV (`rich`) |
| `12-quotidien-fin-serie.png` | fin de run quotidienne, « Série : 4 jours » |
| **`13-quotidien-serie-calendrier.png`** | écran du défi du jour : mutateurs (×1,4), série 4 (×1,3), total ×1,82, calendrier |
| **`14-defi-egalite.png`** | « = Égalité : P82 », run créditée (+89 ◆) |
| `suite/` | captures du reste de la suite sur ce build |

## 7. Harnais (ce passage)

- **URL QA** : toutes les runs à seed forcée passent par `?seed=…&qa=1` (`openGame`, `metrics`, `feel`, `fun`) et ne sont pas créditées. Les runs créditées utilisent `?fresh=1` + `restart`, `?daily=1` ou `?seed=&goal=`.
- **`bots.ts`** :
  - `spreadMode: 'max'` ;
  - zone morte et plage importées de `ui/input.ts` ;
  - distance lanceur → cible par tir (modèle B) ;
  - `stopOnBossReward`.
- **Nouveaux fichiers** : `daily.spec.ts`, `chest.spec.ts`, `challenge.spec.ts`.
- **`revive.spec.ts`** : vérifie `ui:screen 'revive'`. La revanche peut nettoyer la vague (voir F4-03).
- **`share.spec.ts`** : vérifie l'égalité et le crédit de la run de défi ; le `test.fail` est retiré.
- **`fun.spec.ts`** : 4 groupes × 5 seeds, par lots de 10 pages. Sortie dans `docs/qa/fun-final.json`.
- Les sorties précédentes (`final-*`, `lot1-*`, `fun-shots/`) restent intactes comme références.

## 8. Passe finale (commits `aa89b87` et `a3f2803`)

**Ce qui a changé dans le jeu :**
- l'ouverture se règle au sélecteur `button.hud-spread[data-action="spread-cycle"]`, sur 3 niveaux : 0 (rafale), 0,5, 1 (large). Le choix persiste d'un tir à l'autre et revient à 0 à `run:started` ;
- le geste ne touche plus l'ouverture ;
- pénalité de l'éventail 0,20 ;
- `gold2.target` revient à 2 ;
- épique garantie dans le coffre ;
- courbe de PV v4 420 / v5 420 / v6 540 / v8 680, régénération du boss 2,4 ;
- revanche à 30 ◆.

Bundle : 196,9 ko brut, **68,6 ko gzip**.

**Résultat :** `npm run build && npm run test:e2e` donne **37 tests sur 37 en 3 min 05**. `npx tsc --noEmit` est vert. Les sections 2 à 7 ci-dessus décrivent la passe précédente (`3d1593f`). Les chiffres de cette section remplacent ceux de [`fun-final.json`](fun-final.json).

### Méthode
- **3 stratégies × 5 seeds** (qa-1 à qa-5), en `?seed=…&qa=1`, profil vierge, vitesse 8.
- **Même visée pour tous** : bot naïf, bloc le plus bas ±10°, même aléa par seed.
- **Même seconde chance pour tous** : prise si payable, donc gratuite ici (`stats.runs` = 0).
- **Rafale** : niveau 0. **Conditionnel** : un clic DOM sur le sélecteur jusqu'à « large » si au moins 4 blocs cassables partagent une rangée, sinon « rafale ». **Large** : clic jusqu'au niveau 2 à chaque tir.

### Ouvertures involontaires : **0 %**, par construction et vérifié

Test « captures et input réel », vrais événements souris :
- des drags de 60, 200 et 400 px laissent `aimSpread` à **0**, pendant le geste et au tir ;
- le sélecteur passe à « moyen » : un drag donne **0,5** ;
- il passe à « large » : **1** ;
- le niveau reste à 2 après le tir.

Capture `fun-final-shots/01-eventail-ouvert.png` : sélecteur sur « large ».

### Tableau : avant, lot 1, final

« Lot 1 » : naïf de `fun-lot1.md`, ouverture liée au geste, abandon à la mort. Les cellules donnent la moyenne, puis la médiane entre parenthèses.

| Métrique | Cible | Avant (`final.md`) | Lot 1 (naïf) | **Final rafale** | **Final conditionnel** | **Final large** |
|---|---|---|---|---|---|---|
| Ouvertures involontaires | < 20 % | — | 83 % | **0 %** | **0 %** | **0 %** |
| Décisions par tir (direction, + 1 si ouverture ≠ 0) | ≥ 2 | 1,0 | 1,83 | 1,00 | 1,65 | 2,00 |
| Décisions/min (temps joueur) | ≥ 8 | 18,5 | 27,4 | 18,6 | 24,0 | 29,4 |
| Tirs à combo ≥ 5 | ≥ 30 % | 10 % | 39 % | 27 % (32 %) | **58 % (60 %)** | 39 % (37 %) |
| Tirs à combo ≥ 8 | — | — | 21 % | 15 % | 43 % | 24 % |
| Contrats réussis par run (taux) | — | — | 2,4 (39 %) | 3,2 (42 %) | **6,6 (62 %)** | 2,8 (48 %) |
| Durée de la run 1 (temps joueur, min) | ≥ 4 | 2,64 | 4,08 (3,41) | **4,58 (4,46)** | 9,19 (8,49) | 3,76 (4,06) |
| Vague de la première mort | — | 5,2 | 6,6 (6) | 6,8 (6) | 7,2 (6) | 4,8 (5) |
| Vague finale | — | 5,2 | 6,6 (6) | 8,2 (8) | **12,0 (12)** | 6,0 (6) |
| Profondeur | — | — | 54,6 | 72,4 (67) | **117 (109)** | 50,8 (52) |
| Seconde chance prise | — | — | 0/5 (abandon) | 5/5 | 5/5 | 5/5 |
| Gain de la revanche | — | — | — | +1,4 vague, +14,8 de profondeur | **+4,8 vagues, +57,4** | +1,2 vague, +11,6 |
| Dégâts max par tir | — | — | — | 4 496 | **39 865** | 1 771 |
| Balle dorée : part des dégâts | — | — | 16 % | 24 % | 20 % | 23 % |
| Première récompense (qa-1, 1,5 s de visée) | < 10 s | 2,2 s | 2,19 s | **2,23 s** | — | — |
| Premier écran de choix (temps joueur) | ~25 s | 23,8 s | 20,2 s | 19,9 s | 19,8 s | 18,4 s |
| Moments morts (> 5 s) | 0 | 0 | 0 | **0** (trou max 1,55 s) | 0 | 0 |
| Erreurs console et page | 0 | 0 | 0 | **0** | 0 | 0 |

Contrats par type, sur les 15 runs (réussis / offerts) :

| Contrat | Réussis / offerts | Taux | Lecture |
|---|---|---|---|
| `reachCombo` | 14/21 | 67 % | — |
| `destroyInOneShot` | 14/20 | 70 % | — |
| `collectBalls` | 6/7 | 86 % | — |
| `collectCoins` | 12/25 | 48 % | — |
| `killWithElement` | 4/9 | 44 % | — |
| `noDamage` | 7/14 | 50 % | — |
| `clearUnderShots` | 5/17 | 29 % | — |
| `goldenKill` (gold2, cible 2) | **1/7** | **14 %** | toujours le plus dur |

### Verdict F1 : **multiplie le fun**
- **Plus aucune ouverture involontaire**, contre 61 % à la passe précédente. Le choix est explicite.
- **C'est enfin un vrai dilemme.** Aucune position fixe ne domine : « large » partout fait la pire profondeur (médiane vague 6), « rafale » partout fait mieux (vague 8). Le bon usage, « large » quand une rangée est pleine, gagne nettement : médiane vague **12**, profondeur 109, combo ≥ 5 à 58 %, et 62 % des contrats réussis.
- **La maîtrise est lisible** : un joueur qui apprend quand ouvrir double sa profondeur.
- **Réserve** : le conditionnel meurt la première fois au même moment que la rafale (médiane vague 6 dans les deux cas). Son avance se fait **après la revanche** (+4,8 vagues contre +1,4), sur un plateau effacé où les rangées pleines reviennent.
- **Pour un joueur fort, la run 1 dure 8,5 min en médiane** (19 min sur qa-2). Pour le joueur « rafale », elle dure 4,5 min, dans la cible.

### Coffre (F9) : **épique présente**
`chest.spec.ts` (qa-2, bot greedy, profil où toutes les épiques sont débloquées) : boss tué en vague 5, profondeur 31. Le coffre propose `paratonnerre` (rare), **`alchimie` (épique)** et `catalyseur` (rare). Révéler, verrouiller puis prendre fonctionne, et le test prend l'épique.

**F9-02 (mineur, design)** : sur un profil **vierge**, la seule épique débloquée est `safetynet`. Le bot greedy la prend en récompense de vague avant le premier boss (qa-2 : possédée au coffre). Le coffre ne contient alors aucune épique (`pyromane`, `firstblood`, `catalyseur`, toutes rares). C'est conforme à la règle « si une épique débloquée n'est pas possédée », mais la promesse « épique garantie » ne tient pas pour un débutant. Fichier : `src/sim/rewards.ts` (`makeBossOptions`), ou `meta.json` pour débloquer une 2e épique de départ.

### Points restants
- **Mur en vague 6** : sans revanche, les 5 runs de `metrics.spec` (rafale) meurent toutes en vague 6 ou 7. `survivalByWave` donne 5 runs en vie jusqu'en vague 6, puis 1 en vague 7. Première mort médiane : vague 6 pour les trois stratégies. Fichier suspect : `waves.json`, avec v6 = 540 juste après v4 = v5 = 420.
- **`goldenKill` (gold2)** : 14 % de réussite.
- **Progression méta** (bot greedy, seed `prog`) : profondeur 23 → 79 → 65 → 66 → 66. Plus plate qu'avant, mais pas croissante.
- **Le bot greedy reste moins bon que le naïf** (vague 5,2 contre 6,8) : c'est une limite du harnais.

### Harnais (passe finale)
- **`bots.ts`** :
  - nouveaux modes `spreadMode: 'max' | 'rowSelector'`, qui cliquent le sélecteur HUD puis appellent `sim.aim(dir, 0 | 0,5 | 1)` ;
  - suppression des imports `SPREAD_DEAD_PX` et `SPREAD_RANGE_PX`. Le mode `'drag'` est gardé pour l'historique, avec 150 / 220 en dur.
- **`fun.spec.ts`** : 3 stratégies ; vérifie le 0 % d'involontaires et le sélecteur via l'input réel.
- **`chest.spec.ts`** : épiques débloquées par la sauvegarde ; vérifie qu'une carte épique est présente.
- **`onboarding.spec.ts`** : la sonde des indices distingue l'indice du sélecteur (`.hud-spread.hint-pulse`) de l'indice de fusion. Avant, elle les confondait et voyait « fusion ×2 ». Ce n'était pas un bug du jeu.
