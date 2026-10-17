---
name: game-feel
description: Juice et feedback pour Pegbreaker — squash & stretch, particules, flashs locaux, nombres de dégâts, tweens, cohérence avec l'audio. Pas de screen shake, de hit-stop ni de ralenti (décision produit). À charger pour tout travail dans render/ ou sur les transitions UI.
---

# Game feel — Pegbreaker

Chaque **événement** du bus mérite au moins un feedback visible < 50 ms. Le tableau ci-dessous est le minimum.

| Événement | Feedback visuel | Intensité |
|---|---|---|
| `ball:bounce` (wall) | micro-flash du mur à l'impact (0,08 s) | faible |
| `ball:bounce` (block/peg) | squash du bloc (scale 1 → 1,15 → 1, 120 ms), 3-5 étincelles | moyen |
| `block:hit` | nombre de dégâts flottant (monte 0,6 u, fade 500 ms), taille ∝ log(dégâts) ; crit = jaune + plus gros | moyen |
| `block:destroyed` | éclats (8-14 particules de la couleur du bloc, vitesse 3-8 u/s, gravité légère), flash blanc du bloc 1 frame, shake 2 px | fort |
| `combo:milestone` | niveau 1 : flash + shake 4 px ; niveau 2 : hit-stop 40 ms ; niveau 3 : hit-stop 70 ms + slow-mo 0,3 pendant 200 ms + vignette | très fort |
| `block:explode` | onde circulaire (anneau qui grandit, 250 ms), shake 6 px, hit-stop 30 ms | fort |
| `volley:fusion` | les deux balles du HUD glissent l'une vers l'autre, flash, la fusionnée pulse | moyen |
| `drop:collected` | le drop file vers le compteur HUD concerné (tween 300 ms easeOutCubic), le compteur « pop » | moyen |
| `player:damaged` | flash rouge des bords, shake 8 px, hit-stop 60 ms | fort |
| `rows:advanced` | les blocs glissent (easeOutBack 250 ms), **pas** de téléportation | moyen |
| `boss:spawned` | tremblement 400 ms, nom du boss en gros qui tombe | fort |

## Règle produit (2026-10-16)
Le jeu n'a **ni secousse d'écran, ni hit-stop, ni ralenti, ni flash plein écran, ni lignes de vitesse** : l'utilisateur a testé le mode « mouvements réduits » et l'a préféré. Les feedbacks restent locaux (sur le bloc, la balle, le point d'impact) et le temps de la sim ne s'arrête jamais. Les lignes de la table qui mentionnent shake/hit-stop/slow-mo sont à lire sans ces effets.

## Règles
- **Hit-stop** via `time.requestHitStop(ms)` ; **jamais** en bloquant le renderer : les particules continuent de bouger pendant le gel (elles utilisent `dtMs` réel).
- Shake : décroissance exponentielle, offset aléatoire par frame, appliqué par `ctx.translate` autour du plateau. Plafonne à 10 px. Désactivable (`setShake(false)`), et `reduceMotion` supprime shake + slow-mo + flashes plein écran.
- Easing : `easeOutBack` pour les apparitions, `easeOutCubic` pour les déplacements, linéaire pour les fades. Jamais d'ease-in sur un feedback.
- Les nombres de dégâts se **cumulent** s'ils tombent au même endroit en < 100 ms (un seul nombre qui grossit), sinon on lit « 1 1 1 1 ».
- Les trails de balles : 6 positions mémorisées, dessinées en alpha décroissant. Couleur = élément.
- Palette : voir skill `procedural-assets`. Fond sombre, blocs saturés, feedback blanc/jaune.
- Tout effet a une durée ≤ 600 ms sauf les ondulations de fond.

## Snippet : particules poolées
```ts
interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; }
const parts: P[] = Array.from({ length: 512 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: '#fff' }));
let live = 0;
export function spawn(x: number, y: number, n: number, color: string, speed: number): void {
  for (let i = 0; i < n && live < parts.length; i++) {
    const p = parts[live++]!; const a = Math.random() * Math.PI * 2; const s = speed * (0.5 + Math.random());
    p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; p.life = p.max = 0.3 + Math.random() * 0.3; p.size = 0.04 + Math.random() * 0.06; p.color = color;
  }
}
```
(`Math.random` est autorisé dans `render/` : il n'affecte pas la sim.)

## Checklist
- [ ] Chaque type d'événement de la table a un feedback branché.
- [ ] `reduceMotion` et `shake=false` respectés.
- [ ] Aucune allocation par frame (pools, pas de `ctx.createLinearGradient` dans `draw` sans cache).
- [ ] 60 fps avec 30 balles + 500 particules (`__pegbreaker.fps`).
