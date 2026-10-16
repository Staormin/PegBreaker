# Pegbreaker

Un roguelite de tir à rebonds, au tour par tour, 100 % navigateur, qui se joue d'un doigt.
Tu es au fond d'un puits : vise, lâche une volée de balles qui ricochent et brisent les blocs qui descendent vers toi.
Enchaîne les combos, fusionne tes balles, choisis tes améliorations… et descends le plus loin possible.

## Comment jouer

**Gestes**

- **Glisser** n'importe où sur l'écran : la balle part vers le point visé (ligne de visée et premier rebond affichés).
- **Relâcher** pour tirer. Un simple tap ne tire pas.
- **⏩** pendant une volée : rappel accéléré des balles.
- Au clavier : **← / →** pour orienter la visée (Maj pour un réglage fin), **Espace** pour tirer, puis pour rappeler.
- **⚙** : pause et réglages. **◆** : le Puits (entre deux tirs).

**Règles**

- Chaque bloc affiche ses PV ; chaque touche lui retire les dégâts de la balle. À 0, il éclate et peut lâcher pièces, balles ou fragments.
- Après chaque tir, tous les blocs descendent d'une rangée et une nouvelle rangée apparaît.
- Un bloc qui franchit ta ligne te fait perdre des PV ; à 0 PV, la descente est terminée.
- Chaque rebond sans toucher le sol augmente le combo de la balle, et donc ses dégâts. Les paliers 5, 10 et 20 déclenchent un effet.
- Vague nettoyée : choisis 1 carte parmi 3 (balle, relique, fusion…) ou prends des pièces. Une boutique apparaît régulièrement, et un boss toutes les quelques vagues.
- La volée part du dernier point d'impact au sol de la volée précédente.

**Éléments**

| Balle | Effet |
|---|---|
| Pierre | Une balle honnête. |
| Feu | Explose au premier impact. |
| Foudre | Chaque impact frappe aussi le bloc le plus proche. |
| Glace | Gèle le bloc touché : il ne descend pas. |
| Fantôme | Traverse les blocs, rebondit sur les murs. |
| Plomb | Dégâts ×3, pas de combo. |
| Scission | Se divise en deux au premier impact. |

**Fusion** : deux balles identiques (même élément, même rang) fusionnent en une balle de rang supérieur (II, puis III), bien plus puissante. Moins de balles, mais des coups plus lourds : à toi de trouver l'équilibre.

**Le Puits** : les fragments (◆) gagnés pendant les descentes sont conservés. Dépense-les dans trois branches : *Arsenal* (nouveaux éléments), *Fondations* (PV, balles de départ, pièces, reroll gratuit) et *Profondeur* (modificateurs de run plus durs qui rapportent plus de fragments). Les achats s'appliquent à la descente suivante. Des succès rapportent aussi des fragments.

**Défi quotidien** : une seed par jour, identique pour tout le monde. Ton meilleur résultat du jour et l'historique des 30 derniers jours sont gardés localement (aucun serveur).

La sauvegarde (méta, succès, run en cours, réglages) est stockée dans le `localStorage` du navigateur.

## Lancer le projet

```bash
npm install          # dépendances de développement (Vite, TypeScript, Vitest, Playwright)
npm run dev          # serveur de développement : http://localhost:5173
npm run build        # vérification des types + build statique dans dist/
npm run preview      # sert dist/ sur http://localhost:4173
npm test             # tests unitaires (Vitest)
npm run test:e2e     # tests de bout en bout (Playwright, sur le build servi par preview)
```

Le dossier `dist/` est entièrement statique et jouable hors ligne : sers-le avec n'importe quel serveur statique (par exemple `npx vite preview`, ou `python3 -m http.server` dans `dist/`) puis ouvre `index.html`. L'ouverture directe en `file://` n'est pas prise en charge par les navigateurs pour les modules JavaScript.

## Assets et licence

Tout est généré par le code : formes, sprites et effets sont dessinés sur un canvas, l'icône est un SVG écrit à la main, et les sons sont synthétisés avec la Web Audio API. Le projet n'utilise **aucun asset tiers** (ni image, ni police, ni son externe).

## Crédits

Conçu et développé avec [Claude Code](https://claude.com/claude-code) par une équipe d'agents Opus (architecte, gameplay, rendu, audio, systèmes, UI, QA).
