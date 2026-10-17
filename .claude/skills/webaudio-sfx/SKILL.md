---
name: webaudio-sfx
description: Synthèse WebAudio pour Pegbreaker — moteur (contexte, déverrouillage mobile, bus master/sfx/music), recettes de SFX par événement, pitch lié au combo, musique générative, anti-saturation.
---

# WebAudio — Pegbreaker

## Moteur
- Un seul `AudioContext`, créé paresseusement. `unlock()` appelé par `ui` au premier `pointerdown` : `ctx.resume()` puis jouer un buffer silencieux (iOS).
- Graphe : `sfxGain` et `musicGain` → `master` (avec `DynamicsCompressor` threshold −12 dB, ratio 4) → `destination`.
- Chaque SFX = oscillateurs/bruit + `GainNode` avec enveloppe par `setValueAtTime`/`exponentialRampToValueAtTime` (jamais à 0 : utiliser 0,0001), `stop()` planifié. Pas de nœuds persistants par son.
- Limite : max 12 SFX déclenchés par tranche de 50 ms, les suivants sont ignorés (les volées de 30 balles sinon saturent). Les `ball:bounce` ont la priorité la plus basse.
- Bruit blanc : un `AudioBuffer` d'1 s généré une fois, lu via `AudioBufferSourceNode` + `BiquadFilter`.

## Recettes (durées courtes, tout < 400 ms sauf musique)
| Événement | Recette |
|---|---|
| `ball:bounce` wall | sine 180 Hz → 120 Hz en 40 ms, gain 0,15, 50 ms |
| `ball:bounce` block/peg | triangle, fréquence = `220 × 2^(min(combo,24)/12)` (monte d'un demi-ton par combo), 60 ms, gain 0,2 |
| `block:hit` | bruit filtré passe-bande 1 200 Hz Q 2, 40 ms + click (square 2 ms) |
| `block:destroyed` | bruit passe-bas 400 → 80 Hz en 120 ms + sine 90 Hz 80 ms (impact) |
| `combo:milestone` | arpège majeur rapide (3 notes × 50 ms) niveau 1 ; +octave niveau 2 ; niveau 3 : accord tenu 300 ms + sweep |
| `block:explode` | bruit passe-bas 2 000 → 60 Hz 350 ms, gain 0,5, + sub sine 50 Hz |
| `drop:collected` coin | deux sines 1 320 Hz puis 1 760 Hz, 60 ms chacune (« ding ding ») ; ball : sweep up 400→900 Hz ; fragment : accord cristallin |
| `volley:fusion` | sweep sine 300 → 1 200 Hz 200 ms + bruit bref, puis « pop » |
| `player:damaged` | sawtooth 110 Hz détuné ×2, distortion (WaveShaper), 250 ms, gain 0,5 |
| `reward:offered` | trois notes montantes douces |
| `ui:click` | square 800 Hz 15 ms, gain 0,1 |
| `run:over` | descente chromatique 4 notes, 600 ms |

## Musique (refonte 2026-10-16 : l'utilisateur a jugé la première version « très mauvaise »)

Ce qui ne marche pas : notes tirées au hasard, drone permanent, pad en dents de scie non filtré, delay à forte réinjection, pas de structure, pas de silence. Ce qui marche : une **composition écrite** (pas générée note à note), des timbres doux, une structure en sections, de l'espace.

Règles :
- **Écrire la musique** comme une partition : tableaux de notes (temps, hauteur MIDI, durée, vélocité) par piste (basse, accords, mélodie, contre-chant), 16 à 32 mesures bouclées, avec une section A et une section B et une variation par passage (ex. mélodie jouée une octave plus haut un passage sur deux). Tout aléa limité à la vélocité (±10 %) et au choix de la variation.
- **Harmonie** : progression de 4 à 8 accords écrite à la main dans une tonalité (ex. ré mineur dorien : i – VII – IV – i / i – VI – VII – v). Voice leading : les accords partagent des notes communes, déplacement minimal entre deux accords. Mélodie sur les notes de l'accord et les notes de passage de la gamme, jamais hors gamme.
- **Timbres** : basse = sine + triangle une octave au-dessus, filtre passe-bas 200-400 Hz, enveloppe courte ; accords = 3 oscillateurs triangle/sine légèrement détunés (±4 cents), passe-bas 1,2-2 kHz, attaque 80-200 ms, relâchement 400-800 ms, volume bas ; mélodie = « pluck » (triangle ou square filtré, attaque 2 ms, décroissance 150-300 ms) ou flûte (sine + vibrato 5 Hz) ; aucune dent de scie brute.
- **Espace** : réverbération par convolution avec une réponse impulsionnelle synthétique (bruit décroissant 1,5-2,5 s, passe-bas), send 15-30 % ; delay ≤ 0,25 de réinjection, en croche pointée, uniquement sur la mélodie. Pas de drone continu : la basse joue des notes.
- **Rythme** : tempo 80-110 BPM selon la piste, percussion légère synthétisée (kick sine 60 Hz 80 ms, hi-hat bruit passe-haut 30 ms, snare bruit + sine 180 Hz) à faible volume, ou pas de percussion sur la piste calme.
- **Planification** : `AudioContext.currentTime` avec 150 ms d'avance, scheduler sur `setInterval` 50 ms ; toutes les notes d'une mesure planifiées en bloc : aucune note en retard même si le thread est chargé.
- **Dynamique dans le jeu** : couches par intensité (vague) : basse seule au début, + accords, + mélodie, + percussion ; boss = même progression en mode mineur harmonique avec la basse une octave plus bas ; `run:lost` : tout s'éteint sauf un accord tenu ; `run:over` : résolution sur l'accord I majeur. Les changements de couche se font **à la mesure** (jamais au milieu d'une note).
- **Mix** : musique à environ −7 dB sous les SFX en crête (relevée le 2026-10-16, trop discrète à −14) ; limiteur sur le master ; vérifier avec un rendu `OfflineAudioContext` de 60 s : pic < 0,9, aucune note hors gamme (vérifiable par construction), aucune superposition de plus de 6 voix.
- **Trois pistes** (`MusicTrackId` : `neon` calme et aérienne, `arcade` entraînante avec percussion, `deep` sombre et lente) : le joueur choisit dans les réglages, `arcade` par défaut (choix de l'utilisateur à l'écoute).

## Checklist
- [ ] Aucun son avant `unlock()` ; aucune erreur console si l'AudioContext est suspendu.
- [ ] Volée de 30 balles : pas de saturation (compresseur + limiteur de déclenchements).
- [ ] Chaque événement de la table a un son ; pitch combo audible.
- [ ] `setSfxVolume(0)` coupe réellement tout.
