# PEGBREAKER — Document de design

> Roguelite de tir à rebonds, tour par tour, 100 % navigateur, solo, jouable d'un doigt.

## 0. Phase 0 — Recherche et choix

### Tendances observées (octobre 2026)

- **Roguelites « one more run » à sessions courtes** : Ball x Pit (Devolver, oct. 2025) dépasse 2 M de ventes en août 2026 ; Megabonk vend 1 M en deux semaines ; Nubby's Number Factory (plinko roguelite) est un succès culte. Point commun : une boucle de 10 à 20 minutes, des nombres qui montent, des synergies d'objets, une méta légère entre les runs.
- **Survivors-like** : toujours très joué mais saturé sur le web (221 jeux « survivor-like » jouables dans le navigateur sur itch.io, Vampire Pixel Survivors 9,1/10 sur CrazyGames).
- **Portails web (Poki, CrazyGames, ~150 M de joueurs mensuels cumulés)** : les hits durables sont des jeux à **une seule entrée** (tap, drag, un bouton) qui démarrent en moins de 5 secondes : Subway Surfers, Drive Mad, Level Devil, Stickman Hook, Moto X3M.
- **Incrémentaux et deckbuilders hybrides** sur itch.io (Retromine, Roulette Hero, Rataracta « Cookie Clicker rencontre Balatro ») : la fusion « nombres qui explosent + choix de build » est le format le plus noté.
- **Daily puzzles** : l'habitude quotidienne (Wordle, Rogule) tient mieux que les clickers viraux.

### Trois concepts candidats

| | A. Survivors-like | B. Roguelite à rebonds (choisi) | C. Score-chaser à la Balatro |
|---|---|---|---|
| **Boucle en une phrase** | Bouger, tirer automatiquement, choisir une amélioration à chaque niveau. | Viser, lâcher une volée de balles qui ricochent sur des blocs-ennemis, enchaîner les combos, choisir une amélioration entre les vagues. | Jouer des mains de cartes pour battre un quota, acheter des modificateurs en boutique. |
| **Méta-progression** | Personnages, armes, stats permanentes. | Types de balles et reliques à débloquer, « profondeur du puits », défi quotidien. | Decks, jokers, enjeux. |
| **Hook des 30 premières secondes** | Horde à l'écran, premier level-up vers 15 s. | **Premier tir à 3 s** : chaos physique, nombres qui jaillissent, blocs qui éclatent ; première amélioration vers 25 s. | Lent : il faut lire les cartes et comprendre le score. |
| **Faisabilité web pur** | Bonne, mais 500+ entités à 60 fps sur mobile demande un gros travail de perf. | **Excellente** : physique cercle/rectangle triviale, < 100 entités, entrée tactile à un doigt, canvas 2D suffit. | Excellente techniquement, mais le fun dépend presque entièrement de la quantité de contenu (cartes, synergies). |

### Choix : B, « Pegbreaker »

1. Le fun est **physique et immédiat** : le premier tir est déjà satisfaisant avant toute mécanique de build, ce qui colle à l'objectif « boucle avant contenu ».
2. Une seule entrée (glisser pour viser, relâcher pour tirer) : parfait sur mobile comme sur desktop, aucun tutoriel nécessaire.
3. Le genre est prouvé (Ball x Pit, Peglin, Nubby's) mais **encore peu présent sur les portails web**, contrairement aux survivors.
4. Très « juicable » : chaque rebond est une occasion de feedback (son, particules, hit-stop), et peu d'entités laissent un large budget de 60 fps.
5. La structure tour par tour donne une **décision toutes les 5 secondes** et une physique déterministe testable en headless.

## 1. Pitch

Tu es au fond d'un puits. Des blocs descendent vers toi, rangée par rangée. Tu disposes d'une volée de balles : tu vises, tu relâches, et elles ricochent partout en brisant les blocs. Chaque rebond sans toucher le sol fait monter le combo et les dégâts. Entre les vagues, tu choisis une balle ou une relique qui change la physique du jeu : balles de feu qui explosent, balles de foudre qui se chaînent, balles fantômes qui traversent. Deux balles identiques dans ta volée **fusionnent** en une balle de rang supérieur. Si un bloc atteint ta ligne, tu perds de la vie. Jusqu'où descends-tu ?

Références de ton : Ball x Pit, Peglin, Ballz, Nubby's Number Factory, Balatro (pour les nombres qui s'emballent).

## 2. Core loop (de la seconde à la minute)

```
 [VISER 1-3 s] → [TIRER : la volée vole 2-5 s] → [RÉSOLUTION : blocs cassés, drops, combo] → [LES BLOCS AVANCENT D'UNE RANGÉE]
       ↑                                                                                           │
       └──────────────────── vague nettoyée ? → [CHOIX 1/3 AMÉLIORATION] ←────────────────────────┘
```

### Le tir

- Le joueur glisse (souris ou doigt) depuis n'importe où sur l'écran : une ligne de visée avec **prévisualisation du premier rebond** apparaît. Relâcher tire.
- La volée part en rafale (une balle toutes les 60 ms) depuis la position du dernier impact au sol de la volée précédente (comme Ballz), ce qui rend chaque tir différent sans aléa pur.
- Les balles rebondissent sur les murs et les blocs (réflexion parfaite, pas de gravité), perdent 0 vitesse, et sont rappelées au sol une fois qu'elles touchent la ligne du bas. Un bouton « rappel » accélère la fin de volée (x3) pour les joueurs impatients.
- Un tir dure 2 à 5 secondes. Pas d'attente passive : les nombres de dégâts, les sons et les blocs qui éclatent remplissent le temps.

### Les blocs

- Grille de 7 colonnes. Chaque bloc a des **PV affichés** (nombre). Toucher un bloc retire les dégâts de la balle. À 0, le bloc éclate et peut laisser tomber : une pièce (monnaie de run), une balle supplémentaire (+1 à la volée), ou un fragment (monnaie méta).
- Types de blocs : standard ; **blindé** (ne prend des dégâts que par l'arrière ou par élément) ; **explosif** (dégâts en zone quand il casse) ; **cheville** (peg : incassable, fait rebondir, donne du combo) ; **cœur** (rend 1 PV).
- À chaque tir terminé, tous les blocs descendent d'une rangée et une nouvelle rangée apparaît en haut. Un bloc qui franchit la ligne du joueur lui inflige ses PV restants (plafonnés) en dégâts.

### Le combo

- Chaque rebond sur un bloc ou une cheville sans que la balle touche le sol incrémente le combo de la balle. Dégâts d'une balle = `base × (1 + combo × 0.1)`. Les paliers 5, 10, 20 déclenchent un flash d'écran et un son qui monte en hauteur.
- Le combo est la **principale source de nombres qui s'emballent** : viser pour coincer une balle entre deux rangées est le geste expert.

### La fusion (le twist)

- La volée est une liste de balles typées. Quand le joueur possède deux balles de **même type et même rang** (rang < 3), l'écran de récompense peut proposer une carte **Fusion** : les deux balles deviennent une seule balle de rang +1 (dégâts ×2,5, effet amplifié). C'est un **choix**, jamais automatique : garder beaucoup de petites balles (combo facile, chaos) ou concentrer la puissance (dégâts par touche, effets élémentaires plus forts). Rang maximal : 3.
- Seule exception : au plafond de 30 balles, la fusion devient automatique (elle borne le coût de la volée et récompense l'accumulation).
- Décision d'architecte après le premier test jouable : la fusion automatique compressait la volée (4 pierres → 1 balle de rang 3) et supprimait la montée en nombre de balles, qui est la sensation centrale du genre.

### Les éléments (types de balles)

| Type | Effet |
|---|---|
| Pierre | Standard. |
| Feu | Explose au premier contact (dégâts en zone 1 case), continue sa course. |
| Foudre | Chaque impact frappe aussi le bloc le plus proche (chaîne). |
| Glace | Gèle le bloc touché : il ne descend pas au prochain tour. |
| Fantôme | Traverse les blocs (frappe tous ceux sur sa trajectoire), rebondit seulement sur les murs. |
| Plomb | Dégâts ×3, pas de combo. |
| Scission | Se divise en deux au premier impact. |

### Les reliques (passifs)

Exemples : « +1 rebond gratuit par balle », « les pièces réparent 1 PV par 10 », « le premier bloc touché chaque tour est détruit », « les blocs explosifs ont 2× de rayon », « combo conservé au sol une fois par tour ». Au Jalon 1 : 6 reliques. Objectif final : 20.

## 3. Session loop (5 à 15 minutes) : une run

1. **Départ** : 3 balles de pierre, 5 PV, profondeur 0.
2. **Vague** : 5 à 8 tirs. Chaque vague a un nombre total de rangées à générer ; quand toutes sont générées et détruites (ou passées), la vague est nettoyée.
3. **Récompense** : choix entre 3 cartes (balle ou relique), ou « +15 pièces » si rien ne plaît. Toutes les 3 vagues, une **boutique** : acheter des balles, des reliques, une recharge de PV, ou reroll.
4. **Boss** toutes les 5 vagues : une rangée unique d'un bloc géant à 1 500+ PV avec un pattern (il tire des blocs vers le bas, il se régénère, il absorbe un élément).
5. **Mort** quand PV = 0. Écran de fin : profondeur atteinte, dégâts max en un tir, meilleur combo, fragments gagnés. Bouton « Rejouer » en gros, « Puits » (méta) à côté.

Durée visée : run 1 = 4 min (mort vague 3-4) ; run 5 = 8 min ; run experte = 15 min (vague 15+).

## 4. Méta-loop (plusieurs jours)

- **Fragments** (gagnés en run, conservés) dépensés dans **le Puits**, un arbre à 3 branches :
  - *Arsenal* : débloque de nouveaux types de balles et reliques dans le pool de drops (contenu).
  - *Fondations* : +1 PV de départ, +1 balle de départ, +10 % pièces, un reroll gratuit (puissance brute, plafonnée pour ne pas tuer la difficulté).
  - *Profondeur* : débloque des modificateurs de run optionnels (plus dur, plus de fragments) : la source de rejouabilité long terme.
- **Défi quotidien** : une seed partagée par date, mêmes drops pour tous, score local enregistré. Sans serveur : pas de classement en ligne, mais un historique personnel des 30 derniers jours.
- **Succès** (une trentaine) : « combo 50 », « fusionner une balle rang 3 », « finir une vague sans perdre de PV ». Ils donnent des fragments.
- Sauvegarde locale (localStorage) : méta, succès, run en cours (reprise après fermeture), historique du quotidien.

## 5. Sources de récompense

| Horizon | Récompense | Fréquence visée |
|---|---|---|
| < 1 s | Son de rebond, nombre de dégâts, particule, bloc qui éclate | plusieurs par seconde pendant le tir |
| 2-5 s | Palier de combo (flash, pitch qui monte), drop d'une balle ou de pièces | 1 par tir |
| 20-40 s | Choix d'une amélioration ; fusion visible (animation) | 1 par vague |
| 2 min | Boutique ; boss vaincu | 1 toutes les 3-5 vagues |
| fin de run | Fragments, record personnel, succès | 1 par run |
| jours | Déblocage dans le Puits, nouvelle balle découverte, défi quotidien | 1-2 par session |

**Première récompense < 10 s** : le premier tir part à ~3 s (aucun menu obligatoire : le jeu démarre directement sur un plateau avec une flèche « glisse pour viser ») et casse un bloc à ~4 s.

## 6. Courbe de difficulté

- PV des blocs d'une rangée : `base(vague) × rand(0.6, 1.4)`, avec `base = 10 × 1.18^(vague-1) × (1 + 0.04 × tir)`.
- Densité : 3 blocs/rangée en vague 1, jusqu'à 5-6 en vague 10+. Blocs spéciaux introduits progressivement : chevilles dès la vague 1, explosifs vague 2, blindés vague 4, boss vague 5.
- Puissance du joueur : +1 balle tous les ~2 tirs via drops (plafonnée à 30 balles par tir pour la perf), choix tous les 6-8 tirs. L'équilibrage vise un **ratio dégâts/PV ennemis** qui descend doucement de 1,3 (vague 1) à 0,9 (vague 10) : le joueur gagne en puissance mais doit viser mieux.
- Toute la courbe est dans `config/*.json`, aucune constante dans le code.

## 7. Hors scope (explicitement)

- Multijoueur, classement en ligne, comptes, backend quelconque.
- Gravité ou physique « réaliste » : réflexion parfaite uniquement.
- Histoire, dialogues, personnages, cinématiques.
- Monétisation, publicités.
- Localisation : textes en français uniquement (très peu de texte, icônes partout où c'est possible).
- Assets externes : tout est généré par code (formes, dégradés, WebAudio).
- Mode paysage sur mobile : le jeu est **portrait** (ratio 9:16 à 3:4) ; sur desktop il s'affiche centré avec des marges.
