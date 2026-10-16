# PEGBREAKER — Plan fun (organisateur du fun, 2026-10-16)

## Diagnostic (docs/qa/final.md)
- Ce qui marche : première récompense en 3,8 s, 18 décisions/min, 0 moment mort, boucle de tir lisible.
- Ce qui manque pour « ne plus pouvoir s'arrêter » :
  1. **Une seule décision par tir** (la direction). Les bons jeux du genre en ont deux ou trois par tir.
  2. **Pas d'objectif à 30 secondes** : entre deux récompenses, le joueur subit. 10 % des tirs d'un débutant atteignent un combo de 5 : il ne sait pas quoi chercher.
  3. **La mort est sèche** : pas de « presque », pas de revanche, pas de comparaison au record.
  4. **Rien à partager** : pas de carte de score, pas de défi à envoyer, pas de raison de revenir demain.
  5. **La fin de volée est plate** : la dernière balle n'a pas plus de valeur que la première.

## Les leviers (psychologie du « encore une »)
Récompense variable à chaque tir · objectifs courts visibles · maîtrise lisible (le joueur voit qu'il devient bon) · presque-réussite (near miss) · perte évitée (seconde chance) · comparaison sociale sans serveur (lien de défi, carte de score) · rendez-vous quotidien (série) · nouveauté sans contenu (mutateurs).

## Lot 1 — ce qui multiplie le fun à chaque tir et à chaque mort

| # | Mécanisme | Levier | Comment |
|---|---|---|---|
| F1 | **Tir en éventail** : plus le geste est long, plus la volée s'ouvre (rafale serrée ↔ éventail large). Visible dans la ligne de visée qui se déploie. | Décision par tir, maîtrise | Sim : `aim(dir, spread)` ; UI : longueur du drag → spread ; rendu : éventail de visée. |
| F2 | **Contrats de vague** : un objectif court tiré au sort à chaque vague (« Casse 4 blocs en un tir », « Combo 10 », « Ramasse 20 pièces », « Vague sans dégât »), récompense immédiate (pièces, balle, PV). | Objectif à 30 s, apprentissage du combo | Sim : `contracts.json`, suivi, événements ; UI : bandeau HUD avec jauge. |
| F3 | **Balle dorée** : la dernière balle de chaque volée fait ×2 et brille. On regarde la fin de volée. | Récompense variable, fin de volée | Sim : `golden` ; rendu : or + traînée ; audio : son distinct. |
| F4 | **Seconde chance** : à la mort, une fois par run, « Revanche ? » contre des fragments (ou gratuit à la run 1) : PV à moitié, 3 rangées du bas effacées. | Perte évitée, « presque » | Sim : `run:lost` → `revive()` / `giveUp()` ; UI écran avec compte à rebours ; méta : `spendFragments`. |
| F5 | **Presque-record** : pendant la run, « Record : V7 » dans le HUD ; à la mort, « Tu étais à 1 vague du record », « Nouveau record ! ». | Comparaison à soi | UI, depuis `meta.data.stats`. |
| F6 | **Carte de score + défi par lien** : bouton « Partager » → image PNG générée (profondeur, combo, dégâts, volée, seed) + lien `?seed=X&goal=N`. Le destinataire joue **la même graine** avec « Objectif : battre la profondeur N » affiché ; à la fin : « Tu as battu Kevin » (sans serveur). | Partage viral | UI : canvas → PNG, Web Share API, presse-papiers ; main.ts : lecture de `goal`. |
| F7 | **Combo visible sur la balle** : dès 8, le nombre suit la balle. | Maîtrise lisible | Rendu. |

## Lot 2 — ce qui fait revenir demain
| # | Mécanisme | Levier | Comment |
|---|---|---|---|
| F8 | **Quotidien muté** : 2 mutateurs tirés par la date (« tout brûle », « blocs blindés », « descente rapide », « riche mais fragile », « balles rapides ») + **série** : chaque jour consécutif +10 % de fragments (max ×2). | Nouveauté, rendez-vous | Sim : mods ; systèmes : `dailyMods`, série ; UI : calendrier. |
| F9 | **Coffre de boss** : après un boss, trois cartes face cachée, on en retourne une : épique garantie. | Anticipation | Sim : `reward:offered` avec `source: 'boss'` ; UI : cartes à retourner. |
| F10 | **Défis de déblocage** : « Débloque le Fantôme : tue un boss avec uniquement des pierres » en plus des fragments. | Intention, maîtrise | Méta + UI (lot ultérieur). |

## Mesure
Le QA mesure avant/après : décisions par tir (cible ≥ 2), % de tirs à combo ≥ 5 (cible ≥ 30 % pour un bot naïf qui suit les contrats), contrats réussis par run, runs reprises par seconde chance, durée de run 1 (cible ≥ 4 min), part des runs qui finissent par un partage simulé. Moments morts toujours 0.

## Hors scope
Classement en ligne, comptes, pubs, achats. Pas de secousses ni de ralenti (décision produit).

## Résultats (docs/qa/fun-final.md, passe finale)

| Métrique | Avant | Après (bot naïf / bon usage du sélecteur) |
|---|---|---|
| Décisions par tir | 1 | 2 (direction + ouverture, 0 % involontaire) |
| Tirs à combo ≥ 5 | 10 % | 27 % / 58 % |
| Contrats réussis par run | — | 42 % / 62 % (6,6 réussis par run) |
| Durée de la run 1 | 2,6 min | 4,6 min / 9,2 min |
| Vague atteinte (run 1, avec revanche) | 5,2 | 8 / 12 |
| Seconde chance | — | prise 5/5, +1,4 à +4,8 vagues |
| Première récompense | 2,2 s | 2,2 s |
| Moments morts | 0 | 0 |

Verdict par mécanisme : F1 éventail (sélecteur explicite 3 positions, pénalité de dégâts 0,20) **multiplie le fun** ; F2 contrats **multiplie** ; F3 dorée (progressive, 23-25 % des dégâts) **neutre+** ; F4 seconde chance **multiplie** ; F5 record, F6 partage et défi, F8 quotidien muté avec série, F9 coffre : **fonctionnent et sont testés**, effet non mesurable par bot.

Décisions prises en route : l'ouverture par longueur du geste a été abandonnée (61-93 % d'ouvertures involontaires) au profit d'un sélecteur ; Brasier et Vélocité rapportent ×1 fragment car ils facilitent la run.

Pistes suivantes : garantir une épique au coffre même pour un débutant (F9-02) ; adoucir le mur de la vague 6 ; contrat dorée à 14 % de réussite ; progression méta encore en paliers ; F10 défis de déblocage ; mesurer le taux de partage avec de vrais joueurs.
