# QA final — Jalons 4 et 5, Definition of Done

Build mesuré : commit `7a33cab`, sur la base `09c6788` (« QA final en cours » : seulement le suivi des tâches). L'arbre `src/` était propre et la version affichée est `0.4.0-j4`. Bundle : 155,7 ko brut, **54,9 ko gzip**.

Pour rejouer : `npm run build && npm run test:e2e`. Dernier passage : **30 tests sur 30 verts en 2 min 24** (budget : 8 min), dont 3 échecs attendus (`test.fail`) qui documentent les bugs J4-01 et J4-02. Tests unitaires : **101 sur 101** (`npm test`).

Données brutes :

| Fichier | Contenu |
|---|---|
| [`final-metrics.json`](final-metrics.json) | 10 runs sans méta, chargement, perf 30 balles |
| [`final-progression.json`](final-progression.json) | progression run 1 → 5 avec méta |
| [`final-onboarding.json`](final-onboarding.json) | premier lancement |
| [`final-hints.json`](final-hints.json) | indices one-shot |
| [`final-offline.json`](final-offline.json) | hors ligne |
| `final-mobile-*.json` | mise en page mobile |
| [`j2-feel.json`](j2-feel.json), [`j2-audio.json`](j2-audio.json), [`j2-reduce-motion.json`](j2-reduce-motion.json) | feel et audio, réécrits par la suite à chaque passage |

## 1. Definition of Done

| # | Critère | Statut | Preuve |
|---|---|---|---|
| 1 | Build statique jouable | ✅ | `npm run build` produit `dist/` (54,9 ko gzip), servi par `vite preview`. Premier tir possible **104 ms** après la navigation (`domContentLoaded` à 59 ms). |
| 2 | Jouable hors ligne | ✅ | `offline.spec.ts` sur `http://127.0.0.1:4174` : le SW `pegbreaker-v2` contrôle la page avec 7 entrées en cache. Après `setOffline(true)` (`navigator.onLine` = false) puis rechargement, le jeu est en phase **`aiming`** avec **0 erreur**. |
| 3 | Tous les tests sans erreur console | ✅ | 30 tests e2e et 101 tests unitaires. Chaque spec collecte `console.error`, `pageerror` et `__pegbreaker.errors` : **0** partout. Couvert : 13 runs complètes sans méta, 5 runs avec méta, persistance, feel, audio, hors ligne, mobile. |
| 4 | 60 fps sur CPU 4× | ⚠️ partiel | Voir le tableau ci-dessous : OK sur le cas mobile et sur une partie normale, pas sur un grand écran desktop en DPR ≥ 1,5 avec 30 balles. |
| 5 | README explique comment jouer et lancer | ✅ | `README.md` : sections « Comment jouer » (gestes, règles, éléments, fusion, Puits, défi du jour) et « Lancer le projet » (`npm install`, `dev`, `build`, `preview`, `test`, `test:e2e`, service statique de `dist/`), plus « Jouer hors ligne / installer ». |

Détail de la ligne 4, volée de 30 balles (7 éléments), fps pendant la volée sous CPU 4× :

| Cas | fps min / moy. | Frame max | Statut |
|---|---|---|---|
| Partie normale (qa-1, volée de 5-6 balles), vitesse 1 | **60 / 60** | | OK |
| Partie normale, volée sous CPU 4× | **60 / 60** | | OK |
| **Téléphone 375×812, DPR 2** (rendu plafonné à 1,5) | **60 / 60** | | OK |
| Desktop 720×1280, DPR 1 | 54–58 / 58,5–59,5 | | à la limite |
| Desktop 720×1280, DPR 1,5 | **48 / 56,8** | | KO |
| Desktop 720×1280, DPR 2 | **34–36 / 51–52** | 61–92 ms | KO ; la qualité adaptative bascule bien en 1,5 pendant la volée (en 12–14 ms), mais trop tard |

Mesures en Chromium headless, rendu logiciel : c'est pessimiste pour un vrai GPU.

## 2. Verdict par jalon

| Jalon | Verdict | Preuve principale |
|---|---|---|
| **J1** vertical slice | **OK** | Smoke desktop et mobile (souris, tactile, récompense, boutique, game over, « Rejouer ») et 3 runs d'invariants : 0 violation, 0 softlock, volée max 6,9 s (plafond 7 s). |
| **J2** feel / audio | **OK** | Chaque événement de la table game-feel produit son effet. reduceMotion : **0 frame figée** (J2-01 corrigé) et moitié moins de particules (15,4 → 6,4 par bloc). Audio : pic **0,872** (< 0,99), 0 clip. Avec SFX et musique à 0, aucun nœud créé. |
| **J3** méta / sauvegarde | **OK** | Reprise identique au bloc près. Sauvegarde corrompue mise de côté sans erreur. Achat au Puits : `maxHp` 5 → 6. Réglages persistés. Succès en run 1 : **4** (progression) et **5** (`persist-b`), contre 12 au passage précédent. |
| **J4** finition (onboarding, PWA, mobile, toasts) | **OK avec réserves** | Onboarding sans texte : 1re récompense à **3,8 s** pour un humain simulé ; indices montrés une seule fois. Hors ligne OK. Mobile sans scroll ni chevauchement au repos, DPR plafonné à 1,5. Toasts groupés : 2 toasts au lieu de 5 succès. Réserves : J4-01 (bouton ◆ de 38×26 px) et J4-02 (⚙ sur le plateau pendant la volée en 360×640). |
| **J5** Definition of Done | **à corriger (1 point)** | 4 lignes sur 5 remplies. La ligne « 60 fps CPU 4× » n'est pas tenue sur desktop en DPR ≥ 1,5 avec 30 balles (J5-01). |

## 3. Métriques de fun

### Récapitulatif

| Métrique | Cible | Mesuré | Statut |
|---|---|---|---|
| Première récompense, humain simulé (2 s de lecture + drag de 600 ms, profil vierge) | < 10 s | **3,8 s** (1 tir) | OK |
| Première récompense, bot naïf (1,5 s de visée) | < 10 s | 2,2 s | OK |
| Premier écran de choix | ~25 s | 21,8 s réelles (qa-1) ; 17,2 à 23,9 s en temps joueur | OK |
| Décisions/min (temps joueur) | ≥ 8 | 18,4 (naïf), 17,4 (greedy) | OK |
| Durée d'une run 1 (sans méta) | ~4 min | **2,8 min** (naïf), **3,1 min** (greedy) | trop court |
| Vague de mort sans méta | 3 à 4 | 5,2 ± 0,98 (naïf), 5,4 ± 2,8 (greedy) | OK, mais voir le mur de la vague 4 ci-dessous |
| Moments morts (> 5 s sans feedback) | 0 | **0** sur 10 runs (plus long trou : 1,8 s) | OK |
| Volées coupées à 7 s | — | 0 | OK |
| Tirs par vague | 5 à 8 | 8,2 (naïf), 7,7 (greedy) | à la limite |
| Tirs à combo ≥ 5 | — | **10 %** (naïf), 20 % (greedy) | faible |
| Profondeur run 1 → 5 avec méta | croissante | **39 → 40 → 43 → 94 → 95** | monte, mais par palier |
| Dégâts max run 1 → 5 | croissants | 2 707 → 2 707 → **597** → 8 168 → 8 168 | non monotone |
| Volée finale run 1 → 5 | croissante | 17 → 17 → **16** → 29 → 29 | non monotone |
| Succès débloqués en run 1 | 1 à 4 | **4** (combo15, fusion2, wave5, perfectwave) | OK |

### Courbe de difficulté sans méta

Profil vierge, seeds `qa-1` à `qa-5`.

| Vague | Runs encore en vie (naïf / greedy) | Dégâts max moyens par tir (naïf / greedy) |
|---|---|---|
| 1 | 5 / 5 | 110 / 126 |
| 2 | 5 / 5 | 273 / 268 |
| 3 | 5 / 5 | 390 / 674 |
| 4 | 5 / 5 | 1 482 / 1 196 |
| 5 (boss) | **3 / 1** | 158 / 170 |
| 6 | 3 / 1 | 594 / 2 267 |
| 7 à 11 | 0 / 1 (greedy qa-2, jusqu'à la vague 11, 7,4 min) | — / 1 389 à 7 324 |

**6 runs sur 10 meurent exactement en vague 4.** La vague 5 (boss) fait chuter les dégâts par tir d'environ 90 % : 1 482 → 158.

### Runs sans méta

| Bot / seed | 1er choix | Tirs | Déc./min | Durée | Vague de mort | Meilleur combo | Dégâts max/tir | Volée finale | Moments morts | Blocs cassés au tir 1 | Boss apparus/tués | Erreurs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| naïf qa-1 | 21,5 s | 35 | 20,4 | 2,2 min | 4 | 10 | 523 | 6 | 0 | 2 | 0/0 | 0 |
| naïf qa-2 | 20,2 s | 51 | 18,1 | 3,3 min | 6 | 25 | 1 930 | 17 | 0 | 2 | 1/1 | 0 |
| naïf qa-3 | 26,9 s | 53 | 18,0 | 3,5 min | 6 | 16 | 2 243 | 15 | 0 | 2 | 1/1 | 0 |
| naïf qa-4 | 15,5 s | 26 | 17,7 | 1,8 min | 4 | 15 | 772 | 12 | 0 | 1 | 0/0 | 0 |
| naïf qa-5 | 35,2 s | 51 | 17,8 | 3,4 min | 6 | 34 | 1 943 | 12 | 0 | 1 | 1/1 | 0 |
| greedy qa-1 | 20,1 s | 34 | 18,0 | 2,2 min | 4 | 16 | 525 | 12 | 0 | 2 | 0/0 | 0 |
| greedy qa-2 | 15,4 s | 93 | 14,7 | 7,4 min | 11 | 54 | 7 324 | 29 | 0 | 2 | 2/2 | 0 |
| greedy qa-3 | 17,1 s | 27 | 19,4 | 1,7 min | 4 | 15 | 848 | 13 | 0 | 1 | 0/0 | 0 |
| greedy qa-4 | 18,4 s | 31 | 17,2 | 2,1 min | 4 | 16 | 2 051 | 11 | 0 | 2 | 0/0 | 0 |
| greedy qa-5 | 14,8 s | 28 | 17,7 | 1,8 min | 4 | 15 | 916 | 11 | 0 | 2 | 0/0 | 0 |

### Progression avec méta

Même seed `prog` pour les 5 runs. Bot greedy ; après chaque run, il achète le nœud le moins cher tant qu'il peut.

| Run | maxHp / balles au départ | Profondeur | Vague | Dégâts max | Combo | Volée finale | Durée sim. | Boss tués | Fragments | Achats | Nouveaux succès |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 5 / 5 | 39 | 6 | 2 707 | 18 | 17 | 1,7 min | 1 | 78 | hp, coins | 4 |
| 2 | 6 / 5 | 40 | 6 | 2 707 | 18 | 17 | 1,7 min | 1 | 71 | balls | 0 |
| 3 | 6 / 6 | 43 | 6 | 597 | 7 | 16 | 1,8 min | 1 | 76 | el_split | 0 |
| 4 | 6 / 6 (+ scission) | **94** | 11 | 8 168 | 39 | 29 | 5,8 min | 2 | 358 | hp, coins, mod_glass, rel_alchimie | **7** |
| 5 | 7 / 6 | 95 | 11 | 8 168 | 39 | 29 | 5,8 min | 2 | 181 | reroll | 0 |

### Feel, audio, onboarding (passage final)

- **Indices one-shot** : récompense, combo et fusion montrés **une fois chacun**, sur 6 offres, 127 paliers et 2 offres de fusion. Ils sont mémorisés dans `pegbreaker.hints`.
- **Onboarding** : le logo `.intro-logo.on` et le geste fantôme `.ghost.on` sont visibles au premier lancement, sans aucun écran à fermer. Un drag tire. `onboarded` passe à true et le fantôme disparaît après le premier tir.
- **Audio, 20 tirs** : 9 178 nœuds créés, 2 143 voix admises et 555 refusées par le limiteur, pic **0,872**.

## 4. Bugs restants

| ID | Gravité | Seed / test | Étapes | Attendu | Observé | Fichier suspect |
|---|---|---|---|---|---|---|
| J5-01 | **majeur** | `qa-perf`, `metrics.spec.ts` « 720×1280 DPR 1,5 / 2 » | Desktop 720×1280, DPR 2, volée de 30 balles (7 éléments), CPU 4×. | ≥ 55 fps | DPR 2 : min **34–36**, moyenne 51–52, frames de **61 à 92 ms** au moment de la bascule de qualité 2 → 1,5. DPR 1,5 : min 48. (Le téléphone 375×812 est à 60.) | `src/render/index.ts` (qualité adaptative : seuil `SLOW_TRIGGER`, coût de `doResize` en pleine volée) |
| J4-01 | mineur (accessibilité) | `mobile.spec.ts` « BUG J4-01 connu » (375×812 et 360×640) | Mesurer le bouton ◆ du HUD. | Cible tactile ≥ 48 px | `.hud-frags` : **38×26 px** | `src/ui/styles.css` (`.hud-frags`) |
| J4-02 | mineur | `mobile.spec.ts` « BUG J4-02 connu » (360×640) | Tirer au doigt, puis mesurer pendant la volée. | HUD hors du plateau | `⚙` reste affiché au-dessus du bouton Rappel et recouvre le bas-droit du plateau (**2 704 px²**, y 504–556 sur un plateau qui s'arrête à 563) ; capture `05-mobile-360x640-volee.png` | `src/ui/hud.ts` (`gear` et `recall` en phase `firing`) |
| J5-02 | mineur (équilibrage) | `qa-1` à `qa-5` sans méta | — | Mort en vague 3-4 vers 4 min | **Mur en vague 4** : 6 morts sur 10, et les runs ne durent que 2,8 à 3,1 min | `src/config/waves.json` (`hpByWave`, vague 4 : 200) |
| J5-03 | mineur (équilibrage) | `prog` | — | Progression régulière | Plateau sur les runs 1 à 3 (profondeur 39 / 40 / 43), saut à 94 en run 4. Les dégâts max et la volée **baissent** en run 3 (2 707 → 597, 17 → 16) après l'achat de +1 balle de départ. 7 succès débloqués d'un coup en run 4. | `src/config/meta.json` |
| J5-04 | mineur (fun) | 10 runs | — | Combos fréquents | 10 % des tirs atteignent un combo ≥ 5 (naïf) ; 20 % en greedy | `src/config/blocks.json` (chevilles) |

Corrigés depuis le passage précédent, vérifiés par un test vert :
- **J2-01** : 0 frame figée en reduceMotion.
- **J2-03** : pool de particules à 1024, pic à 266 particules et 0 saturation dans le test feel.
- **J3-01** : 4 succès en run 1 au lieu de 12, toasts groupés.
- **J3-03** : version `0.4.0-j4`.
- **J1-04** : aucune volée coupée.

## 5. Cinq pistes concrètes pour la suite

1. **Perf desktop HiDPI (J5-01)** : basculer la qualité *avant* la volée, en phase `aiming`, quand la volée compte au moins 20 balles et que le canvas dépasse 1,5 Mpx. Plafonner le DPR à 1,5 au-dessus de 600 px CSS, comme sur mobile. But : min ≥ 55 fps en 720×1280 DPR 2 et plus aucune frame au-dessus de 33 ms.
2. **Adoucir le mur de la vague 4** : `waves.json → hpByWave` vague 4, `baseHp` de 200 à **170**. But : au moins 6 runs sur 10 en vie en vague 5 et une run 1 d'environ 4 min, contre 2,8 aujourd'hui.
3. **Plus de combos** : `blocks.json → defs[peg].weightByWave` de 18 / 22 à **26 / 30** (chevilles plus fréquentes). But : au moins 20 % de tirs à combo ≥ 5 pour un débutant, contre 10 %.
4. **Lisser la progression méta** : `meta.json → nodes[balls].costs` de `[50, 110]` à **`[40, 120]`**, et `meta.json → nodes[el_split].costs` de `[50]` à **`[70]`**. But : chaque run apporte un gain visible ; pas de baisse en run 3, pas de saut ×2 en run 4.
5. **UX mobile (J4-01, J4-02)** : zone tactile de 48×48 px minimum pour `.hud-frags` (padding ou pseudo-élément), et masquer `⚙` pendant `firing` quand la hauteur fait moins de 700 px. Retirer alors les deux `test.fail` de `mobile.spec.ts`.

## 6. Captures (`docs/qa/final-shots/`)

| Fichier | Contenu |
|---|---|
| `01-premier-lancement.png` | logo + geste fantôme, profil vierge |
| `02-mobile-375x812.png` et `04-mobile-375x812-volee.png` | mobile 375×812, au repos et pendant la volée |
| `03-mobile-360x640.png` et `05-mobile-360x640-volee.png` | mobile 360×640 ; la seconde montre J4-02 |
| `06-volee-30-balles-7-elements-dpr2.png` | volée de 30 balles, 7 éléments, DPR 2 |
| `08-hors-ligne.png` | jeu rechargé sans réseau |
| `suite/` | parcours smoke, récompense, boutique, fin de run, Puits desktop et mobile, fusion, feel |

## 7. Harnais (ajouts de ce passage)

- **`onboarding.spec.ts`** : premier lancement avec un joueur humain simulé, et indices one-shot comptés par un `MutationObserver`.
- **`offline.spec.ts`** : un second `vite preview` sur 127.0.0.1:4174 (le SW ne s'enregistre pas sur localhost), puis `setOffline` et rechargement.
- **`mobile.spec.ts`** : 375×812 et 360×640, DPR 2, tactile. Vérifie les chevauchements HUD/plateau (`boundingBox` comparé à `renderer.boardToScreen`), le scroll, les boutons ≥ 48 px et le DPR. Contient deux `test.fail` pour les bugs connus J4-01 et J4-02.
- **`metrics.spec.ts`** :
  - écart-type de la vague de mort ;
  - survie et dégâts par vague ;
  - perf à DPR 1 / 1,5 / 2 en 720×1280 et sur téléphone 375×812 ;
  - sortie dans `final-metrics.json`.
- **`progression.spec.ts`** : succès nouveaux par run ; sortie dans `final-progression.json`.
- **`feel.spec.ts`** : `test.fail` retiré ; J2-01 devient un test de non-régression.

## 8. Retrait du mode mouvement (2026-10-16)

Décision produit : l'ancien mode « mouvements réduits » devient le seul comportement du jeu. Les secousses, le hit-stop, le ralenti, les flashs plein écran, les lignes de vitesse, les animations « pop » et « shake » du HUD et les deux options de réglages disparaissent. `Settings` ne contient plus que `{sfx, music}`.

**Résultat de la suite :** `npm run build`, puis `npx playwright test -c tests/e2e/playwright.qa.config.ts` → **29 tests sur 29 verts en 2 min 09**. Aucune erreur console, aucun softlock, aucun moment mort sur les 10 runs, et 0 violation d'invariant.

Pourquoi une config dédiée : un `vite preview` étranger, lancé à 16:27 depuis l'ancien emplacement du projet, occupe encore le port 4173 et sert l'ancien bundle (`index-jU5Bng04.js` au lieu de `index-CHCa7HbA.js`). Avec `reuseExistingServer`, `npm run test:e2e` testerait ce vieux build. La config `tests/e2e/playwright.qa.config.ts` reprend la config racine mais sert `dist/` sur le port 4177.

**Non-régression « sim jamais figée »** (`feel.spec.ts`, seed `feel-3`, volée de 29 balles) :
- 1 487 frames de volée observées, **0 frame** où `stats.durationMs` stagne pendant `firing` (onglet visible, écran de jeu) ;
- 31 anciens déclencheurs de hit-stop présents (explosions, paliers 2+, dégâts) ; au palier 3, la sim tourne à ≥ 0,71× de sa vitesse : il n'y a plus de ralenti ;
- particules : pic à **191**, pour un plafond de 1 024.

**Tests adaptés :**
- éclats par bloc détruit : seuil abaissé à ≥ 5 (densité de base 0,45, environ 7 mesurés) ;
- fusion : on vérifie que le renderer émet des particules, la pulsation HUD n'existant plus ;
- `drop:collected` : on vérifie les particules et non plus le « pop » du HUD ;
- réglages : ne testent plus que les volumes ; ils vérifient aussi l'absence des interrupteurs `shake` et `reduceMotion`, et l'absence de musique et de voix SFX avec les volumes à 0.

**fps à CPU 4×, volée de 30 balles (7 éléments), après le retrait :**

| Cas | `renderer.dpr` | fps min / moy. | Frame max |
|---|---|---|---|
| Desktop 720×1280, `deviceScaleFactor` 1,5 | **1,25** | 56 / 58,8 | 37 ms |
| Desktop 720×1280, `deviceScaleFactor` 2 | **1,25** (plafond par surface de pixels) | 53 / 58,3 | 38 ms |
| Desktop 720×1280, DPR 1 | 1 | 60 / 60 | 34 ms |
| **Mobile 375×812, DPR 2** | **1,5** | **60 / 60** | 35 ms |
| Partie normale (qa-1), vitesse 1 et CPU 4× | 1 | 60 / 60 | 29 ms |

J5-01 est très amélioré : en DPR 2 desktop, le minimum passe de 34–36 à **53**, et les frames de bascule de qualité (61–92 ms) disparaissent. Le minimum de 53 reste juste sous les 55 visés, sur une seule mesure en rendu logiciel. Les bugs J4-01 et J4-02 sont signalés corrigés par les tests mobiles, que leur propriétaire a mis à jour.
