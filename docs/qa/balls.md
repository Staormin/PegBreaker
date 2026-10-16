# QA : les 20 nouvelles balles (2026-10-17, build 0.4.0-j4, commit 5833446)

## 1. Résumé
**Verdict : à corriger (1 majeur), les 20 mécaniques fonctionnent.** Les 20 balles produisent toutes leur signal attendu, sans erreur console ni NaN, avec ≤ 186 particules et ≤ 14 balles vivantes. Suite e2e : **62/62 verts en 6 min 51 s**.
1. **Majeur, B-01** : la vague 20 (`lateWave`) ne se termine plus. Sur la run qa-2, elle dure 161 tirs et la run atteint 30,5 min simulées et P367, contre P225 et 19 min avant l'anti-infini.
2. Équilibrage en début de partie (18 tirs × 3 graines communes) : la traqueuse fait 3,18 × les dégâts de la pierre. L'acide, la bombe, l'aimant et le vampire font exactement 1,00 × : leur effet ne se déclenche pas utilement en vagues 1-2. Le boomerang ne revient que 4 fois sur 30.
3. Perf (CPU 4×, DPR 1,5, 30 balles) : moyenne 59 fps, mais une frame de 100 ms vers 0,96 s (bascule de qualité) donne un **min de 49-50 fps** (2 passages isolés sur 3 sous la cible). Même défaut avec les 7 balles d'origine.

## 2. Harnais (règle d'équité)
- `challenge.spec.ts` : la référence passe en `?seed=qa-1&goal=0&qa=1` (pool standard, non créditée). L'échec 51 ≠ 56 venait de là, plus de régression.
- `share.spec.ts` : même cause (page 1 en pool personnel, lien de défi en pool standard). La comparaison de profondeur est retirée (le déterminisme est couvert par challenge) et les deux profondeurs sont annotées.
- `daily.spec.ts` : vert en 4 passages sur 4. La cause probable de l'échec intermittent : la longueur de la run dépend de la date (mutateurs du jour) et du pool standard. Le 17/10 (`pegfest` + `inferno`), la run 1 atteint vague 14 et P135, ce qui frôle le garde-fou de 120 s sous charge. Correctif : vitesse 16, garde-fou 170 s, durée annotée.
- Nouveaux fichiers : `balls.spec.ts` (20 balles, référence d'origine, 2 tests perf), `well.spec.ts`, `late.spec.ts` (diagnostic B-01, `QA_LATE=1`), test « pools » dans `fun.spec.ts`.

## 3. Balles : signal observé
Protocole : `?seed=balls-<id>&qa=1`, volée forcée avant chaque tir à 5 balles (rangs I, I, I, II, III), ouverture 0, vitesse 8, 6 tirs. Le pilote enveloppe `sim.step` et lit événements et état à chaque pas de 1/60 s. Les dégâts « réf. » sont la somme de 3 runs de 6 tirs sur `balls-ref-1..3`, rapportée à la pierre (2 813 PV). Données : `docs/qa/balls-data/<id>.json`. Captures : `docs/qa/balls-shots/<id>.png`.

| Balle | Signal mesuré | Réf. ×pierre | Remarque visuelle / mécanique |
|---|---|---|---|
| acid | 12 blocs chargés (max 3 charges) ; tous meurent dans le même tir, **0 morsure** au tir suivant. Avec des blocs forcés à 200 PV : 35,3 PV par bloc et par tir (conforme). | 1,00 | Gouttes vertes à l'impact, aucune teinte persistante (B-03). |
| magnet | 5 ramassages sur 6 en vol sans contact, jusqu'à 0,67 u du bord | 1,00 | Magenta, proche de la traqueuse et de la nova. |
| pierce | 61 impacts pour 28 rebonds sur bloc | 1,35 | Flèche blanche, très lisible. |
| bomb | `block:explode` `bomb` : 30 par run, mais **0 bloc touché** en vagues 1-2 (explosion au sol, blocs en rangées 0-4) | 1,00 | Rouge, lisible. |
| homing | 75 rebonds déviés sur 81 (> 2°) ; contrôle des autres balles : 0 à 3 % | **3,18** | Déviation max au rang III : 38° pour un plafond de 30° (1 échantillon, à confirmer, voir §5). |
| giant | rayon 0,216-0,288, vitesse × 0,85 | 2,17 | Très lisible. |
| swarm | 7 `ball:split` `swarm`, 7 mini-balles | 1,76 | Vert citron, confondable avec la chance. |
| vampire | 11 soins `vampire` (PV forcés à max − 3) | 1,00 | Pourpre, lisible. |
| gold | 12 pièces + 1 balle garantie pour 13 blocs détruits ; 217 pièces sur la réf. contre 27 pour la pierre | 1,07 | Jaune « $ » : confondable avec la balle dorée et les pièces (B-02 pour la balle garantie). |
| prism | 5 `lightning:chain` `prism` | 1,14 | Triangles cyan, rayon bref. |
| void | 10 impacts sur 10 = base × combo + 6/9/12 % × maxHp | 0,94 | Violet, lisible. |
| echo | 30 `Ball.kind` `echo` | 1,58 | Anneaux et onde au sol : le meilleur retour visuel. |
| boomerang | 6 rebonds au sol de normale (0,−1) (rangs II/III) ; seulement **4 sur 30** posées au lanceur, **25 sur 30 au sol avant 1,5 s** | 0,98 | À 1,7 s, il ne reste en vol que la dorée : le retour se voit rarement. |
| crystal | 3 `ball:split` `crystal`, 12 éclats `mini` | 1,65 | Éclats blancs fins. |
| shock | 4 blocs remontés (`row` −1) | 1,42 | Engrenage jaune, encore un jaune. |
| twin | 30 `ball:split` `twin`, 48 jumelles | 1,28 | Paires vertes pâles, lisibles. |
| rust | 12 blocs dont `maxHp` baisse | 0,95 | Brun, lisible. |
| nova | 2 `block:explode` `nova` en 6 tirs | 1,01 | Étoile rose, explosion de 9 PV au palier 3 : imperceptible. |
| comet | vitesse au lancement × 1,40, 5 rebonds au plafond, combo max 10 | 1,99 | Traînée de flamme lisible. |
| lucky | 3 critiques hors combo sur 21 impacts | 2,10 | Trèfle vert citron, voir essaim. |

Origine sur les mêmes graines : feu 1,29, plomb 1,26, foudre 1,26, scission 1,07, glace 1,00, fantôme 0,78.

**Perf** (`balls-data/perf*.json`, test isolé, `--workers=1`) : 30 balles des nouvelles familles, CPU 4×, 720×1280, DPR 1,5. Min 49/49/50 fps, moyenne 59, p95 16,8 ms, frame max 100 ms, ≤ 56 particules, 27 balles vivantes. Contrôle avec les 7 d'origine : min 54/55/46, moyenne 58. Bundle : 269,5 ko, 91,7 ko gzip.

## 4. Puits (`well.spec.ts`)
26 nœuds de balles : 23 `data-unlock="fragments"` et 3 `data-unlock="achievement"` (nova « Succès : … », comète, chance), sans bouton d'achat. Filtres : élémentaire 5, lourde 4, ruse 5, essaim 3, cupide 4, arcane 5. Le second appui retire le filtre (26 visibles). Achat de l'Aimant via le DOM : −40 ◆, `unlockedElements` mis à jour. Run suivante `?seed=well-magnet&qa=1` : l'aimant est proposé à la 3e offre et lâché 3 fois en drop, aucune balle verrouillée n'est proposée. Pastille HUD `data-family="greed"`, `.end-volley > .ev-chip` conforme.

## 5. Métriques fun : pool personnel contre pool standard (`balls-fun.json`, 5 graines par groupe)
| | Avant (fun-final, naïf / bon usage) | Perso, profil vierge | Standard (défi) |
|---|---|---|---|
| Vague de mort | 8,2 / 12 | 8,2 / 11,8* | **10 / 9,8** |
| Tirs à combo ≥ 5 | 27 % / 58 % | 27 % / 59 % | **58 % / 60 %** |
| Contrats réussis par run (taux) | 3,2 (42 %) / 6,6 (62 %) | 3,2 (42 %) / 6,4 (62 %) | 5,4 (60 %) / 4,4 (49 %) |
| Durée joueur (min) | 4,6 / 9,2 | 4,6 / 11,3* | 8,0 / 7,9 |
| Fusions par run | — | 1,8 / 20,4 | 5,8 / 7 |
| Meilleur tir | 4 496 / 39 865 | 4 496 / 55 823 | 7 471 / 5 514 |
| Moments morts / erreurs | 0 / 0 | 0 / 0 | 0 / 0 |

\* qa-2 (bon usage, perso) n'est pas finie : arrêt du bot à 170 s, vague 20, P303 (B-01).

Le pool standard double le combo du naïf et allonge sa run (4,6 → 8 min). Pour le « bon usage », il réduit les fusions (20,4 → 7) et le meilleur tir (÷ 10) : la dilution sur 27 balles rend les paires rares. Hors qa-2, l'écart de vague est de 9,75 contre 8,25.

## 6. Bugs
| ID | Gravité | Seed / étapes | Attendu / observé | Fichier suspect |
|---|---|---|---|---|
| B-01 | **majeur** | `QA_LATE=1 npx playwright test late --workers=1` : `?seed=qa-2&qa=1`, profil vierge, bot naïf `rowSelector`, revanche gratuite | Attendu : l'anti-infini raccourcit la fin de partie. Observé : vague 20 (boss) de 161 tirs, `rowsLeftInWave` à 0, une rangée ajoutée tous les 4 tirs, PV cumulés des blocs de 175 k à 2,8 M ; la vague ne peut plus être nettoyée, mort par usure à P367 et 30,5 min (avant : vague 21, P225, 19 min). Log : `balls-data/late-qa-2.json`. | `src/sim/waves.ts:236` (`lateExtraRow`) et `advanceRows`, combinés avec `growthPerShot` sur `shotInWave` |
| B-02 | mineur | `balls-gold` : 6 tirs d'or | BALLS.md : « lâchent toujours des pièces ». Observé : 1 bloc sur 13 lâche la balle garantie à la place (`guaranteedBallEvery` est prioritaire). | `src/sim/drops.ts:21` |
| B-03 | mineur | toute run avec l'acide | Aucune teinte persistante sur un bloc chargé. Le commentaire du renderer dit que les charges « ne sont pas dans l'état public », alors que `Block.acidCharges` existe désormais. | `src/render/index.ts:237` |
| B-04 | mineur | `npx playwright test balls -g perf --workers=1` | fps min ≥ 50 attendu. Observé : 49-50, à cause d'une frame unique de 100 ms vers 960 ms après le tir (16 balles en vol, DPR 1,5 → 1,25). Même défaut avec les balles d'origine. | `src/render/index.ts:132` (`lowerQuality`, régénération des sprites) |
| B-05 | mineur (doc) | — | BALLS.md n'est plus à jour avec balls.json et meta.json : prisme 30 % (json 0,4), or ×0,7 (0,85), cristal +20 % et éclats ×0,25 (30 % et 0,4), coûts du Puits (acide 60 → 45, aimant 50 → 40, perforante 80 → 60…). | `docs/BALLS.md` |

## 7. Trois propositions d'équilibrage (`src/config/balls.json`)
1. **`boomerang.params.afterMs` : [1500, 1500, 1500] → [900, 900, 900]**. Aujourd'hui, 25 boomerangs sur 30 touchent le sol avant 1,5 s, donc la mécanique se déclenche une fois sur six (0,98 × la pierre).
2. **`homing.params.maxDeg` : [12, 20, 30] → [8, 14, 20]**. Elle fait 3,18 × la pierre, la meilleure des 27 (la géante suit à 2,17), pour un coût de 190 ◆.
3. **`nova.params.comboMult` : [3, 4, 6] → [8, 10, 14]**. Une nova au palier 3 inflige 9 PV contre des blocs de 20-30 PV : 1,01 × la pierre. Avec 8, elle infligerait 24 PV, soit environ un bloc détruit par palier.

À suivre sans valeur proposée : l'acide (charges perdues sur des blocs déjà morts) et la bombe (explosion au sol hors de portée) n'apportent rien avant la vague 3. Mesurer à nouveau sur des vagues plus profondes avant d'y toucher.

## 8. Captures
`docs/qa/balls-shots/` : une capture par balle en vol (`<id>.png`, 2e tir ou plus), `well-arsenal.png`, `well-filtre-greed.png`, `well-fin-de-run-volee.png`, `zz-perf-fin.png`, `zz-perf-control-fin.png`.
