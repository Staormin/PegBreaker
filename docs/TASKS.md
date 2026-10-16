# TASKS — suivi des tâches

Statuts : `todo` · `doing` · `review` · `done` · `blocked`

## Jalon 1 — Vertical slice de la core loop (formes simples, sans méta, fun en 2 min) — VALIDÉ (docs/qa/j1.md, commit 8a20d70)

| ID | Agent | Statut | Dépend de | Critère d'acceptation |
|---|---|---|---|---|
| T1 | architecte | done | — | Squelette Vite+TS, `core/` (types, events, rng, math, config), `npm run build` passe, docs/DESIGN.md et ARCHITECTURE.md écrits. |
| T2 | gameplay-dev | done | T1 | `createSim` complet : physique sans tunneling, volée en rafale, rebonds, combo, blocs (normal, peg, explosive, heart), drops, avancée des rangées, PV, vagues depuis waves.json, offres de récompense (balles stone/fire/lightning/split + 6 reliques), fusion, boutique, game over, restart. Tests Vitest : 1 000 tirs aléatoires sans NaN ni balle hors plateau, déterminisme par seed. |
| T3 | feel-artist | done | T1 | Renderer canvas : plateau, blocs avec PV lisibles, balles, drops, ligne de visée avec premier rebond, nombres de dégâts flottants, particules simples à la casse d'un bloc. 60 fps avec 30 balles. Formes simples, palette imposée. |
| T4 | ui-dev | done | T1 | Drag-to-aim souris et tactile, bouton rappel, HUD (PV, vague, pièces, volée), overlay récompense (3 cartes), écran fin de run avec « Rejouer ». Portrait responsive 360 px → 1440 px. |
| T5 | architecte | done | T2,T3,T4 | `main.ts` intègre tout, `window.__pegbreaker` exposé, build OK, zéro erreur console. |
| T6 | qa-tester | done | T5 | Bot Playwright qui joue 5 runs : rapport docs/qa/j1.md avec temps avant première récompense, décisions/min, durée de run, moments morts > 5 s, progression run1→run5, erreurs console. |

## Jalon 2 — Juice et feedback

| ID | Agent | Statut | Dépend de | Critère d'acceptation |
|---|---|---|---|---|
| T7 | feel-artist | doing | T6 | Screen shake, hit-stop sur palier de combo, flash, squash des blocs, trails des balles, animation de fusion, sprites procéduraux par élément, fond animé. Réglage reduceMotion respecté. |
| T8 | audio-dev | doing | T6 | SFX synthétisés pour chaque événement (rebond avec pitch lié au combo, casse, drop, fusion, dégâts, choix), musique générative discrète, mixage, déverrouillage mobile. |
| T9 | qa-tester | todo | T7,T8 | Rapport j2 : aucun moment mort > 5 s, 60 fps maintenu, zéro erreur console. |

## Jalon 3 — Méta-progression, sauvegarde, économie

| ID | Agent | Statut | Dépend de | Critère d'acceptation |
|---|---|---|---|---|
| T10 | systems-dev | done | T6 | Sauvegarde localStorage versionnée, reprise de run, le Puits (3 branches), succès, défi quotidien, `MetaModifiers` consommés par la sim. Tests Vitest sur migration et modificateurs. |
| T11 | ui-dev | done | T10 | Écrans Puits, succès, quotidien, réglages ; boutique in-run. |
| T12 | qa-tester | todo | T10,T11 | Rapport j3 : persistance après reload, aucune régression. |

## Jalon 4 — Contenu, équilibrage, onboarding, polish

| ID | Agent | Statut | Dépend de | Critère d'acceptation |
|---|---|---|---|---|
| T13 | gameplay-dev | todo | T12 | 7 éléments, 20 reliques, blocs blindés, 3 boss, équilibrage via waves.json selon rapport QA. |
| T14 | ui-dev | todo | T12 | Onboarding sans texte (flèche animée, premier tir guidé), écran titre, polish des transitions. |
| T15 | qa-tester | todo | T13,T14 | Rapport j4 : première récompense < 10 s, courbe de difficulté mesurée sur 10 runs. |

## Jalon 5 — Build de prod, perf, mobile

| ID | Agent | Statut | Dépend de | Critère d'acceptation |
|---|---|---|---|---|
| T16 | feel-artist | todo | T15 | Profilage, aucune allocation dans la boucle, 60 fps sur CPU 4× ralenti (Playwright). |
| T17 | ui-dev | todo | T15 | Viewport mobile 375×812 et 1440×900, manifest PWA, hors ligne, README. |
| T18 | qa-tester | todo | T16,T17 | Rapport final : tous les tests passent, zéro erreur console, perf. |
