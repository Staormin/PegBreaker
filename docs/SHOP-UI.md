# Boutique — direction visuelle (2026-10-17)

Référence de qualité : la boutique de Brotato (inventaire en tuiles, détail au clic), le rythme de Balatro (peu d'éléments, gros, lisibles). Règle : **on regarde des objets, on ne lit pas des lignes.**

## Mise en page (≥ 900 px de large, ex. 1176×560)
```
┌ Boutique · vague 15 ───────────────────────────────────── 🪙 254 ┐
│ ARTICLES (4 cartes, 1 rangée)      │ TA VOLÉE · 29   [grille de tuiles] │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐        │ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉                    │
│ │icon│ │icon│ │icon│ │icon│        │ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉                    │
│ │nom │ │nom │ │nom │ │nom │        │ ◉ ◉ ◉ ◉                            │
│ │ 20 │ │ 15 │ │ 35 │ │ 12 │        ├────────────────────────────────────┤
│ └────┘ └────┘ └────┘ └────┘        │ DÉTAIL de la tuile sélectionnée     │
│                                    │ [icône] Vapeur III · Feu + Glace    │
│ FORGE (0-3 rangées : ◉ + ◉ → ◉ 25) │ effet propre, dégâts ×…             │
│                                    │ [Vendre 180] [Rang +1 120] [Forger…]│
└──────────────── [Reroll 🪙 8]  [Continuer ▶] ─────────────────────────────┘
```
- **Tuile** (56×56 px, 48 sur mobile) : icône de la balle, **badge ×N** en haut à droite (si N ≥ 2), **pastilles de rang** (1 à 3 points) en bas, liseré de la couleur de l'élément, fond sombre. Hybride : tuile bicolore ; Divine : tuile dorée. Aucun texte dans la tuile. Groupée par (élément, rang), triée : Divine, hybrides, puis par rang décroissant puis ordre du JSON.
- **Sélection** : clic/tap sur une tuile → liseré accent + panneau détail (toujours visible ; par défaut la première tuile). Le panneau porte : icône grande, nom + rang en toutes lettres, famille, recette si hybride, description, effet propre ; boutons : « Vendre (+P) », « Vendre tout (+N×P) » si N ≥ 2, « Rang +1 (P) » si hybride < III, et « Forger avec … » si une recette est ouverte avec une autre tuile (ouvre la rangée de forge correspondante en surbrillance). Dernière balle : « Vendre » désactivé avec le motif en petit.
- **Articles** : 4 cartes égales en une rangée (icône 40 px, nom, ligne de description tronquée, prix, bouton « Acheter » plein). Catalyseur : ruban « ⚒ Catalyseur » + ligne « → Supernova » (le nom de l'hybride visé suffit).
- **Forge** : sous les articles, une rangée par option : tuile + tuile → tuile résultat, nom, prix, bouton « Forger ». Divine : rangée dorée. Vide : une ligne discrète « Combine deux balles d'une recette (rang II + rang I) · Voir les recettes ».
- **Pied** : barre fixe de 56 px avec Reroll (coût) et Continuer (accent) ; le contenu réserve cette hauteur : **rien ne passe dessous**. En paysage court, seule la grille de tuiles peut défiler (rarement : 8 colonnes × 4 rangées = 32 groupes).
- **Aucune infobulle native** (`title`) : tout passe par le panneau. `aria-label` sur les tuiles pour l'accessibilité.
- **Hiérarchie typographique** : titre 22 px, sections 12 px capitales espacées, noms 16 px gras, descriptions 14 px, chiffres tabulaires. Pas de « RANG II » en capitales partout : le rang se lit aux pastilles et dans le panneau.
- **Couleurs** : fond `--bg0`, cartes `--bg1`, liserés par élément à 60 % d'opacité, accent (`--accent`) réservé à la sélection et au bouton Continuer, or réservé à la Divine et aux pièces.

## Mobile (< 900 px)
Une colonne : articles (2×2), grille de tuiles (6 colonnes), panneau détail **collant en bas** au-dessus du pied (hauteur 112 px), forge sous la grille. Tap sur une tuile → le panneau se met à jour sans défilement.

## Interdits
Lignes de texte par balle, un bouton « Vendre » par ligne, infobulles natives, contenu caché sous le pied, défilement de la page entière.
