# CHAINRIDER

> Permanent session context. **Read this first, every session.** Update the **Status** and **File map** sections at the end of every session.

## Project

**CHAINRIDER** — a 2D physics motocross game where you ride real crypto price charts as terrain. Per-track leaderboards. **30-minute, UTC-aligned SOL payout windows** to top scorers, **paid manually by the owner from an admin panel**. Launches as a **pump.fun token** whose **creator fees fund the prize pool**.

## Stack

Monorepo via **npm workspaces**.

| Path | What | Tech |
|---|---|---|
| `packages/physics` | Deterministic sim **+ all scoring**. Shared by browser **and** Node. | Planck.js (`planck@1.5.0`), TypeScript |
| `apps/web` | Game client (render, input, UI, skins). | Vite + TypeScript + Canvas2D |
| `apps/api` | Leaderboard, run re-sim/validation, payout windows, admin panel. | Fastify + TypeScript, Supabase (Postgres), node-cron |
| `scripts/launch` | Token launch tooling. | PumpPortal |

- **All Postgres tables prefixed `cr_`** (e.g. `cr_tracks`, `cr_runs`, `cr_payout_windows`).
- `packages/physics` is the source of truth both apps import — it must build for both browser and Node targets.

## Hard rules (do not violate)

1. **Tracks are frozen & versioned.** Never mutate an active track's points/data. Changes = a new track version, never an in-place edit.
2. **Scoring lives ONLY in `packages/physics`.** `apps/web` and `apps/api` both import it. **Never duplicate or reimplement scoring logic** anywhere else.
3. **Fixed timestep `1/60`s everywhere.** Rendering interpolates between sim states; the **simulation never reads wall-clock time** (`Date.now()`/`performance.now()` are banned inside the sim). Time = `stepIndex * SIM_DT`.
4. **Server re-simulates every submitted run** (replay its input log in `packages/physics` on Node) before it can rank or be paid. Client scores are never trusted.
5. **No secrets in code.** `.env` only. No keys, mnemonics, RPC URLs, or service tokens committed.
6. **No Tron IP anywhere.** Original neon bike only — no Disney/Tron assets, traced designs, or the words "Tron"/"light cycle" in art, code, filenames, or marketing. (Crypto product → real IP risk; Disney has defeated Tron-brand trademarks before.)
7. **Do not touch any other project on this machine or VM.** Stay inside the CHAINRIDER repo.

## Key constants

| Constant | Value | Notes |
|---|---|---|
| `SIM_DT` | `1/60` s | Fixed timestep, everywhere |
| Gravity | `(0, -10)` m/s² | |
| pump.fun launch market cap | **$4,000 USD** | **Hardcode. Never scrape.** |
| Payout window | **30 min, UTC-aligned** | Windows start on the UTC clock (`:00`/`:30`) |
| Planck version | `planck@1.5.0` (MIT) | Pinned exact; `planck-js` is deprecated |
| Solver iterations | velocity **8**, position **3** | Identical browser + Node |

## File map

> Fill in one-liners as phases complete.

```
CLAUDE.md                     This file — permanent context.
docs/
  PHYSICS_RESEARCH.md         Physics research + final rig spec (see appendix below).
  ART_RESEARCH.md             Art research + neon bike visual spec (see appendix below).
packages/
  physics/                    (TBD) Deterministic sim + scoring. Shared browser/Node.
apps/
  web/                        (TBD) Vite + TS + Canvas2D client.
  api/                        (TBD) Fastify + Supabase + node-cron.
scripts/
  launch/                     (TBD) PumpPortal token launch.
```

## Status

_Update at the end of every session._

**Done**
- Research phase: `docs/PHYSICS_RESEARCH.md` (Planck wheel-joint rig, fixed-timestep loop, determinism checklist).
- Research phase: `docs/ART_RESEARCH.md` (code-drawn vector neon bike chosen; skin config; draw order).
- This `CLAUDE.md` established.

**In progress**
- Nothing yet.

**Next**
- Scaffold the npm-workspaces monorepo (`packages/physics`, `apps/web`, `apps/api`, `scripts/launch`).
- Stand up `packages/physics`: deterministic world + bike rig + scoring + input-replay API (must build for browser and Node).
- Decide DB schema for `cr_tracks` (frozen/versioned), `cr_runs`, `cr_payout_windows`.

---

# Appendix A — Bike rig spec (from `docs/PHYSICS_RESEARCH.md`)

Units: meters, kg (via density × area), seconds, radians. Gravity `(0, -10)`. Step `world.step(1/60, 8, 3)`. **Starting values to tune.**

**Bodies / fixtures**

| Body | Type | Shape | Density | Friction | Notes |
|---|---|---|---|---|---|
| Chassis (frame+rider mass lumped) | dynamic | polygon ~1.4 m × 0.4 m | 1.0 | 0.3 | Heavy body; tune mass ~**8–10:1** vs wheels |
| Rear wheel | dynamic | circle **r=0.4** | 1.0 | **1.6** | Driven; high friction = bite |
| Front wheel | dynamic | circle **r=0.4** | 1.0 | **1.6** | Free-rolling |
| Head sensor | fixture on chassis | circle r≈0.18, **isSensor** | — | — | Death trigger |
| Ground | static | open **Chain** (chart polyline) | — | 0.6 | One body, many verts |

Set `bullet = true` on wheels + chassis (anti-tunnel). Rotation enabled.

**Joints (2 × WheelJoint, `localAxisA = (0,1)`)**
- **Rear:** `frequencyHz 5.0`, `dampingRatio 0.8`, `enableMotor true`, `motorSpeed = -throttle * MAX_OMEGA` (MAX_OMEGA ≈ 50 rad/s), `maxMotorTorque 20` (→40 for more punch).
- **Front:** `frequencyHz 5.0`, `dampingRatio 0.8`, `enableMotor false`, `maxMotorTorque 5` (brake only).

**Control model (per fixed step)**
- Throttle: rear `setMotorSpeed(-MAX_OMEGA)`, full torque.
- Brake: ramp motor speeds → 0 with high torque.
- Lean (X-Moto pattern, applied to chassis):
  ```
  attitude = lean * ATTITUDE_TORQUE   // ATTITUDE_TORQUE ≈ 1500–3000 N·m
  chassis.applyTorque(attitude)
  attitude *= 0.75                     // decay 25%/step
  if (|attitude| < threshold) attitude = 0
  ```
  Tune so a held lean ≈ one full rotation per medium jump.

**Crash / landing / death**
- Death: head sensor `begin-contact` with ground **+** swept circle check (last→current head pos) for fast face-plants.
- Hard landing: in `post-solve`, big normal impulse **and** chassis-vs-ground angle outside tolerance → crash. **Landing forgiveness:** ±~25–35° between chassis angle and local slope is OK (keep speed).
- Respawn: snap full state (pos, angle, lin+ang velocity, motor state) to last checkpoint.

**Game loop:** fixed-timestep accumulator, `MAX_FRAME = 0.25` clamp, input sampled once per fixed step, render interpolates with `alpha = accumulator / STEP`. Server runs the same loop minus rendering over the recorded input log.

**Determinism essentials:** pin Planck version everywhere; fixed dt + fixed iters; input recorded as `(stepIndex, action)`; seeded/no RNG in sim; no wall-clock in sim; deterministic terrain build (pin data snapshot); stable body/joint creation order; exact snapshot/restore; CI parity test (browser vs Node → identical score + transform hash).

---

# Appendix B — Neon bike visual spec (from `docs/ART_RESEARCH.md`)

**Pipeline:** code-drawn **Canvas2D vector bike** (primary). AI sprites only for off-physics hero/marketing art. Asset packs only as disposable placeholder. Look = **neon motocross/dirt bike** (gameplay + IP differentiator from Tron's road cycle).

**Segments (Canvas2D paths):** frame spine, seat/tank wedge, front fork, rear swingarm, front wheel (ring+spokes+hub on front body), rear wheel (on rear body), minimal angular rider leaning with input. Wheels use their own physics body transforms; everything else on the chassis transform.

**Glow recipe (per emissive stroke, additive `globalCompositeOperation="lighter"`):**
1. Outer halo: `shadowBlur 18`, stroke `rgba(accent,0.25)` width 6.
2. Mid glow: `shadowBlur 8`, stroke `rgba(accent,0.60)` width 4.
3. Core: `shadowBlur 0`, stroke `#ffffff` width 2.
Round caps/joins. Reset to `source-over` after. **White core is never skinnable** (legibility). Cap blurred passes / offer "lite glow" on low-end.

**Rear light ribbon:** ring buffer of last **40 rear-wheel positions** (push once per fixed sim step → deterministic). Polyline newest→oldest, width `lerp(full,0)` and alpha `lerp(0.7,0)`, color `trailHex`, additive + small blur. Clear on respawn.

**Skin config (`skins.json`, day one):** `{ id, name, primary, secondary, trail, unlock }`. `unlock.type` ∈ `default | score(min) | daily | achievement(id) | token(chain,contract,minBalance)`. Renderer reads only `primary`/`secondary`/`trail`; new skin = append one object. Skin logic stays out of the deterministic sim (cosmetic only).

**Draw order at rest (back → front):** 1) rear light ribbon, 2) rear wheel, 3) front wheel, 4) rear swingarm, 5) front fork, 6) frame spine, 7) seat/tank wedge, 8) rider. Within each emissive element: outer halo → mid glow → white core.
