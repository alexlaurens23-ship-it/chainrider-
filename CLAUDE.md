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
| Dev ports | web **:5180**, api **:8787** | Vite `strictPort: true` — 5173 belongs to another project on this machine; never fall back |

## File map

> Fill in one-liners as phases complete.

```
CLAUDE.md                     This file — permanent context.
package.json                  Workspaces root. Scripts: dev / build / verify.
tsconfig.base.json            Shared strict compiler options; every workspace extends it.
docs/
  PHYSICS_RESEARCH.md         Physics research + final rig spec (see appendix below).
  ART_RESEARCH.md             Art research + neon bike visual spec (see appendix below).
packages/
  physics/                    Deterministic sim + scoring. tsup dual ESM/CJS (dist/index.js + .cjs).
    src/sim.ts                createSim (terrain+rig+checkpoints) / stepSim (ALL input/control/crash/scoring per tick) / getSnapshot / getTrackInfo.
    src/replay.ts             simulateReplay(track, tune, inputLog, maxTicks) → FinalResult. Server calls this in P6.
    src/scoring.ts            SCORING constants + ScoreState + updateScore (sole scoring implementation).
    src/terrain.ts            Pure polyline geometry: y/slope at x, wrapAngle, swept head-circle death check.
    src/constants.ts          SIM_DT, gravity, iterations, SIM_VERSION (bump on any physics/scoring change), lead-in/run-out/checkpoint/freeze constants.
    src/types.ts              INPUT bitmask (1 thr/2 brk/4 leanL/8 leanR/16 jump), BikeTune + DEFAULT_TUNE, Sim, SimSnapshot, TrackInfo, FinalResult.
apps/
  web/                        Vite + vanilla TS. Tuning playground (the only screen for now).
    vite.config.ts            Dev server pinned to :5180 (strictPort) + /api proxy -> :8787.
    src/main.ts               Mounts the playground.
    src/net.ts                Typed apiFetch helper + getHealth. Dev proxy /api -> :8787.
    src/playground/loop.ts    Fixed-timestep accumulator + render interpolation; records input log; orchestrates everything.
    src/playground/track.ts   Hardcoded TEST_TRACK (flat→ramp→gap→bumps→big jump).
    src/playground/input.ts   Keyboard → keymask (W/S/A/D/arrows/Space, R reset).
    src/playground/render.ts  Canvas2D camera-follow renderer, primitive bike shapes.
    src/playground/panel.ts   Hand-rolled slider per BikeTune key; rebuilds sim on change.
    src/playground/hud.ts     Score/combo/flips/crashes/FPS/tick + api health.
    src/playground/selftest.ts DETERMINISM SELF-TEST: 600 live ticks vs simulateReplay, PASS/FAIL overlay.
  api/                        Fastify on :8787 (ESM, tsx dev). GET /api/health live.
    src/routes/*.ts           auth/tracks/runs/leaderboards/payouts/admin plugin stubs ({todo:true}).
    .env.example              SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, ADMIN_KEY.
scripts/
  dev.mjs                     Zero-dep concurrent runner for root `npm run dev` (api + web).
  launch/                     PumpPortal token launch — typed launchToken stub only.
deploy/                       Empty placeholder for hosting/infra config.
```

## Status

_Update at the end of every session._

**Done**
- Research phase: `docs/PHYSICS_RESEARCH.md` (Planck wheel-joint rig, fixed-timestep loop, determinism checklist).
- Research phase: `docs/ART_RESEARCH.md` (code-drawn vector neon bike chosen; skin config; draw order).
- This `CLAUDE.md` established.
- Monorepo skeleton (2026-06-11): 4 workspaces wired and type-checking (`npm run verify` clean). Physics builds dual ESM/CJS via tsup with `planck@1.5.0` pinned exact; `createSim`/`stepSim`/`getSnapshot` create a real stepping world with chain terrain (no bike rig yet). Web shows placeholder grid + pings `/api/health` through the Vite proxy (verified end-to-end). API serves health + six `{todo:true}` route-plugin stubs. Root `npm run dev` uses zero-dep `scripts/dev.mjs` (no `concurrently`). First commit made; repo-local git identity set.
- Dev ports pinned (2026-06-12): web dev server fixed to **:5180** with `strictPort: true` in `apps/web/vite.config.ts` (5173 is used by another project on this machine); api stays on :8787.
- Real physics + playground (2026-06-12): full deterministic sim in `packages/physics` — Appendix A rig (chassis box + 2 bullet wheels + WheelJoints + head sensor), X-Moto lean, edge-triggered jump (bit 16), crash (head sensor + swept circle + hard-landing impulse∧angle + kill floor 30m below min), 60-tick freeze → checkpoint respawn (every 15% of span), full scoring (airtime 10/6t flat; flips ±2π=250; combo ×1→×5 over 120t on flips/clean landings/wheelies; clean landing 50 within 30°+10t pair; wheelie 20/60t @>2m/s; crash −100 clamp≥0; finish 1000 + (par−t)/100), `simulateReplay` + `SIM_VERSION=2`. Track = chart + 20m lead-in + 30m run-out, finish flag at lastX+10. Input log = change-only `[tick,mask]`, mask persists. Web playground: accumulator loop, tune sliders (live rebuild), HUD, determinism self-test (600 live ticks vs replay → PASS in Node parity test). `npm run verify` clean.

- Tuning pass (2026-06-12): **locked tune v1** is the new `DEFAULT_TUNE` (chassisDensity 10, attitudeTorque 70, wheelRadius 0.34, groundFriction 1.45, etc. — found in the playground; DEFAULT_TUNE in `packages/physics/src/types.ts` is now the source of truth, Appendix A keeps the original research starting values). New tune param `chassisSpinCap` (default 6.5 rad/s): chassis angular velocity clamped to ±cap **only while fully airborne**, applied post-step; grounded dynamics untouched. `SIM_VERSION=3`. Verified: `npm run verify` clean + bit-identical double replay in Node.

**In progress**
- Nothing.

**Next**
- Neon bike renderer per Appendix B (replace primitive shapes); rear light ribbon.
- Decide DB schema for `cr_tracks` (frozen/versioned), `cr_runs`, `cr_payout_windows`.
- API: wire `simulateReplay` into run submission validation (P6).

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
