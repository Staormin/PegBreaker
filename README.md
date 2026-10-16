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
- Chaque rebond sans toucher le sol augmente le combo de la balle, et donc ses dégâts. Les paliers 3, 8 et 16 déclenchent un effet.
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

Le dossier `dist/` est entièrement statique : sers-le avec n'importe quel serveur statique (par exemple `npx vite preview`, ou `python3 -m http.server` dans `dist/`) puis ouvre `index.html`. Les navigateurs ne prennent pas en charge l'ouverture directe en `file://` pour les modules JavaScript.

## Publier sur GitHub Pages

Le build est entièrement relatif (`base: './'`, service worker et manifeste sur `./`) : il fonctionne tel quel sous `https://<utilisateur>.github.io/<dépôt>/`.

1. Crée un dépôt GitHub et pousse la branche `main` :

```bash
git remote add origin git@github.com:<utilisateur>/pegbreaker.git
git push -u origin main
```

2. Dans le dépôt : **Settings → Pages → Build and deployment → Source : GitHub Actions** (une seule fois).
3. Chaque `push` sur `main` lance [`.github/workflows/pages.yml`](.github/workflows/pages.yml) : tests unitaires, build, publication. L'URL s'affiche dans l'onglet Actions (environnement `github-pages`).

Déploiement manuel sans Actions : `npm run build` puis publie le contenu de `dist/` sur la branche `gh-pages` (par exemple avec `npx gh-pages -d dist`).

La suite Playwright complète tourne à la demande ou chaque lundi via [`.github/workflows/e2e.yml`](.github/workflows/e2e.yml).

## Jouer hors ligne / installer

Pegbreaker est une PWA : un service worker (`public/sw.js`) met le jeu en cache dès la première visite. Ensuite, il se recharge et se joue **sans réseau**.

- **Installer** : depuis le navigateur, « Ajouter à l'écran d'accueil » (Android, iOS) ou l'icône d'installation de la barre d'adresse (Chrome, Edge). Le jeu s'ouvre alors en plein écran, en portrait.
- **Mises à jour** : la page est toujours redemandée au réseau quand il est disponible ; le cache ne sert qu'en secours.
- Le service worker n'est actif que sur le build de production servi ailleurs que sur `localhost`, pour ne gêner ni le développement ni les tests. Pour l'essayer en local, ouvre `npx vite preview` via `http://127.0.0.1:4173`.

## Tests

- **Unitaires** (Vitest, `npm test`) : 97 tests sur la simulation (déterminisme, robustesse sur des milliers de tirs, une mécanique par test), l'économie et la sauvegarde.
- **Bout en bout** (Playwright, `npm run test:e2e`) : un bot joue de vraies parties sur le build, à la souris et au tactile. La suite comprend un smoke test, des invariants, des métriques de rythme et des tests de persistance.
- **Rapports QA** : dans [`docs/qa/`](docs/qa/), avec les métriques et les captures de chaque jalon.

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md) : design du jeu (boucles, récompenses, difficulté, méta).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) : architecture technique, modules, événements, format de sauvegarde.

## Assets et licence

Tout est généré par le code : formes, sprites et effets sont dessinés sur un canvas, l'icône est un SVG écrit à la main, et les sons sont synthétisés avec la Web Audio API. Le projet n'utilise **aucun asset tiers** (ni image, ni police, ni son externe).

## Crédits

Conçu et développé avec [Claude Code](https://claude.com/claude-code) par une équipe d'agents Opus (architecte, gameplay, rendu, audio, systèmes, UI, QA).
