# Art Research — Neon Cyber-Bike Visuals

**Author:** Technical artist
**Date:** 2026-06-11
**Status:** Research only. No code yet.
**Goal:** A low, long, aggressive **neon cyber-bike silhouette** for a chart-as-terrain motocross game. Crisp, glowing, skinnable from day one.
**Pairs with:** `docs/PHYSICS_RESEARCH.md` (Planck wheel-joint rig; wheel radius **0.4 m**, ~1.4 m wheelbase, chassis dominant).

> ⚠️ **IP CONSTRAINT — read first.** Tron-**inspired** only. **Original silhouette.** Never use Disney/Tron assets, traced designs, the word "Tron," or "light cycle" in art, code, filenames, or marketing. This ships on a **crypto token**, and Disney has a documented, aggressive history here: it filed oppositions that **defeated the Tron (TRX) blockchain's USPTO trademark applications** ("TRON," "TRONNETWORK," "TRONIX") on brand-confusion grounds. A neon bike on a crypto product is exactly the fact pattern that draws scrutiny. We borrow the *vibe* (glowing edges, dark void, light ribbons) — which is unprotectable general aesthetic — never the protected expression (specific cycle designs, names, logos, the Grid look-and-feel). When in doubt, make it *more* distinct.

---

## 1. Reference imagery & silhouette direction

Studied: "light cycle side view," "neon motorcycle silhouette," "synthwave bike," Trials side profiles, Moto X3M proportions.

### What reads as "neon cyber-bike" (the unprotectable, generic cues we keep)
- **Glowing edge lines** on a near-black body against a dark background — light *emits* from the form rather than being lit by an external source.
- **Long, low, raked stance** — wheelbase visually long relative to height; the whole machine hugs the ground.
- **A light ribbon/trail** streaming off the rear — the single most iconic "neon bike" signal.
- **Cool-dominant palette** (cyan/magenta/electric-violet) with a hot accent, on black. Synthwave grid/horizon optional in background, never on the bike.

### What we deliberately do NOT copy (protected / too-associated expression)
- The specific Tron light-cycle profile (the long horizontal wedge with the enclosed canopy and the characteristic wheel-hub spokeless look traced 1:1).
- Any logo, typeface, character, or the "Grid" environment styling.
- Naming anything "light cycle," "Tron," "Grid," "derez," etc.

### Our silhouette brief (original)
A **dirt/trials motocross** bike, not a street/cycle wedge — this is both a gameplay fit (it jumps and flips over chart terrain) and an IP differentiator (Tron cycles are road racers, not knobby-tire dirt bikes).

| Trait | Direction | Why |
|---|---|---|
| Proportion | **Long & low** — wheelbase ≈ 3.5× wheel radius (matches 1.4 m / 0.4 m physics rig) | Aggressive, stable read; matches Trials/Moto X3M dirt-bike profiles |
| Stance | Rear wheel slightly larger visual mass; forks raked forward | Motocross attitude, "ready to launch" |
| Body | Minimal angular frame spine + seat wedge + visible fork & swingarm | Skeletal/exposed reads as "cyber," cheap to draw as vector |
| Wheels | Glowing **rings with spokes**, hub visible, spokes rotate with physics | The animated tell that sells motion |
| Rider | **Minimal angular silhouette** that leans with input | Sells the lean control; humanizes; differentiates from canopy cycles |
| Vibe | Emissive neon edges on black, hot accent, rear light ribbon | Generic synthwave cues only |

Trials/Moto X3M takeaway on **proportion**: the rider sits *over* the rear wheel, knees bent, torso forward — a compact triangle. The bike's visual center of mass sits low and rearward. We replicate the *proportions and posture*, drawn in our own neon-vector language.

---

## 2. Production pipelines — evaluation & recommendation

### (a) Code-drawn vector bike (Canvas2D paths + native glow) — **RECOMMENDED PRIMARY**
Chassis + 2 wheels as Canvas2D paths; neon via layered strokes + `shadowBlur`; wheels as glowing spoked rings rotated to match the physics wheel bodies; trail is free.

**Pros**
- **Crisp at any zoom** — vectors don't blur when the camera pushes in on a jump.
- **Glow is native** — `shadowBlur` + additive (`globalCompositeOperation = "lighter"`) layered strokes; no pre-baked glow sprites, no scaling artifacts. (MDN: shadows only render when `shadowColor` is non-transparent; the `"lighter"` blend lets stacked glows add up.)
- **Trail effects free** — the rear light ribbon is just a fading polyline of past wheel positions.
- **Zero asset pipeline** — no slicing, no export, no atlas, no CDN images. Ships in the JS bundle.
- **Skins = palette swaps** — recolor by swapping 3 hex values (§4). Perfect for token-holder cosmetic utility.
- **Tiny footprint & deterministic visuals** — pairs with the deterministic sim; the same state always draws the same frame.
- **Zero IP surface** — we author every vertex; nothing traced or generated from a model that might have seen Tron stills.

**Cons**
- Hand-tuning bezier/line geometry for a *good-looking* bike takes artist iteration (mitigated: one-time cost, then it's data).
- Less photographic detail than a rendered sprite (acceptable — the neon-silhouette look *wants* flat/minimal).
- Heavy glow can cost fill-rate on low-end mobile (mitigated: cap `shadowBlur` layers, optional "lite" glow).

### (b) AI-generated sprite (Seedream/Higgsfield) — secondary / hero art only
Orthographic side-view neon bike on transparent bg, hand-sliced into chassis / front wheel / rear wheel so wheels rotate independently.

**Pros:** richer detail; good for marketing/hero/loading art.
**Cons:**
- **Cleanup work** — transparent-bg cutout, deghosting, slicing into 3+ layers, aligning wheel pivots to physics axle positions.
- **Scaling blur** — raster blurs on zoom; needs multiple resolutions or it goes soft exactly when the camera is close.
- **Per-skin cost explodes** — every skin is a new generate-slice-clean cycle, not a hex swap. Kills the day-one config-driven skin system.
- **IP risk is higher** — generative models trained on web imagery can emit Tron-adjacent designs; each output needs a human IP review. For a crypto product, this is a recurring liability, not a one-time check.
- Wheel rotation of a detailed sprite reveals raster aliasing on the spokes.

**Verdict:** Use AI sprites for **off-physics hero art** (title screen, share-card bike, store thumbnails) where detail helps and motion/skinning don't apply. Not for the in-game, physics-driven bike.

### (c) Asset packs (itch.io / OpenGameArt / Kenney) — not viable as primary
Surveyed the CC0/CC-BY landscape:
- **Kenney "Racing Pack"** (CC0, 420 assets, includes motorcycles): **top-down** perspective, cartoon flat style. Wrong view, wrong vibe. Useful only as throwaway placeholder for early physics testing.
- **OpenGameArt** "2D Bike Sprite" (CC0, 288×189, sidescroll) and "Bikes" (CC0): the side one is a single generic raster bike (not neon, not layered for wheel rotation, low res); "Bikes" is top-down. Neither is neon nor sliced.
- **itch.io** neon-tagged packs (e.g. VEXED "Neon Industry"): **pixel-art platformer tilesets**, no neon motorcycle side profile exists in the free/CC space.

**Verdict:** No pack matches "neon cyber-bike side profile, layered for independent wheel rotation." Recoloring a raster pack reintroduces every con of option (b) with worse art. **Reject as primary.** A Kenney CC0 placeholder is fine purely to unblock physics work before the vector bike lands. Always record license + source if any asset touches the repo.

---

## 3. Visual spec for option (a) — the code-drawn vector bike

Authoring space: define the bike in **local meters** matching the physics rig (origin at chassis center of mass; +x forward, +y up). Renderer scales meters→pixels. Wheel radius **0.4 m**, axle spacing **~1.4 m**.

### Segment list (all as Canvas2D paths)
Drawn on the **chassis body's** transform except the wheels, which use their **own** physics body transforms.

1. **Frame spine** — main structural line from steering head (front) sweeping back to the rear axle area. The defining silhouette stroke; one continuous angular polyline/bezier.
2. **Seat / tank wedge** — a low angular quad sitting on the spine, mid-rear, where the rider perches.
3. **Front fork** — two near-parallel strokes from steering head down to the front axle (rake angle forward). Pivot/visual hint of suspension travel.
4. **Rear swingarm** — stroke(s) from frame pivot back to the rear axle; the driven side.
5. **Front wheel** — glowing ring + spokes + hub, on the **front wheel body** transform.
6. **Rear wheel** — same, on the **rear wheel body** transform; source of the trail.
7. **Rider** — minimal angular silhouette (head dot + torso wedge + bent arm to bars + bent leg to peg) parented to the chassis, **leaning forward/back with input** (rotate/translate the torso wedge by the same lean signal that drives the physics attitude torque). 3–5 segments max.

### Layered glow recipe (per emissive stroke)
Draw each glowing element in **three passes**, back-to-front, using additive blending so overlaps bloom:

```
ctx.globalCompositeOperation = "lighter"   // additive; layers add up to white-hot cores

// Pass 1 — OUTER HALO (atmosphere)
ctx.shadowColor = accent;  ctx.shadowBlur = 18;
ctx.strokeStyle = rgba(accent, 0.25); ctx.lineWidth = 6;  stroke()

// Pass 2 — MID GLOW (the colored neon body)
ctx.shadowColor = accent;  ctx.shadowBlur = 8;
ctx.strokeStyle = rgba(accent, 0.60); ctx.lineWidth = 4;  stroke()

// Pass 3 — CORE (hot white center line)
ctx.shadowBlur = 0;
ctx.strokeStyle = "#ffffff";          ctx.lineWidth = 2;  stroke()

ctx.globalCompositeOperation = "source-over"  // reset
```

Notes:
- `lineCap = "round"`, `lineJoin = "round"` everywhere — neon tubes have rounded ends.
- Shadow only renders with a non-transparent `shadowColor` (MDN). Reset `shadowBlur = 0` before the core so it stays sharp.
- **Performance guard:** `shadowBlur` is the expensive part. Cap to ~2 blurred passes per element; offer a "lite glow" toggle that drops Pass 1 on low-end devices. Consider rendering the bike to an offscreen buffer once per frame if glow stacking gets heavy.
- The **core white** carries the silhouette legibility; the colored passes carry the *mood*. This is why skins (which change only `accent`) always stay readable — the white core never changes.

### Rear-wheel light ribbon (trail)
- Keep a ring buffer of the **last 40 rear-wheel world positions** (one push per fixed sim step, sampled from the rear wheel body — keeps the trail deterministic and framerate-independent, see physics §8).
- Draw as a polyline from newest→oldest with **fading width and alpha**:
  - width: `lerp(fullWidth, 0, i/40)` (tapers to a point at the tail)
  - alpha: `lerp(0.7, 0, i/40)`
  - color: the skin's **`trailHex`**, drawn additively (`"lighter"`) with a small `shadowBlur` for bloom.
- Clear/age the buffer on respawn so the trail doesn't snap across the level.
- Optional: brighten the trail head when airborne / mid-flip to reward tricks visually.

---

## 4. Skin system data shape (config-driven from day one)

Skins are **pure data** — no new art per skin (the whole point of pipeline (a)). One JSON array, loaded at boot. This is the cosmetic surface for future **token-holder utility** (own token → unlock skin via `unlock` rule).

```jsonc
// skins.json — cosmetic config, day one
[
  {
    "id": "neon-default",        // stable slug, never reused
    "name": "Circuit Cyan",      // display name
    "primary": "#00E5FF",        // frame spine, forks, swingarm core glow
    "secondary": "#8A2BE2",      // seat/tank + rider accents (electric violet)
    "trail": "#00E5FF",          // rear light ribbon
    "unlock": { "type": "default" }
  },
  {
    "id": "magenta-pump",
    "name": "Pump Magenta",
    "primary": "#FF2EC4",
    "secondary": "#FFD400",
    "trail": "#FF2EC4",
    "unlock": { "type": "score", "min": 50000 }
  },
  {
    "id": "holder-gold",
    "name": "Diamond Hands",
    "primary": "#FFD700",
    "secondary": "#FFFFFF",
    "trail": "#FFAA00",
    "unlock": { "type": "token", "chain": "solana", "minBalance": 1, "contract": "<TBD>" }
  }
]
```

**Field contract**

| Field | Type | Meaning |
|---|---|---|
| `id` | string (kebab) | Stable unique key; persisted in save/leaderboard. Never renamed/reused. |
| `name` | string | UI display name. |
| `primary` | hex | Main neon accent — frame, forks, swingarm, wheel rings. |
| `secondary` | hex | Secondary accent — seat/tank, rider, hub details. |
| `trail` | hex | Rear ribbon color. |
| `unlock` | object | `{type}` ∈ `default` \| `score`(`min`) \| `daily` \| `achievement`(`id`) \| `token`(`chain`,`contract`,`minBalance`). Token gating is a future hook — keep the *shape* now even if only `default`/`score` resolve at launch. |

Rules:
- The **white core stroke (#fff) is not skinnable** — guarantees legibility across every palette.
- Renderer reads only `primary`/`secondary`/`trail`; adding a skin = appending one object, zero code/art.
- Validate hex + `id` uniqueness at load; fall back to `neon-default` on any bad entry.
- Keep skin *unlock* checks out of the deterministic sim (cosmetic only — must never affect physics or score).

---

## Final recommendation

**Ship pipeline (a): the code-drawn Canvas2D vector neon bike** as the in-game, physics-driven bike for v1.

It wins on every axis that matters here: crisp under the zooming jump camera, native glow with no asset pipeline, free deterministic trail, instant config-driven skins for token utility, and **the smallest possible IP surface** — every line is ours, nothing traced or AI-emitted, which is non-negotiable on a crypto product given Disney's track record against the Tron brand. Use **(b) AI sprites only for off-physics hero/marketing art** (each output IP-reviewed), and **(c) asset packs only as a disposable Kenney CC0 placeholder** to unblock early physics testing — neither belongs in the shipped game loop.

This also locks our look as a **neon motocross/dirt bike**, not a road cycle — a deliberate gameplay *and* legal differentiator from Tron's enclosed light-cycle wedge.

### Exact draw order — bike at rest (back → front)
Render farthest/dimmest first so additive glow and the core strokes layer correctly:

1. **Rear light ribbon (trail)** — drawn first, behind everything, additive fade.
2. **Rear wheel** — ring → spokes → hub (on rear wheel body transform).
3. **Front wheel** — ring → spokes → hub (on front wheel body transform).
4. **Rear swingarm** — glow passes (outer → mid → core).
5. **Front fork** — glow passes.
6. **Frame spine** — glow passes (the dominant silhouette line).
7. **Seat / tank wedge** — glow passes (secondary accent).
8. **Rider silhouette** — drawn last, on top, leaning per input (head/torso/arm/leg).

> Within each emissive element, the internal pass order is always **outer halo → mid glow → white core** (§3), and the whole bike resets `globalCompositeOperation` to `"source-over"` when finished.

---

## Sources

- [MDN — `CanvasRenderingContext2D.shadowBlur`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/shadowBlur)
- [MDN — Applying styles and colors (Canvas)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Applying_styles_and_colors)
- [Konva — HTML5 Canvas shadows / glow](https://konvajs.org/docs/styling/Shadow.html)
- [Kenney — Racing Pack (CC0, top-down)](https://kenney.nl/assets/racing-pack)
- [OpenGameArt — 2D Bike Sprite (CC0, sidescroll)](https://opengameart.org/content/2d-bike-sprite)
- [OpenGameArt — Bikes (CC0, top-down)](https://opengameart.org/content/bikes)
- [itch.io — assets tagged "neon"](https://itch.io/game-assets/tag-neon)
- [itch.io — assets tagged "motorcycle"](https://itch.io/game-assets/tag-motorcycle)
- [CoinGeek — Tron Foundation fails to piggyback on Disney's trademark](https://coingeek.com/tron-foundation-fails-attempt-to-piggyback-on-disneys-trademark/)
- [Daily Hodl — Disney stops Tron (TRX) from claiming three trademarks](https://dailyhodl.com/2019/12/20/disney-stops-justin-suns-tron-trx-from-claiming-three-trademarks/)
- [Justia — "TRON LEGACY" trademark, Disney Enterprises](https://trademarks.justia.com/778/59/tron-legacy-77859443.html)
