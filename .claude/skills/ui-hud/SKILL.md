---
name: ui-hud
description: UI et HUD de Pegbreaker — DOM superposé au canvas, input drag-to-aim souris/tactile, lisibilité mobile, écrans (récompense, boutique, fin, Puits), responsive portrait, accessibilité minimale.
---

# UI / HUD — Pegbreaker

## Structure
- `#app` : conteneur plein écran, fond `bg0`. Le canvas `#game` occupe un rectangle portrait centré (ratio du plateau 7:10 + marge HUD), calculé par `render` ; `#ui` est un overlay `position:absolute; inset:0; pointer-events:none`, et seuls les éléments interactifs remettent `pointer-events:auto`.
- CSS dans `src/ui/styles.css`, importé par `ui/index.ts`. Variables `--bg0`, `--text`, `--accent`… alignées sur la palette (skill `procedural-assets`).
- Police : `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`. Chiffres en `font-variant-numeric: tabular-nums`.

## Input (drag-to-aim)
- `pointerdown` n'importe où sur le canvas (pas besoin de toucher la balle) → début de visée ; `pointermove` → `sim.aim(dir)` où `dir = boardPoint − launchPos` **inversé** si l'option « tirer à l'élastique » est active (par défaut : viser directement vers le point, plus intuitif sur desktop ; sur tactile, la direction pointe depuis le doigt vers le haut). Choisis **direct** pour les deux et reste cohérent.
- `pointerup` → `sim.fire()` si la distance de drag > 12 px, sinon `sim.cancelAim()` (évite les tirs accidentels).
- `touch-action: none` sur le canvas ; `preventDefault` sur les gestes ; pas de zoom (`user-scalable=no` déjà dans index.html).
- Pendant `firing` : un bouton **Rappel** (⏩) apparaît en bas à droite, ≥ 56 px. `pointerdown` sur ce bouton → `sim.recall()`.
- Premier `pointerdown` de la session → `audio.unlock()`.

## HUD (phase aiming/firing)
- Haut : ❤ PV (cœurs pleins/vides, max 10 puis chiffre), vague `V3`, pièces `🪙 42`, fragments `◆ 3`.
- Bas : la volée sous forme de pastilles colorées groupées par (élément, rang) avec le compte (`×7`), rang 2 = anneau, rang 3 = double anneau. Mise à jour sur `volley:*`.
- Dégâts du tir en cours en gros au centre-haut pendant `firing` (grossit avec les milestones), disparaît 600 ms après `volley:end`.

## Écrans
- **Récompense** : 3 cartes (icône dessinée en CSS/SVG inline, nom, description ≤ 60 caractères), bouton « Passer (+15 🪙) ». Apparition en cascade 60 ms, `easeOutBack`. Clic → `sim.chooseReward(i)`.
- **Boutique** : 4 articles + prix, bouton reroll avec coût, « Continuer ». Article grisé si trop cher.
- **Fin de run** : profondeur, vague, meilleur combo, dégâts max, fragments gagnés (compteur qui monte), gros bouton « Rejouer », bouton « Puits ».
- **Puits** : trois colonnes (Arsenal, Fondations, Profondeur), nœuds avec niveau et coût, solde en haut. Verrouillé = cadenas.
- **Titre** : uniquement au premier lancement (`meta.data.onboarded === false`) : logo texte + « Glisse pour viser » animé ; sinon on arrive direct en jeu.
- **Réglages** : 2 sliders (SFX, musique), « Réinitialiser la sauvegarde » avec confirmation.

## Règles
- Cibles tactiles ≥ 48 px, contraste texte ≥ 4,5:1, aucune info uniquement par la couleur (icône + texte).
- Les écrans sont des `<div class="screen">` montrés/cachés par classe, pas recréés à chaque fois ; le contenu dynamique via `textContent` (jamais `innerHTML` avec des données).
- Boutons : `<button>` natifs (clavier OK), `aria-label` si icône seule.
- Responsive : fonctionne de 360 × 640 à 1440 × 900 ; le canvas garde son ratio ; les écrans sont scrollables si trop hauts (`overflow:auto`).
- Tout clic émet `bus.emit({ type: 'ui:click' })` pour le son.

## Checklist
- [ ] Souris et tactile testés (Playwright `hasTouch` pour le tactile).
- [ ] 360 px et 1440 px : rien ne déborde, texte lisible.
- [ ] Aucun texte > 60 caractères sur les cartes.
- [ ] `ui:screen` émis à chaque changement d'écran.
