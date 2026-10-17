# QA — Vente, forge, hybrides, Divine, catalyseur, codex (2026-10-17)

Build testé : `e35c8cf` (« une forge rapporte »), bundle 330,0 ko / **110,2 ko gzip**. Suite complète : `npm run build && npm run test:e2e` → **102 passés, 1 ignoré, 0 échec en 8 min 57 s** (le test `BUG FG-01` est un `test.fail` : il passe tant que le bug existe).

## 1. Résumé

**Verdict : à corriger.** Les mécaniques sont toutes là et fonctionnent par le DOM : vente, forge II + I, upgrade I → III, Divine, catalyseur, codex, toasts, succès `hybrid1`. Les 13 effets propres et la Divine sont observables, avec 0 NaN et 0 erreur console. En revanche, la forge ne fait pas encore gagner de vagues.

1. **Économie (majeur)** : le bot forgeron atteint la vague **10,4** contre **10,6** pour le bot sans forge sur les mêmes graines. HYBRIDS.md vise au moins +0,5. Une forge était possible dans 18 boutiques sur 29, mais **14 de ces 18 n'avaient pas assez de pièces** (catalyseur à 60 + forge à 40).
2. **FG-01 (majeur)** : avec le Marteau rang III, un bloc garde **plus de PV que ses PV max** (1 671 / 1 600). Le `rankMult` réduit aussi la perte de PV max.
3. **Rangs déséquilibrés** : la Supernova III fait **3,9×** la pierre (cible 7×), alors que le Spectre III fait **16,8×** et la Grappe III **14,1×**. L'upgrade I → III de la Supernova (180 pièces) n'apporte que +30 %.

## 2. Métriques

### Fonctionnel (`tests/e2e/forge.spec.ts`)

Protocole : défi `?seed=<seed>&goal=0` (pool standard, run créditée), bot greedy jusqu'à la récompense de la vague 3, puis volée et pièces forcées et boutique ouverte. Ensuite, tout passe par le DOM.

| Test | Seed | Résultat mesuré |
|---|---|---|
| (a) vente | forge-sell | Feu III +32, Vapeur II +90, Glace II +14 (= `economy.sell`). Dernière balle : bouton désactivé, `sim.sell` → 0. 3 `shop:sold` |
| (b) forge | forge-hybrid | Feu II + Glace I → `steam` rang I, −40 pièces. `shop:forged` (parents fire/ice). `.toast-forge` et `.toast-codex` affichés. `meta.data.codex = ['steam']` à la frame suivante. `RunSummary.forged = ['steam']`, `stats.forged = 1`. `hybrid1` absent avant la fin de run, présent après |
| (c) upgrade | forge-upgrade | Laser I → II (−60) → III (−120). Événements `shop:upgraded` (2, 60) et (3, 120). Plus de bouton au rang III ni sur une balle de base |
| (d) Divine | forge-divine | Vapeur III + Laser III → `.forge-divine` → Divine (−150), inscrite au codex. 3 tirs : 4 `block:explode` divine et 5 `lightning:chain` divine. Dégâts par tir **[249, 342, 296]** contre **[54, 54, 54]** pour la run pierre (même plateau vérifié) → **6,33×** |
| (e) catalyseur | forge-cata | Feu I + 3 pierres → 1 article catalyseur `ball ice II` à 60, ligne « Partenaire de Feu → Vapeur ». 4 articles. Achat → carte forge `steam` dans la même boutique → forgée |
| (f) codex | forge-codex | 14 entrées « ? + ? → ??? », compteur « 0 / 14 ». Forge Cristal II + Nova I → Supernova connue (« Cristal … + Nova … »), compteur « 1 / 14 », 13 entrées inconnues |

### Signaux par hybride (`balls.spec.ts`, volée forcée de 5 balles aux rangs I, I, I, II, III, `?seed=forge-<id>&qa=1`)

| Balle | Signal (effet propre) | Mesuré |
|---|---|---|
| steam | `block:explode` steam | 20 nuages, 13 gels |
| laser | `lightning:chain` laser | 12 rayons de colonne |
| cluster | `ball:split` + `block:explode` cluster | 56 grappes, 133 mini-explosions |
| wraith | impact bonifié au même combo | 1-2 impacts bonifiés sur 8-10 (8 tirs) |
| abyss | acide gagné sans impact (propagation) | 7 blocs (blocs de 1 500 PV ; à 200 PV : 0, voir observation) |
| jackpot | critique + pièce dans le même pas | 2 / 2 critiques (8 tirs) |
| quake | ≥ 2 blocs d'une rangée remontent ensemble | 6 rangées |
| missile | vitesse > 1,1× + explosion missile | ×2,00 (plafond), 7 explosions |
| supernova | explosion supernova, 0 éclatement de cristal | 5 / 0 (blocs de 400 PV : sur le plateau normal, combo max 2 → 0 palier) |
| plague | acide propagé à la mort | 9 blocs, 23 soins |
| choir | `ball:split` choir + copies écho | 30 / 108 |
| orbit | ≥ 2 rebonds au sol par balle | 2, 10 drops aspirés (≤ 0,72 u) |
| hammer | PV max qui baissent + bloc repoussé | 3 / 2 |
| divine | nova + Jugement | 18 novas, 17 éclairs |

Partout : 0 NaN, 0 violation d'invariant, 0 erreur console, au plus 30 balles vivantes, au plus 658 particules.

### Dégâts par rang, relatifs à 5 pierres I

Protocole : même pilote, 3 graines `balls-ref-*`, 6 tirs, blocs à 2 000 PV pour ne pas plafonner. Pierre = 1 170. Cibles HYBRIDS.md : I ≈ 3,5×, III ≈ 7×, Divine ≈ 15×.

| Hybride | I | II | III |
|---|---|---|---|
| steam | 5,37× | 8,37× | **13,33×** |
| laser | 3,81× | 5,36× | 7,48× |
| cluster | **7,15×** | 10,06× | **14,07×** |
| wraith | 5,81× | 10,19× | **16,80×** |
| abyss | 5,63× | 6,71× | 7,39× |
| jackpot | **2,58×** | 3,58× | 6,13× |
| quake | 4,18× | 7,65× | 8,18× |
| missile | 3,09× | 3,58× | 7,18× |
| supernova | **2,98×** | 3,38× | **3,89×** |
| plague | 4,18× | 6,19× | 7,28× |
| choir | 3,89× | 5,47× | 8,36× |
| orbit | **6,86×** | 8,59× | 9,00× |
| hammer | 4,44× | 5,89× | 8,17× |
| **moyenne** | **4,62×** | 6,54× | **9,02×** |
| Divine (5 balles) | **26,8×** | | |

### Fun : pool standard du défi (27 balles), `fun.spec.ts`

Paramètres : bots tight et conditional, graines qa-1 à qa-5, vitesse 8, seconde chance gratuite. Le forgeron forge dès que possible (Divine d'abord), sinon il achète le catalyseur s'il est payable. Budget par run : 110 s réelles.

| Métrique | Sans forge | Forgeron |
|---|---|---|
| Runs | 10 | 10 |
| Runs qui forgent | 0 | **6 / 10 (60 %)**, 13 hybrides, 0 Divine |
| Vague de première forge | | 8,0 |
| Boutiques avec catalyseur | | 29 / 29 (100 %) |
| Boutiques où une forge est possible | 43 % | 62 % (cible HYBRIDS.md : ≥ 25 %) |
| … dont forge possible mais pas assez de pièces | | **14 / 18** |
| Vague atteinte (moyenne) | 10,6 | **10,4** |
| Vague, runs **avec** hybride / **sans** | | **12,5 / 7,25** |
| Écart de vague apparié (mêmes graines, runs qui forgent) | | **−0,17** (cible ≥ +0,5) |
| Meilleur tir, avec / sans hybride | | 17 918 / 2 938 |
| Durée joueur (min) | 9,0 | 8,7 |
| Moments morts, erreurs | 0, 0 | 0, 0 |

Le 12,5 contre 7,25 est un biais de sélection : les bonnes runs atteignent plus de boutiques. Le chiffre qui compte est l'écart apparié (−0,17). tight qa-3 est coupé par le budget de 110 s à la vague 18 (sans forge : vague 16, run complète).

### Perf

Mesure isolée (`--workers=1`, machine au repos, charge ≈ 2), CPU 4×, 720 × 1280, DPR 1,5, 3 tirs à vitesse 1.

| Mélange | fps min (3 passages) | Moyenne | p95 / p99 | Frame max | Particules | Vivantes |
|---|---|---|---|---|---|---|
| **13 hybrides × 2 + 2 Divines + bombe + nova** | **52 / 52 / 52** | 57 | 16,8 / 33,4 ms | 133 ms | 126 | 29 |
| 20 nouvelles + 10 (existant) | 48 / 46 / 47 | 58 | 16,8 / 33,4 ms | 100 ms | 55 | 27 |
| 7 d'origine (contrôle) | 53 | 57 | 16,8 / 33,4 ms | 117 ms | 54 | 27 |

Le mélange forge respecte la cible (≥ 50). Le mélange « nouvelles familles » est toujours sous la cible (B-04 de balls.md, toujours ouvert) : une frame de 100-133 ms environ 1 s après le tir (bascule DPR 1,5 → 1,25). Une première mesure faite pendant que la machine était chargée (charge ≈ 6, autres agents) donnait 27 / 39 / 44 : elle n'est pas retenue.

## 3. Bugs

| ID | Gravité | Seed / étapes | Attendu / observé | Fichier suspect |
|---|---|---|---|---|
| FG-01 | majeur | `?seed=balls-ref-1&qa=1`, volée de 5 Marteaux rang III, blocs cassables mis à `maxHp = hp = 2000`, 1 tir. Test : `balls.spec.ts` « BUG FG-01 » | Attendu : PV ≤ PV max. Observé : le premier contact retire 400 PV max (45 %, plafond 400) mais n'inflige que 329 (`(base×3 + 400) × rankMult 0,666`) → **hp 1 671 / maxHp 1 600**. Possible en jeu dès que les PV max d'un bloc dépassent environ 900 (rang III seulement : `rankMult` < 1) | `src/sim/elements/hybrid.ts` : `hammerOwn.modifyDamage` ajoute `loss` à `d`, puis `composeHybrid` applique `rankMult` à l'ensemble. Ajouter `loss` après le `rankMult`, ou plafonner `hp` à `maxHp` |
| FG-02 | mineur | N'importe quelle boutique sans forge ; Puits → Codex | La règle est « un parent ≥ II + l'autre ≥ I ». Textes observés : « Forge : rien à combiner (il faut deux balles de rang III d'une recette) », « Forge deux balles de rang III en boutique pour révéler une recette », et une recette connue affichée avec deux icônes de rang III (capture 07) | `src/ui/screens/shop.ts:52` ; `src/ui/screens/well.ts` (`codex-help`, `ballIcon(…, 3, 28)`) ; commentaire `recipe` dans `core/types.ts` et en-tête de `sim/elements/hybrid.ts` |
| FG-03 | majeur (équilibrage) | `fun.spec.ts` test « forge », graines qa-1 à qa-5 | Attendu : forgeron ≥ sans forge + 0,5 vague. Observé : −0,2 (10,4 contre 10,6). 14 forges possibles sur 18 restent hors de prix. Exemple : conditional qa-4, 2 catalyseurs achetés → vague 14 contre 16 sans forge | `src/config/economy.json` (`forge.catalystCost`, `forge.hybridCost`) |
| FG-04 | mineur | Captures 04 et 07 | Juste après une forge, les toasts « Forgé » et « Codex » (2,2 s chacun, `TOAST_MS`, empilés) recouvrent le HUD (cœurs, contrat) et, si on ouvre le codex, ses onglets et son compteur. Si l'on quitte vite la boutique, le début du tir de la Divine est masqué | `src/ui/screens/toasts.ts` (placement / durée) |
| B-04 | mineur (toujours ouvert) | `npx playwright test balls -g "perf : 30 balles, nouvelles" --workers=1` | fps min 46-48, cible 50 : une frame de 100-133 ms environ 1 s après le tir | `src/render/index.ts` (`lowerQuality`) |

## 4. Fun

**Ce qui fonctionne bien**
- La boutique se lit bien : la carte forge annonce la recette, le nom, l'effet et le prix. Le catalyseur dit pour quelle recette il sert. Toasts et codex rendent la découverte tangible.
- La Divine en vol est spectaculaire (capture 04) : 6,3× une volée de pierres sur un vrai plateau de vague 4, nova et Jugement bien visibles.
- Les runs qui forgent vont plus loin (12,5 contre 7,25), et le meilleur tir est multiplié par 6. C'est le bon fantasme.

**Ce qui tombe à plat**
- Forger ne fait pas gagner de vagues (−0,2) : l'argent part dans le catalyseur et il ne reste plus 40 pièces pour la forge.
- Il y a un catalyseur dans 100 % des boutiques du pool standard : il remplace toujours un article normal et n'a plus rien d'un événement.
- La Supernova ne produit aucun palier sur les vagues 1-2 (combo max 2), et l'upgrade III ne rapporte presque rien. L'Abysse ne propage jamais son acide sur des blocs normaux, qui meurent dans le tir.
- Rang III très inégal : Spectre 16,8× et Grappe 14,1× contre Supernova 3,9× et Abysse 7,4×. La Divine (5 balles) est à 26,8×, contre une cible de 15×.

**Trois propositions chiffrées**
1. `economy.json → forge.catalystCost` : **60 → 35**. Catalyseur + forge passent de 100 à 75 pièces, dans la fourchette de 60 à 120 pièces de la vague 6, ce qui devrait débloquer une bonne partie des 14 forges possibles mais impayables.
2. `economy.json → forge.hybridCost` : **40 → 25**. La forge devient le meilleur achat de la boutique, une balle restant à 15. À re-mesurer avec le même test (cible : écart apparié ≥ +0,5).
3. `balls.json → rankMult`, pour viser 3,5× / 7× :
   - **supernova** : `[2.117, 0.962, 0.448]` → `[2.5, 1.4, 0.85]`, ce qui devrait donner environ 3,5× / 4,9× / 7,4× ;
   - **wraith** : `[1.134, 0.59, 0.274]` → `[0.7, 0.36, 0.115]`, ce qui devrait donner environ 3,6× / 6,2× / 7,1× ;
   - **cluster** III : `0.425` → `0.21`.

## 5. Captures (`docs/qa/forge-shots/`)
- `01-boutique-forge.png` : boutique avec la carte forge Feu II + Glace I → Vapeur.
- `02-forge-toast.png` : après la forge (toasts, flash de la volée).
- `03-boutique-divine.png` : carte `.forge-divine`.
- `04-divine-en-vol.png` : la Divine en vol (et FG-04).
- `05-catalyseur.png` : article catalyseur « Partenaire de Feu → Vapeur » (et FG-02).
- `06-codex-vide.png` et `07-codex-une-recette.png` : codex 0 / 14 puis 1 / 14.
- Une capture en vol par hybride : `docs/qa/balls-shots/forge-<id>.png`.

Données : `docs/qa/forge-data/divine.json`, `docs/qa/forge-fun.json`, `docs/qa/balls-data/forge-*.json`, `docs/qa/balls-data/forge-rank-*.json`, `docs/qa/balls-data/perf-forge.json`.
