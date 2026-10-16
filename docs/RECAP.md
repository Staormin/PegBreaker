# Pegbreaker — récapitulatif final (2026-10-16)

## Choix de design
- **Genre** : roguelite de tir à rebonds tour par tour (Ballz × Peglin × Ball x Pit), choisi pour son hook immédiat (premier bloc cassé à 2-4 s), son entrée unique (glisser-relâcher) et son faible coût en entités (60 fps faciles).
- **Fusion en carte de récompense** : la fusion automatique compressait la volée (4 pierres → 1 balle) et tuait la montée en nombre de balles ; elle est devenue un choix, automatique seulement au plafond de 30 balles.
- **Nombres entiers et gros** : dégâts base 10, PV entiers, nombres qui « popent » ; plafond doux du combo à 30 pour empêcher la boule de neige (runs bimodales, run infinie avec la glace).
- **Courbe par paliers** (`hpByWave`) avec un mur en vague 4 : mort moyenne 4,7 sans méta (écart-type 0,9), ~10 avec la méta complète ; la Carapace se sent grâce au plafond de brèche à 1 PV par avancée.
- **Méta légère** : le Puits (3 branches, 16 nœuds, ~30 runs), 4 reliques épiques verrouillées, 14 succès, défi quotidien par seed de date, tout en localStorage.
- **Architecture** : sim pure et déterministe (testée en Node à 1 000 tirs/s), événements typés consommés par rendu/audio/UI, un propriétaire par dossier, config JSON validée.

## Métriques (docs/qa/final.md)
Première récompense 3,8 s (joueur simulé), premier choix 22 s, 17-18 décisions/min, 0 moment mort, run 1 ≈ 3 min, 60 fps à CPU 4× (mobile DPR 2 et desktop 720×1280), bundle 55 ko gzip, 0 erreur console sur 30 tests Playwright.

## Pistes d'amélioration
1. Run 1 un peu courte (3 min pour 4 visées) et mur de la vague 4 trop uniforme (6 runs sur 10 y meurent) : adoucir `hpByWave` v4 et ajouter une rangée de départ.
2. Combos rares pour un joueur naïf (10 % des tirs ≥ 5) : plus de chevilles tôt, ou une relique commune « rebonds de mur comptent » offerte dès la vague 1.
3. Progression méta par paliers : rendre les Munitions plus sensibles (balle de départ de rang 2) et lisser les coûts.
4. Boss plus lisibles : événement `block:spawned` pour la Ruche, retour visuel de la régénération.
5. Perf : la bascule de qualité préventive n'a jamais été observée ; la mesurer sur GPU réel et sur un vrai téléphone, et envisager un mode « réduit » manuel.
