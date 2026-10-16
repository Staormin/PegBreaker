# PEGBREAKER — Les 27 balles (2026-10-17)

Chaque balle a **une** mécanique lisible en une phrase, un effet amplifié par le rang (II, III), et une place dans le build (synergie avec le combo, la fusion, les contrats ou une relique). Les 7 d'origine restent ; 20 nouvelles.

Rang : sauf mention, rang II = effet ×1,5 (ou +1 selon la nature), rang III = ×2 (ou +2). Les dégâts suivent toujours `tierDamageMultiplier`.

## Familles (pour le son et le visuel)
`elemental` (feu, foudre, glace, acide, comète), `heavy` (plomb, géante, bombe, choc), `tricky` (fantôme, perforante, quantique, écho, boomerang, traqueuse), `swarm` (scission, essaim, jumelle), `greed` (or, chance, aimant, vampire), `arcane` (prisme, vide, cristal, nova, rouille, pierre).

## Les 20 nouvelles

| id | Nom | Effet (rang I) | Rang II / III | Famille | Déblocage |
|---|---|---|---|---|---|
| acid | Acide | Le bloc touché perd 6 % de ses PV max au début de chacun des 3 tirs suivants (cumul max 3 charges). | 9 % / 12 % | elemental | Puits 60 |
| magnet | Aimant | Ramasse les drops à moins de 1,2 u de sa trajectoire. | 1,8 / 2,5 u | greed | Puits 50 |
| pierce | Perforante | Traverse le premier bloc touché de chaque tir (dégâts ×1,5), puis rebondit normalement. | 2 / 3 blocs traversés | tricky | Puits 80 |
| bomb | Bombe | Explose en touchant le sol : rayon 1,4 u, dégâts ×3 de sa base. | rayon 1,8 / 2,2 | heavy | Puits 90 |
| homing | Traqueuse | Après chaque rebond, dévie de 12° au plus vers le bloc le plus proche. | 20° / 30° | tricky | Puits 110 |
| giant | Géante | Rayon ×1,8, dégâts ×2, vitesse ×0,85, combo +0 par rebond de mur. | rayon ×2,1 / ×2,4 | heavy | Puits 120 |
| swarm | Essaim | À chaque impact, 25 % de chance de libérer une mini-balle (dégâts ×0,3, rayon ×0,6, 6 max par tir). | 35 % / 50 % | swarm | Puits 100 |
| vampire | Vampire | Chaque bloc qu'elle détruit rend 1 PV (1 fois par tir). | 2 / 3 fois par tir | greed | Puits 130 |
| gold | Or | Les blocs qu'elle détruit lâchent toujours des pièces (valeur ×1,5) ; dégâts ×0,7. | ×2 / ×3 | greed | Puits 70 |
| prism | Prisme | À chaque rebond de mur, un rayon horizontal inflige 30 % de ses dégâts à tous les blocs de sa rangée. | 45 % / 60 % | arcane | Puits 140 |
| void | Vide | Ignore l'armure et ajoute 6 % des PV max du bloc à chaque impact. | 9 % / 12 % | arcane | Puits 150 |
| echo | Écho | Quand elle touche le sol, une copie fantôme (50 % dégâts) repart vers le haut depuis ce point, une fois. | 70 % / 100 % | tricky | Puits 120 |
| boomerang | Boomerang | Après 1,5 s de vol, fait demi-tour vers le point de lancement en frappant au passage ; se pose à l'arrivée. | 2 / 3 allers-retours | tricky | Puits 110 |
| crystal | Cristal | +20 % de dégâts par rebond (en plus du combo) mais éclate après 8 rebonds (éclats : 4 mini-balles ×0,25). | 10 / 12 rebonds | arcane | Puits 90 |
| shock | Choc | Le bloc touché recule d'une rangée vers le haut si la case est libre (1 fois par bloc par tir). | 2 / 3 fois | heavy | Puits 100 |
| twin | Jumelle | Tirée en deux balles à angles miroirs (±8°), 70 % de dégâts chacune. | 3 / 4 balles | swarm | Puits 80 |
| rust | Rouille | Le bloc touché perd 15 % de PV max définitivement et son armure. | 22 % / 30 % | arcane | Puits 70 |
| nova | Nova | À chaque palier de combo (3/8/16), explose : rayon 1,2 u, dégâts = combo × 3. | ×4 / ×6 | arcane | Succès combo15 |
| comet | Comète | Vitesse ×1,4 ; chaque rebond de plafond donne +3 combo. | +4 / +6 | elemental | Succès wave5 |
| lucky | Chance | 20 % de critique ×3 par impact ; les drops qu'elle ramasse valent double. | 30 % / 40 % | greed | Succès shot5000 |

Déblocages par succès : le succès débloque l'élément sans fragment (`unlockElement:` via achievement `unlocks`).

## Règles communes
- Toutes apparaissent dans les drops, les offres et la boutique **seulement si débloquées** (`unlockedElements`). Poids de tirage dans `balls.json` (les fortes ont un poids plus faible).
- Fusion : identique pour toutes (même élément, même rang).
- Contrats `killWithElement` : étendus aux nouvelles familles (un contrat par famille, tiré seulement si la volée contient un élément de la famille).
- Reliques : `pyromane`, `paratonnerre`, `permafrost`, `spectre`, `enclume`, `mitose` s'appliquent aussi aux balles proches (comète = feu pour pyromane ? non : chaque relique garde son élément exact ; pas de synergie implicite).
- Plafond de performance : mini-balles (essaim, cristal, jumelle, écho) comptent dans la limite de 30 balles vivantes par tir.
