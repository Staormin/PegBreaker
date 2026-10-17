---
name: balancing
description: Équilibrage de Pegbreaker — où vivent les constantes (src/config/*.json), formules de PV, dégâts, combo, drops, économie, méthode d'ajustement à partir des rapports QA.
---

# Équilibrage — Pegbreaker

**Aucun nombre d'équilibrage dans le code.** Tout vient de `src/config/*.json` (types dans `core/types.ts` : `BallsConfig`, `BlocksConfig`, `WavesConfig`, `RelicsConfig`, `EconomyConfig`, `MetaConfig`). Si une formule a besoin d'un nouveau paramètre, ajoute la clé au JSON **et** demande l'ajout du type à l'architecte.

## Formules de référence
- PV de base d'une rangée : `baseHp × growthPerWave^(wave-1) × (1 + growthPerShot × shotInWave)`, puis par bloc `× rand(hpVariance.min, hpVariance.max) × def.hpRatio`, arrondi à l'entier ≥ 1.
- Dégâts d'un impact : `baseDamage × tierDamageMultiplier^(tier-1) × (1 + comboDamagePerBounce × combo)` ; `lead` : `× lead.damageMultiplier` et combo ignoré.
- Blocs par rangée : interpolation linéaire de `densityByWave` ; positions tirées sans remise parmi `cols` colonnes.
- Rangées par vague : `min(rowsMax, round(rowsBase + rowsPerWave × (wave-1)))`.
- Boss : vague multiple de `bossEvery` → une seule rangée, un bloc de `width` cellules, `hp = baseHp(wave) × hpMultiplier`.
- Boutique toutes les `shopEvery` vagues, après la récompense.
- Fragments de run : `perWave × vagues nettoyées + perBoss × boss tués + perDepth × depth`, × `fragmentMultiplier` (méta et runMods).
- Score : `perDepth × depth + perBlock × blocs + perDamage × dégâts totaux + perBoss × boss`.

## Cibles (voir DESIGN.md §6)
- Ratio « dégâts d'un tir / PV totaux de la rangée qui arrive » ≈ 1,3 en vague 1, 1,0 en vague 5, 0,9 en vague 10.
- Run 1 d'un joueur moyen (bot QA « naïf ») : mort vague 3-4, ~4 min. Bot « bon » : vague 8-10.
- Première amélioration offerte avant 40 s. Un drop toutes les ~2 tirs.

## Méthode
1. Lis le dernier rapport `docs/qa/*.md` : durée des runs, vague de mort, combo moyen, dégâts/tir par vague.
2. Change **un** paramètre à la fois, note l'intention dans le message de commit (`T13: growthPerWave 1.18→1.15 (mort trop tôt vague 4)`).
3. Rejoue en headless (`npm run test:e2e`) et compare.
4. Les sensations priment sur la courbe théorique : si le bot survit mais que les dégâts par tir ne grossissent pas visiblement d'une vague à l'autre, augmente la puissance des drops **et** les PV, pas l'inverse.

## Checklist
- [ ] Les JSON valident (`npm run build` lance `core/config.ts`).
- [ ] Tests unitaires de formule mis à jour avec les nouvelles valeurs.
- [ ] Le rapport de fin cite les valeurs avant/après et la raison.
