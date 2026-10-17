# QA — Vente, forge, hybrides, Divine, catalyseur, codex (2026-10-17, repasse sur 5d0b54c)

Build testé : `5d0b54c` (Marteau corrigé, coûts 35/25, rangs resserrés, textes et toasts), bundle 332,0 ko / **110,9 ko gzip**. Suite complète `npm run build && npm run test:e2e` : **102 passés, 1 ignoré, 0 échec en 9 min 33 s** (machine chargée, charge ≈ 11). Premier passage : `e35c8cf` (chiffres « avant » rappelés entre parenthèses).

## 1. Résumé (5 lignes)

**Verdict : OK avec réserves.** FG-01, FG-02, FG-03 et FG-04 sont corrigés et vérifiés ; la suite est verte.
1. **FG-03 corrigé** : le forgeron atteint la vague **11,3** contre **10,7** sans forge (avant : 10,4 contre 10,6) ; écart apparié **+0,86** sur les runs qui forgent (cible ≥ +0,5) ; 7 runs sur 10 forgent.
2. **Nouveau FG-05 (majeur, équilibrage)** : Missile rang III à **31,3×** la volée de pierres (cible 7×, fourchette annoncée [6 ; 9]) ; Grappe III **17,3×**.
3. **Divine** à **24,7×** sur blocs de 2 000 PV (plafond annoncé 18), 5,41× sur un vrai plateau de vague 4.
4. **Perf non re-mesurée** sur ce build : la machine était chargée (charge 10-12), la mesure isolée n'est pas exploitable.

## 2. Métriques

### Fonctionnel (`tests/e2e/forge.spec.ts`)

Protocole : défi `?seed=<seed>&goal=0` (pool standard, run créditée), bot greedy jusqu'à la récompense de la vague 3, puis volée et pièces forcées et boutique ouverte. Ensuite, tout passe par le DOM.

| Test | Seed | Résultat mesuré |
|---|---|---|
| (a) vente | forge-sell | Feu III +32, Vapeur II +90, Glace II +14 (= `economy.sell`). Dernière balle : bouton désactivé, `sim.sell` → 0. 3 `shop:sold` |
| (b) forge | forge-hybrid | Feu II + Glace I → `steam` rang I, −25 pièces (avant 40). `shop:forged` (parents fire/ice). `.toast-forge` et `.toast-codex` affichés. `meta.data.codex = ['steam']` à la frame suivante. `RunSummary.forged = ['steam']`, `stats.forged = 1`. `hybrid1` absent avant la fin de run, présent après |
| (c) upgrade | forge-upgrade | Laser I → II (−60) → III (−120). Événements `shop:upgraded` (2, 60) et (3, 120). Plus de bouton au rang III ni sur une balle de base |
| (d) Divine | forge-divine | Vapeur III + Laser III → `.forge-divine` → Divine (−150), inscrite au codex. 3 tirs : 4 `block:explode` divine et 5 `lightning:chain` divine. Dégâts par tir **[214, 292, 252]** contre **[54, 54, 54]** pour la run pierre (même plateau vérifié) → **5,41×** (avant 6,33×) |
| (e) catalyseur | forge-cata | Feu I + 3 pierres → 1 article catalyseur `ball ice II` à 35 (avant 60), ligne « Partenaire de Feu → Vapeur ». 4 articles. Achat → carte forge `steam` dans la même boutique → forgée |
| (f) codex | forge-codex | 14 entrées « ? + ? → ??? », compteur « 0 / 14 ». Forge Cristal II + Nova I → Supernova connue (« Cristal … + Nova … »), compteur « 1 / 14 », 13 entrées inconnues |

### Signaux par hybride (`balls.spec.ts`, volée forcée de 5 balles aux rangs I, I, I, II, III, `?seed=forge-<id>&qa=1`)

| Balle | Signal (effet propre) | Mesuré |
|---|---|---|
| steam | `block:explode` steam | 18 nuages, 13 gels |
| laser | `lightning:chain` laser | 12 rayons de colonne |
| cluster | `ball:split` + `block:explode` cluster | 60 grappes, 165 mini-explosions |
| wraith | impact bonifié au même combo | 1 impact bonifié sur 7 (8 tirs ; signal rare) |
| abyss | acide gagné sans impact (propagation) | 6 blocs (blocs de 1 500 PV ; à 200 PV : 0, voir observation) |
| jackpot | critique + pièce dans le même pas | 2 / 2 critiques (8 tirs) |
| quake | ≥ 2 blocs d'une rangée remontent ensemble | 6 rangées |
| missile | vitesse > 1,1× + explosion missile | ×2,00 (plafond), 7 explosions |
| supernova | explosion supernova, 0 éclatement de cristal | 5 / 0 (blocs de 400 PV : sur le plateau normal, combo max 2 → 0 palier) |
| plague | acide propagé à la mort | 9 blocs, 23 soins |
| choir | `ball:split` choir + copies écho | 30 / 108 |
| orbit | ≥ 2 rebonds au sol par balle | 2, 10 drops aspirés (≤ 0,72 u) |
| hammer | PV max qui baissent + bloc repoussé | 6 / 2 (blocs de 400 PV depuis 5d0b54c, voir ci-dessous) |
| divine | nova + Jugement | 18 novas, 11 éclairs |

**Marteau, échec après 5d0b54c (« 1 bloc érodé, 0 recul »)** : c'est le scénario, pas une régression. La perte de PV max est maintenant ajoutée aux dégâts divisée par `rankMult`, donc le premier contact tue les blocs de vague 1-2 (14 à 27 PV) : un bloc mort n'est ni érodé (le compteur lit l'état après le pas) ni repoussé. Ce n'est ni la rangée 0 ni un boss (aucun `boss:spawned` sur la graine `forge-hammer`, vagues 1-2). Avec des blocs de 400 PV : 6 érodés, 2 reculs.

Partout : 0 NaN, 0 violation d'invariant, 0 erreur console, au plus 30 balles vivantes, au plus 658 particules.

### Dégâts par rang, relatifs à 5 pierres I

Protocole : même pilote, 3 graines `balls-ref-*`, 6 tirs, blocs à 2 000 PV pour ne pas plafonner. Pierre = 1 170. Cibles HYBRIDS.md : I ≈ 3,5×, III ≈ 7×, Divine ≈ 15×.

| Hybride | I | II | III |
|---|---|---|---|
| steam | 4,95× | 6,71× | 9,26× |
| laser | 3,81× | 5,36× | 7,48× |
| cluster | **7,08×** | 8,96× | **17,34×** |
| wraith | 5,81× | 8,72× | **11,91×** |
| abyss | 4,60× | 5,61× | 6,77× |
| jackpot | **2,58×** | 3,58× | 6,13× |
| quake | 4,18× | 7,65× | 8,18× |
| missile | 3,09× | 3,78× | **31,32×** |
| supernova | **2,98×** | 3,80× | **4,98×** |
| plague | 4,18× | 6,19× | 7,28× |
| choir | 3,89× | 5,47× | 8,36× |
| orbit | **7,09×** | 8,97× | 9,00× |
| hammer | 3,49× | 4,95× | 7,66× |
| **moyenne** | **4,44×** (avant 4,62×) | 6,14× | **10,44×** (avant 9,02×) |
| Divine (5 balles) | **24,7×** (avant 26,8×) | | |

Hors de la fourchette annoncée (I ∈ [3 ; 4,5], III ∈ [6 ; 9], Divine ≤ 18) sur ce protocole : I : cluster, wraith, abyss, orbit (au-dessus), jackpot, supernova (en dessous) ; III : missile, cluster, wraith, steam (au-dessus), supernova (en dessous) ; Divine. Le protocole diffère de celui de la sim (3 graines `balls-ref-*`, 6 tirs, blocs à 2 000 PV, pilote QA) : à confronter.

### Fun : pool standard du défi (27 balles), `fun.spec.ts`

Paramètres : bots tight et conditional, graines qa-1 à qa-5, vitesse 8, seconde chance gratuite. Le forgeron forge dès que possible (Divine d'abord), sinon il achète le catalyseur s'il est payable. Budget par run : 110 s réelles.

| Métrique | Sans forge | Forgeron (5d0b54c) | Forgeron (e35c8cf) |
|---|---|---|---|
| Runs | 10 | 10 | 10 |
| Runs qui forgent | 0 | **7 / 10**, 34 hybrides, 0 Divine | 6 / 10, 13 hybrides |
| Vague de première forge | | **5,1** | 8,0 |
| Boutiques avec catalyseur | | 32 / 32 (100 %) | 29 / 29 |
| Boutiques où une forge est possible | 37 % | **84 %** (cible ≥ 25 %) | 62 % |
| … dont forge possible mais pas assez de pièces | | 13 / 27 | 14 / 18 |
| Vague atteinte (moyenne) | 10,7 | **11,3** | 10,4 |
| Vague, runs avec / sans hybride | | 13,3 / 6,7 | 12,5 / 7,25 |
| Écart de vague apparié (runs qui forgent) | | **+0,86** (cible ≥ +0,5) | −0,17 |
| Meilleur tir, avec / sans hybride | | 16 382 / 3 647 | 17 918 / 2 938 |
| Durée joueur (min) | 9,4 | 10,5 | 8,7 |
| Moments morts, erreurs | 0, 0 | 0, 0 | 0, 0 |

Par graine (forgeron / sans forge) : tight qa-1 13/10, qa-2 10/11, qa-3 15/10 (coupé à 110 s), qa-4 17/13 (coupé), qa-5 7/7 ; conditional qa-1 10/8, qa-2 7/7, qa-3 16/17, **qa-4 12/18**, qa-5 6/6. Deux runs coupées par le budget : le gain réel est sous-estimé. Le 13,3 contre 6,7 reste un biais de sélection.

### Perf (mesure du premier passage, e35c8cf ; non re-mesurée sur 5d0b54c, machine chargée)

Mesure isolée (`--workers=1`, machine au repos, charge ≈ 2), CPU 4×, 720 × 1280, DPR 1,5, 3 tirs à vitesse 1.

| Mélange | fps min (3 passages) | Moyenne | p95 / p99 | Frame max | Particules | Vivantes |
|---|---|---|---|---|---|---|
| **13 hybrides × 2 + 2 Divines + bombe + nova** | **52 / 52 / 52** | 57 | 16,8 / 33,4 ms | 133 ms | 126 | 29 |
| 20 nouvelles + 10 (existant) | 48 / 46 / 47 | 58 | 16,8 / 33,4 ms | 100 ms | 55 | 27 |
| 7 d'origine (contrôle) | 53 | 57 | 16,8 / 33,4 ms | 117 ms | 54 | 27 |

Le mélange forge respecte la cible (≥ 50). Le mélange « nouvelles familles » est toujours sous la cible (B-04 de balls.md, toujours ouvert) : une frame de 100-133 ms environ 1 s après le tir (bascule DPR 1,5 → 1,25). Une première mesure faite pendant que la machine était chargée (charge ≈ 6, autres agents) donnait 27 / 39 / 44 : elle n'est pas retenue.

## 3. Bugs

| ID | Gravité | Statut (5d0b54c) | Seed / étapes | Attendu / observé | Fichier suspect |
|---|---|---|---|---|---|
| FG-01 | majeur | **corrigé** | `?seed=balls-ref-1&qa=1`, 5 Marteaux rang III, blocs à 2 000 PV, 1 tir ; test de non-régression `balls.spec.ts` (hp ≤ maxHp à chaque pas) | Avant : hp 1 671 / maxHp 1 600. Après : 0 violation (non-régression + 39 runs de rangs) | `src/sim/elements/hybrid.ts` (`hammerOwn`) |
| FG-02 | mineur | **corrigé** | Boutique sans forge ; Puits → Codex | Textes : « l'un de rang II ou plus, l'autre de rang I ou plus » (boutique et codex) ; icônes de recette connue rang II + I | `src/ui/screens/shop.ts:53`, `src/ui/screens/well.ts:298, 312` |
| FG-03 | majeur (équilibrage) | **corrigé** | `fun.spec.ts` test « forge », qa-1 à qa-5 | Forgeron 11,3 contre 10,7 ; écart apparié +0,86 (≥ +0,5). Reste : conditional qa-4, 12 contre 18 (3 forges, la run sans forge va plus loin) | `src/config/economy.json` (35 / 25) |
| FG-04 | mineur | **corrigé** | Capture 04 | Un seul toast compact d'une ligne dans la bande du haut (`band`), HUD (cœurs, pièces) visible pendant le tir de la Divine | `src/ui/screens/toasts.ts` |
| FG-05 | majeur (équilibrage) | **nouveau** | `balls.spec.ts` « forge rangs missile » : graines `balls-ref-1..3`, `qa=1`, 5 Missiles rang III, 6 tirs, blocs à 2 000 PV | Attendu III ∈ [6 ; 9]×. Observé **36 642 dégâts = 31,3×** (2 036 / tir) contre 4 428 au rang II (×8,3 pour un rang). Cluster III 17,3×, Divine 24,7× (≤ 18 annoncé) | `src/config/balls.json` (`missile.params.explodeAtBounce` III = 3, `rankMult` III), `hybrid.ts` (`missileOwn`) |
| B-04 | mineur | ouvert (non re-mesuré) | `npx playwright test balls -g "perf : 30 balles, nouvelles" --workers=1` | Au premier passage : fps min 46-48 (cible 50), frame de 100-133 ms environ 1 s après le tir | `src/render/index.ts` (`lowerQuality`) |

## 4. Fun

**Ce qui fonctionne bien**
- La boutique se lit bien : la carte forge annonce la recette, le nom, l'effet et le prix. Le catalyseur dit pour quelle recette il sert. Toasts et codex rendent la découverte tangible.
- La Divine en vol est spectaculaire (capture 04) : 5,4× une volée de pierres sur un vrai plateau de vague 4, nova et Jugement bien visibles.
- Forger rapporte maintenant : +0,86 vague sur les mêmes graines, première forge à la vague 5, 7 runs sur 10 forgent. Le meilleur tir est multiplié par 4,5.

**Ce qui tombe à plat (5d0b54c)**
- Il y a un catalyseur dans 100 % des boutiques du pool standard : il remplace toujours un article normal et n'a plus rien d'un événement.
- 13 forges possibles sur 27 restent impayables (le bot achète le catalyseur avant d'avoir de quoi forger).
- La Supernova ne produit aucun palier sur les vagues 1-2 (combo max 2). L'Abysse ne propage jamais son acide sur des blocs normaux, qui meurent dans le tir.
- Rang III très inégal : Missile 31,3× et Grappe 17,3× contre Supernova 5,0×. Le Missile III écrase tout (FG-05).

Les propositions du premier passage ont été appliquées (catalyseur 60 → 35, forge 40 → 25 ; rangs resserrés) : FG-03 est corrigé.

**Trois propositions chiffrées (nouvelles)**
1. `balls.json → missile.params.explodeAtBounce` : **[5, 4, 3] → [5, 4, 4]**, et `rankMult` III **0.547 → 0.3**, pour ramener le Missile III de 31× vers [6 ; 9]×. C'est le rang où une explosion ×3 se déclenche tous les 3 rebonds à vitesse ×2.
2. `balls.json → cluster.params.rankMult` III : **0.982 → 0.5** (17,3× → ≈ 9×).
3. `balls.json → divine.params.judgement` : **23 → 15**, et `novaDamage` **15 → 10** (24,7× → ≈ 17× sur blocs de 2 000 PV, sous le plafond de 18).

## 5. Captures (`docs/qa/forge-shots/`)
- `01-boutique-forge.png` : boutique avec la carte forge Feu II + Glace I → Vapeur.
- `02-forge-toast.png` : après la forge (toasts, flash de la volée).
- `03-boutique-divine.png` : carte `.forge-divine`.
- `04-divine-en-vol.png` : la Divine en vol (FG-04 corrigé : un seul toast compact).
- `05-catalyseur.png` : article catalyseur « Partenaire de Feu → Vapeur » (FG-02 corrigé : texte rang II + I).
- `06-codex-vide.png` et `07-codex-une-recette.png` : codex 0 / 14 puis 1 / 14.
- Une capture en vol par hybride : `docs/qa/balls-shots/forge-<id>.png`.

Données : `docs/qa/forge-data/divine.json`, `docs/qa/forge-fun.json`, `docs/qa/balls-data/forge-*.json`, `docs/qa/balls-data/forge-rank-*.json`, `docs/qa/balls-data/perf-forge.json`.
