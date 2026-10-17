# PEGBREAKER — Vente, forge, hybrides et Divine (2026-10-17)

## Vente (boutique)
Chaque groupe de la volée a un bouton « Vendre » : `economy.sell.byTier` pièces par balle de base (rang I/II/III), `economy.sell.hybridByTier` pour une hybride, `economy.sell.divine` pour la Divine. On ne peut jamais vendre la dernière balle de la volée. Vendre est le moyen de convertir un build raté en pièces pour la forge.

## Forge (boutique)
La boutique affiche une section **Forge** : les paires de balles de la volée qui forment une recette avec **au moins un parent de rang II** (l'autre peut être de rang I), avec l'aperçu de l'hybride produite (nom, description, effet propre) et son coût `economy.forge.hybridCost` pièces. Forger consomme les deux parents et donne l'hybride au rang I.

- **Upgrade** : deux hybrides identiques fusionnent comme les autres balles (carte Fusion), et la forge propose aussi l'upgrade payant d'une hybride seule : I → II (`forge.upgradeCost[0]`), II → III (`forge.upgradeCost[1]`).
- **Divine** : deux hybrides de **rang III** (identiques ou non) → la **Divine** (`forge.divineCost`). Deux Divines ne fusionnent pas.
- **Catalyseur** : quand la volée contient un parent d'une recette (n'importe quel rang) et pas l'autre, la boutique propose en article le partenaire manquant **au rang II** pour `forge.catalystCost` pièces (un seul catalyseur par boutique, tiré parmi les recettes ouvertes). C'est la voie principale vers une hybride dans une bonne run.
- Accessibilité visée : une forge possible dans au moins 1 boutique sur 4 pour un bot qui achète le catalyseur (mesure QA).
- Les hybrides et la Divine n'apparaissent jamais en drop, en offre ni en vente de boutique (`weight: 0`) : elles ne viennent que de la forge.
- **Codex** : chaque hybride forgée est inscrite dans `save.codex` ; le Puits affiche la page Codex (recettes découvertes en clair, les autres en « ? + ? ») ; succès `hybrid1` (première hybride), `hybrid5`, `divine1`.

## Hybrides : effets parents au rang de l'hybride + effet propre
Rang : l'effet propre suit `params[rang−1]`. Les effets parents utilisent leurs propres tables au même rang.

| id | Nom | Recette | Effet propre (rang I → III) |
|---|---|---|---|
| steam | Vapeur | fire + ice | À l'impact, un nuage (rayon 1,2 u) inflige 25 % → 45 % des dégâts aux blocs voisins et les gèle (max 1 nuage/tir → 3). |
| laser | Laser | lightning + prism | Le rayon du prisme frappe aussi toute la **colonne** du bloc touché (35 % → 65 %, plafonds du prisme). |
| cluster | Grappe | bomb + split | L'explosion au sol libère 3 → 5 mini-bombes (mini-balles qui explosent à leur premier impact, rayon 0,8 u, ×0,5). |
| wraith | Spectre | ghost + pierce | Traverse tout ; +15 % → +30 % de dégâts par bloc traversé dans le même vol (plafond 10 blocs). |
| abyss | Abysse | acid + void | Les charges d'acide se propagent aux blocs voisins à chaque tour (1 → 3 voisins), plafond 150 → 250 par tour et par bloc. |
| jackpot | Jackpot | gold + lucky | Critiques ×4 ; chaque critique lâche une pièce ; 5 % → 15 % de chance qu'un bloc détruit lâche un fragment. |
| quake | Séisme | giant + shock | À chaque rebond sur un bloc, toute sa rangée recule d'une case vers le haut si libre (1 → 3 fois par tir). |
| missile | Missile | comet + homing | Traque et accélère (+10 % par rebond, plafond ×2) ; au 5e → 3e rebond, explose (rayon 1 u, ×3) et continue. |
| supernova | Supernova | crystal + nova | Explosion à chaque palier : rayon 2 u, combo × 12 → 20 (plafond 2000 → 4000) ; n'éclate plus. |
| plague | Peste | vampire + acid | Un bloc rongé qui meurt rend 1 PV (max 2 → 4/tir) et contamine 1 → 3 voisins. |
| choir | Chœur | twin + echo | 3 → 5 balles miroirs, et chacune repart du sol une fois à 50 % → 100 %. |
| orbit | Orbite | boomerang + magnet | 3 allers-retours, aspire les drops à 3 u, chaque retour frappe +50 % → +100 %. |
| hammer | Marteau | lead + rust | Dégâts ×3, retire 30 % → 45 % de PV max et l'armure, repousse le bloc d'une rangée. |

## Divine
`divine`, famille `divine`, obtenue de deux hybrides de rang III. Dorée en permanence (× `lastBallMultiplier` + bonus), dégâts de base 60, rayon ×1,3, traverse tout, ignore l'armure, **nova à chaque rebond** (rayon 1,5 u, 250 dégâts plafonnés), **drop garanti** par bloc détruit, +3 combo par rebond, et à l'atterrissage **Jugement** : tous les blocs de la rangée cassable la plus basse prennent 1 500 (plafonné). Les plafonds anti-infini s'appliquent. Vente : `sell.divine`.

## Économie (economy.json)
`sell.byTier` [6, 14, 32], `sell.hybridByTier` [45, 90, 180], `sell.divine` 400 ; `forge.hybridCost` 25, `forge.upgradeCost` [60, 120], `forge.divineCost` 150, `forge.catalystCost` 35 (baissés après mesure QA : à 60 + 40, 14 boutiques sur 18 n'avaient pas les pièces). Repères : à la vague 6 un joueur a 60-120 pièces ; une hybride demande 8 balles de base identiques deux à deux (2 × rang III) : c'est l'objectif d'une bonne run ; la Divine (16 balles) celui d'une run exceptionnelle ou d'un pool standard de défi.

## Équilibrage visé (bot naïf, volée de départ)
Une forge doit **rapporter** : l'hybride vaut au moins ses deux parents réunis (un rang II + un rang I ≈ 3,5 pierres). Cibles (dégâts par tir, 5 balles, relatif à 5 pierres de rang I) : hybride rang I ≈ 3,5× ; rang III ≈ 7× ; Divine ≈ 15× ; et surtout, sur mêmes graines avec la méta complète, un bot qui forge dès que possible atteint une vague ≥ celle d'un bot qui ne forge jamais + 0,5. Toujours borné par les plafonds et la brèche croissante (aucune run > vague 35).
