# Physics Research — 2D Motorcycle Game

**Author:** Gameplay physics engineer
**Date:** 2026-06-11
**Status:** Research only. No game code written yet.
**Goal:** Build a chart-as-terrain motocross game on a Box2D-style 2D engine that *feels good* — beating StonkRider, whose bike is a floppy stick figure with vague controls.

**Hard constraint:** Concepts and parameters only. **Never copy GPL source** (X-Moto is GPL) into our repo. Everything below is a re-derivation of *ideas* and published *numbers*, not code.

---

## 1. Box2D `b2WheelJoint` — the suspension rig

The wheel joint is the canonical Box2D primitive for a vehicle wheel. It is a **revolute + prismatic combination**:

- **Prismatic part (point-to-line):** body B (the wheel) is constrained to move along a single local axis fixed in body A (the chassis). This axis is the suspension travel direction. A **linear spring + damper** acts along it.
- **Revolute part (motor):** body B is free to spin about its center, and an optional **rotational motor** drives that spin — this is throttle/braking.

So one joint gives you: suspension (spring) + a driven wheel (motor), which is exactly a motocross wheel.

### Parameters (Box2D 2.3/2.4 naming — what Planck mirrors)

| Param | Meaning | Units | Default |
|---|---|---|---|
| `localAxisA` | Suspension travel axis in A's frame | unit vector | `(1,0)` (we want `(0,1)`) |
| `frequencyHz` | Spring stiffness as a natural frequency. `0` = rigid (no suspension) | Hz | `2.0` |
| `dampingRatio` | Damping. `1.0` = critical (no bounce), `<1` = bouncy | dimensionless | `0.7` |
| `enableMotor` | Turn the wheel motor on | bool | `false` |
| `motorSpeed` | Target spin rate | rad/s | `0.0` |
| `maxMotorTorque` | Torque cap the motor uses to reach `motorSpeed` | N·m | `0.0` |

**Key tuning rule (from Box2D docs):** the spring frequency should be **less than half the simulation frequency**. At 60 Hz sim, keep `frequencyHz ≤ 30`; in practice motocross suspension lives at **4–6 Hz**.

> **Version note for the build:** the current box2d.org docs describe Box2D **v3** (C API), which renamed things: `frequencyHz` → `hertz`, added an explicit `enableSpring` flag, and exposed translation limits (`enableLimit`, `lowerTranslation`, `upperTranslation`) on the wheel joint. **Planck.js does NOT follow v3** — it tracks the 2.4-era API (`frequencyHz`, `dampingRatio`, spring always present, no built-in limit on the wheel joint). We build against the Planck naming. Don't copy v3 field names into our code.

---

## 2. Planck.js — confirmed API & version

**Pin this:** `planck@1.5.0` (MIT license, "2D JavaScript/TypeScript physics engine for cross-platform HTML5 game development").

- ✅ **`planck`** — current package, v1.5.0, MIT, ships TypeScript types. **Use this.**
- ❌ **`planck-js`** — **deprecated**. npm prints: *"Please use 'planck' package instead of 'planck-js'."* Do not use.

```jsonc
// package.json — pin exact, this is the sim core
"dependencies": { "planck": "1.5.0" }
```

### WheelJoint (confirmed against Planck API docs + the official `Car` example)

Construction: `world.createJoint(new WheelJoint(def, bodyA, bodyB, anchor, axis))`. The def carries `enableMotor`, `motorSpeed`, `maxMotorTorque`, `frequencyHz`, `dampingRatio`.

Confirmed runtime methods:
- `setSpringFrequencyHz(hz)` / `getSpringFrequencyHz()` — *frequency 0 disables the spring*
- `setSpringDampingRatio(r)` / `getSpringDampingRatio()`
- `enableMotor(flag)` / `isMotorEnabled()`
- `setMotorSpeed(speed)` / `getMotorSpeed()` — rad/s
- `setMaxMotorTorque(t)` / `getMaxMotorTorque()` — N·m
- `getJointTranslation()` — current suspension compression (m)
- `getJointSpeed()` — suspension velocity (m/s)
- `getMotorTorque(inv_dt)` — useful for an engine-load readout

### World.step — fixed timestep

```
world.step(timeStep, velocityIterations, positionIterations)
```
- **`timeStep` fixed at `1/60`.** Box2D/Planck docs: *"use a time step no larger than 1/30 seconds"*; 1/60 is the quality target. Variable timesteps give inconsistent, hard-to-debug results.
- **`velocityIterations` 6–10** (use **8**), **`positionIterations` 2–8** (use **3**).
- Docs guidance: *"60 Hz and 10 iterations is far better than 30 Hz and 20 iterations"* — spend the budget on timestep, not iterations.
- Call `world.clearForces()` after stepping if you apply forces each frame.

### Chain shapes for terrain

The chart line becomes a `Chain` shape — a free-form polyline of edges with **smooth internal collision** (no "ghost vertex" snagging where segments meet). Build it as an **open chain** (`Chain(vertices, false)`) on a single static body. Chains collide one-sided/edge-wise and are ideal for ground; they hold thousands of vertices cheaply because they're static.

### Contact listeners

Planck replaced Box2D listener classes with event callbacks on the world:
```
world.on('begin-contact', cb)
world.on('end-contact',   cb)
world.on('pre-solve',     cb)   // can disable a contact this step
world.on('post-solve',    cb)   // impact magnitude → crash detection
```
We'll use `begin-contact` (wheel-on-ground = grounded) and `post-solve` impulse magnitude (hard landing → crash) plus a head sensor for death.

### Determinism caveats (Planck-specific)

- Planck is **deterministic across runs of the same build** given identical inputs, **fixed timestep, and fixed iteration counts**. It is **not guaranteed bit-identical across different Planck versions** (solver changes) or, strictly, across different JS engines — IEEE-754 doubles are deterministic but `Math.sin/cos`, transcendental rounding, and JIT reassociation can differ at the last ULP between V8 builds. For a leaderboard we treat the **server (Node) as authoritative** and pin one Planck version everywhere. See the checklist in §9.
- Never feed `Date.now()`, `Math.random()` (unseeded), or render `requestAnimationFrame` delta into the sim. Inputs only.

---

## 3. X-Moto — how a GPL motocross sim rigs the bike (concepts only)

X-Moto uses **ODE** (Open Dynamics Engine; Chipmunk multi-body since 0.5). It's not Box2D, so its spring/damp numbers are in ODE's ERP/CFM world and **don't port directly** — but the *ratios, masses, and mechanisms* are gold. From its published `Physics/original.xml` defaults (numbers are public config, not source code):

| Concept | X-Moto value | Takeaway for us |
|---|---|---|
| Frame mass | **90 kg** | Chassis is heavy relative to wheels |
| Wheel mass | **10 kg each** | ~**9:1** frame:wheel mass ratio — heavy body, light wheels = stable, planted feel |
| Wheel radius | **0.35 m** | Realistic moto scale |
| Wheelbase | **1.4 m** | Front/rear axle spacing |
| Suspension spring | 21000 (ODE units) | Stiff but compliant; we translate to **~4–5 Hz** in Box2D terms |
| Suspension damp | 205000 (ODE units) | Heavily damped → we use **dampingRatio ~0.7–0.85** |
| Wheel grip | **20.0** | High grip; the bike *bites* the ground (StonkRider does NOT — see §6) |
| Rider limb masses | torso/arms/legs **5 kg** each | Rider is an articulated ragdoll, light vs frame |
| **Rider attitude torque** | **10000** | The lean control — a torque applied to the frame |
| **Attitude defactor** | **0.75** | Lean torque **decays 25%/frame** → punchy then settles, not a constant spin |
| Brake factor | **80.0** | Strong braking |
| Engine power max | **1400** | — |
| Gravity | **9.81** | — |
| Sim iterations | **10** | Matches Box2D guidance |
| Dead-wheel detach speed | **40** | Cosmetic: wheel pops off on death |

### Rider lean (attitude torque) — the mechanism

Player lean input drives a torque on the **frame body**, not direct rotation:
```
attitudeCon = Pull() * RiderAttitudeTorque   // input ∈ [-1,1] × 10000
applyTorque(frame, attitudeCon)
attitudeCon *= 0.75                            // decay each frame
if (|attitudeCon| < 100) attitudeCon = 0       // glue to zero
```
This is why X-Moto's air control feels deliberate: a tap gives a decaying impulse of rotation rather than a constant angular velocity. **We adopt this exact pattern** (our own implementation).

### Head-collision death check — the mechanism

Rider is unharmed by falls; death is **the head touching terrain** (or a "wrecker" object). The check, `intersectHeadLevel()`:
1. **Circle test** — `checkCircle(headX, headY, headRadius)` against the terrain collision system each step.
2. **Swept-segment test** — `collideLine(lastHeadPos → headPos)` between this and last frame's head position, to catch **tunneling** when the head moves fast (more than its radius per step).
3. On hit → `onHeadTouches()` → death/respawn.

**We adopt this:** a small head sensor circle + a swept check so a fast face-plant always registers. (Conceptual re-implementation, not their code.)

---

## 4. Moto X3M & Trials — what makes the bikes *feel good*

Pure gameplay analysis (videos/articles). The recurring design pillars:

**Control palette is tiny on purpose.** Throttle, brake, and lean (tilt forward/back) — nothing else. Trials reviews repeatedly call this "physics that just feels right." A small input set with deep consequences = high skill ceiling, low learning cost.

**In-air rotation is a first-class verb.**
- Lean tilts the rider/bike in the air; you spin **forward (frontflip)** or **back (backflip)**.
- Rotation speed is tuned so a **full flip fits a normal jump** — fast enough to land a flip off a medium ramp, slow enough that you can *stop* at the right angle.
- Best-player technique: **start the flip early** so you have margin to straighten before landing.

**Flips earn rewards and shape the landing.** Flips give time/score bonuses *and* let you rotate the bike to match the landing slope. The flip is both a trick and a tool.

**Landing forgiveness = angle-based, not pixel-perfect.**
- Land **roughly aligned** with the ground → keep your speed (clean landing).
- Land badly **slanted / nose-first** → crash. There's a tolerance band, not a knife-edge. This is the single most important "feel" parameter.

**Crash & respawn flow is frictionless.** Crash → instant restart or rewind to the **last checkpoint**. Quick retries make crashing feel like learning, not punishment. Levels are **timed with a 1–3 star rating** to drive replay.

**Trials adds weight-shift nuance.** Shifting rider weight *subtly* alters air rotation and how the bike settles on touchdown — depth for experts without adding buttons.

---

## 5. StonkRider — the direct competitor, fully mapped

**Concept:** "Motocross meets Wall Street. Ride any stock chart on a motocross bike." (by Aymeric Dietrich.) The price chart of a real ticker becomes the terrain; you ride it on a bike and score tricks. Free, browser-based.

**Engine (confirmed by reading the shipped bundle):** **Matter.js** — `Matter.*`, `matter-js`, and the `Matter.Runner` internals (`frameDeltaSmoothing`, `frameDeltaSnapping`, `delta: 1000/60`, `_timeBufferMargin`) are all present. The bike is built from **Matter constraints** (springs) with **stiffness 0.1–1.0** and **damping 0.1–0.25**, and body **friction 0.1–0.9**.

### Everything it does

- **Chart → terrain:** pick a ticker (`symbol`, `name`, `exchange`); the price series becomes a chain-like ground.
- **Per-track stats:** `volatility`, `difficulty` (derived), `performance`, `dataPoints`, and date range (`startDate`/`endDate`). Volatility/slope drive the difficulty rating. (A `VolatilityKing` achievement exists, and there's a `max slope` concept in the bundle.)
- **Period selector:** `1y` default, switchable (`p` URL param, period buttons).
- **Smooth toggle:** `#smooth-btn` flips a `smooth=1` flag to smooth the chart line (jagged raw data ↔ smoothed terrain).
- **Daily mode:** a `daily=1` "chart of the day" variant.
- **Scoring:** counts **flips** (`Backflip`/`Frontflip`, with `Double`/`Triple` multipliers), tracks **`maxCombo`**, **`crashes`**, **`time`**, and a final **`score`**.
- **Achievements:** `MarginCall`, `PumpChaser`, `DumpDodger`, `FlipMaster`, `VolatilityKing` — themed around the finance gimmick.
- **Share / challenge flow:** finishing builds a **share image** (`URL.createObjectURL`) and a **challenge link** carrying `challengeScore` + `challengeHash` + ticker/period; copy-to-clipboard and `share=…`. A friend opens the link and plays the same chart to beat your score.
- **Leaderboard** present.
- Ko-fi donation widget; SEO/`VideoGame` schema markup.

### What feels weak (this is what we beat)

1. **Floppy bike.** Matter.js `Constraint`s are soft springs (stiffness 0.1–1.0), not a true wheel joint. The bike + rider read as a *floppy stick figure* — wobbly, imprecise, no planted contact patch. **Our edge: a real Box2D `WheelJoint` (motor + spring/damper) with a heavy chassis and high-grip wheels.**
2. **Vague controls.** Soft constraints + low friction (down to 0.1) = mushy, indirect input. **Our edge: X-Moto-style decaying attitude torque (punchy, settles) + 4–6 Hz suspension + grippy tires.**
3. **Non-deterministic sim.** `Matter.Runner` uses `frameDeltaSmoothing`/`frameDeltaSnapping` — the sim is tied to a smoothed render delta, so the same chart can play differently on different framerates and **can't be verified server-side**. **Our edge: fixed 60 Hz accumulator + deterministic Planck, server-authoritative score validation via replay of inputs.**
4. **Landing feel is incidental,** not a designed angle-tolerance system. **Our edge: explicit angle-based landing forgiveness (§4) + impact-impulse crash threshold via `post-solve`.**

---

## 6. Reference parameter ranges (Feronato / iforce2d / Box2D Car)

Cross-checked tutorial ranges for a Box2D vehicle:

| Param | Recommended range | Source/notes |
|---|---|---|
| Wheel friction | **0.9–2.0** | Feronato/iforce2d; Box2D `Car` uses **0.9**. Higher = more bite. (Box2D caps effective µ but >1 still increases grip vs low-friction ground.) |
| Suspension `frequencyHz` | **4–6 Hz** | Soft enough to absorb, stiff enough not to wallow. Box2D `Car` ships **4.0**. |
| `dampingRatio` | **0.7–0.9** | Box2D `Car` ships **0.7**. Higher = less bounce on landing. |
| Chassis density | **1.0** (baseline) | Box2D `Car` chassis density 1.0 |
| Wheel density | **1.0**, radius **0.4 m** | Box2D `Car`; keep wheels light *in total mass* via small radius so chassis dominates (matches X-Moto's ~9:1) |
| Motor | `maxMotorTorque` ~**20** (driven), `motorSpeed` up to ~**50 rad/s** | Box2D `Car` rear wheel |
| Gravity | **(0, -10)** | Box2D `Car` |

**iforce2d grip trick (top-down, adapted):** kill lateral wheel velocity each step for arcade grip. For our side-view game we don't zero lateral velocity, but the lesson — *manufacture grip explicitly rather than hoping friction is enough* — is why we use high wheel friction + a stiff-ish motor.

---

## 7. (a) Recommended bike rig spec — starting numbers

Units: meters, kilograms (via density × area), seconds, radians. Gravity `(0, -10)`. **These are starting values to tune, grounded in §3 and §6.**

### Bodies (3 dynamic + 1 static ground)

| Body | Type | Shape | Density | Friction | Notes |
|---|---|---|---|---|---|
| **Chassis (frame+rider mass lumped)** | dynamic | polygon, ~1.4 m long × 0.4 m tall | **1.0** | 0.3 | This is the heavy body. Target total mass ≈ frame+rider so it dominates (X-Moto: 90 kg frame). Set `density` so chassis ≫ wheels (~**8–10:1** mass ratio). |
| **Rear wheel** | dynamic | circle, **r = 0.4** | **1.0** | **1.6** | Driven wheel. High friction = bite. |
| **Front wheel** | dynamic | circle, **r = 0.4** | **1.0** | **1.6** | Free-rolling (motor off or low torque). |
| **Head sensor** | fixture on chassis | small circle r ≈ 0.18, **isSensor** | — | — | Mounted at rider head offset; death trigger (§3). |
| **Ground** | static | `Chain` (open polyline from chart) | — | 0.6 | One body, thousands of verts. |

Set `bullet = true` on the wheels and chassis to enable continuous collision (anti-tunnel at speed). Set fixed rotation **off** (the bike must rotate).

### Joints (2 wheel joints)

```text
Rear WheelJoint  (chassis ↔ rear wheel):
  localAxisA   = (0, 1)        // suspension travels vertically in chassis frame
  frequencyHz  = 5.0           // 4–6 band
  dampingRatio = 0.8           // 0.7–0.9 band, firm landings
  enableMotor  = true
  motorSpeed   = -throttle * MAX_OMEGA   // sign = forward; MAX_OMEGA ≈ 50 rad/s
  maxMotorTorque = 20.0        // raise to ~40 for more punch

Front WheelJoint (chassis ↔ front wheel):
  localAxisA   = (0, 1)
  frequencyHz  = 5.0
  dampingRatio = 0.8
  enableMotor  = false         // free-rolling; enable with small torque only for braking
  maxMotorTorque = 5.0
```

### Control model (per fixed step)

- **Throttle (accelerate):** `rearJoint.setMotorSpeed(-MAX_OMEGA)`, full `maxMotorTorque`.
- **Brake:** ramp both motor speeds toward 0 with high torque (brake factor analog to X-Moto's 80).
- **Lean (air + ground):** X-Moto attitude pattern on the **chassis**:
  ```
  lean = input ∈ [-1, 1]
  attitude = lean * ATTITUDE_TORQUE        // ATTITUDE_TORQUE ≈ 1500–3000 N·m, tune for "one flip per jump"
  chassis.applyTorque(attitude)
  attitude *= 0.75                          // decay 25%/step
  if (|attitude| < threshold) attitude = 0
  ```
  Tune `ATTITUDE_TORQUE` against chassis moment of inertia so a held lean ≈ **one full rotation per medium jump** (the §4 feel rule).

### Crash / landing / death

- **Death:** head sensor `begin-contact` with ground **+** swept circle check (last→current head pos) to catch fast face-plants (§3).
- **Hard-landing crash:** in `post-solve`, if normal impulse on a wheel/chassis exceeds a threshold *and* chassis-to-ground angle is outside the tolerance band → crash. **Landing forgiveness:** allow ±~25–35° between chassis angle and local ground slope before it counts as a crash (§4). Aligned landing within the band → keep speed.
- **Respawn:** snap bike state (position, angle, zero velocities) to the last checkpoint; instant retry.

---

## 8. (b) Recommended game-loop pattern — fixed-timestep accumulator

Decouple simulation (deterministic, 60 Hz) from rendering (whatever the display does), with interpolation so motion stays smooth on any refresh rate. This is the classic "Fix Your Timestep" pattern.

```text
const STEP = 1 / 60          // fixed sim dt (seconds)
const VEL_ITERS = 8
const POS_ITERS = 3
const MAX_FRAME = 0.25       // clamp: never simulate >0.25s of catch-up (spiral-of-death guard)

let accumulator = 0
let prevState = snapshot(world)   // positions/angles for interpolation
let currentState = prevState

function frame(now) {
  let frameTime = (now - last) / 1000
  if (frameTime > MAX_FRAME) frameTime = MAX_FRAME
  last = now
  accumulator += frameTime

  while (accumulator >= STEP) {
    prevState = currentState
    readInputIntoSimCommands()        // sample input ONCE per fixed step
    world.step(STEP, VEL_ITERS, POS_ITERS)
    world.clearForces()
    currentState = snapshot(world)
    accumulator -= STEP
  }

  const alpha = accumulator / STEP     // 0..1
  render(lerp(prevState, currentState, alpha))   // interpolate positions; slerp/lerp angles
  requestAnimationFrame(frame)
}
```

Rules:
- **Input is sampled at the fixed step**, never at render time — keeps sim deterministic.
- **`world.step` is only ever called with `STEP`** — never a variable dt.
- **Interpolate at render** using `alpha`; the rendered bike lags ≤ one sim step, invisible to the eye, perfectly smooth.
- **Clamp `frameTime`** so a stalled tab (huge `now - last`) doesn't trigger a death-spiral of catch-up steps.
- On the **server (Node)**, run the *same* loop minus rendering: step the world over the recorded input stream at fixed `STEP` and read out the score.

---

## 9. (c) Determinism checklist — same sim in browser and Node

For a fair leaderboard, a run must reproduce **bit-for-bit** when replayed from its inputs. Server replays the input log; if its score ≠ the client's claimed score, reject.

- [ ] **Pin one Planck version everywhere.** `planck@1.5.0` exact, identical in browser bundle and Node. Solver changes between versions break determinism.
- [ ] **Fixed timestep only.** Always `world.step(1/60, 8, 3)`. Never pass a render delta. Identical `velocityIterations` / `positionIterations` on both sides.
- [ ] **Deterministic input model.** Record inputs as `(stepIndex, action)` events, not wall-clock timestamps. Sim consumes them by step index. Replay feeds the exact same sequence.
- [ ] **Seeded RNG, or none.** No `Math.random()` in the sim. If randomness is needed (e.g. terrain decoration), use a seeded PRNG and store the seed with the run. Decorative randomness must not touch physics bodies.
- [ ] **No wall-clock in the sim.** No `Date.now()`, `performance.now()`, or frame delta feeding any physics decision. Time = `stepIndex * (1/60)`.
- [ ] **Deterministic terrain build.** Chart → vertices must be a pure function of (ticker, period, smooth flag, data snapshot). Pin the data snapshot (store the exact price series or its hash with the run) so the ground is identical client and server.
- [ ] **Fixed iteration / insertion order.** Create bodies, fixtures, and joints in the same order every time (Box2D solve order depends on island/contact ordering). Don't iterate over a `Set`/`Map` whose order could differ; use arrays.
- [ ] **Same float math.** IEEE-754 doubles are deterministic, but avoid relying on `Math.sin/cos/tan/pow` agreement at the last ULP across engines for *gameplay-critical* values; keep such use inside Planck (consistent) and don't reimplement physics math yourself. Test V8-in-browser vs V8-in-Node parity (both are V8 — lowest risk path).
- [ ] **No NaN/Inf leaks.** Clamp inputs; a single NaN diverges everything. Assert finite state in dev.
- [ ] **Snapshot/restore is exact.** Respawn/checkpoint must restore full state (position, angle, linear + angular velocity, joint motor state) — partial restore desyncs replay.
- [ ] **Parity test in CI.** Golden test: a recorded input log must produce the identical final score + a hash of final body transforms, run in both the browser test runner and Node. Fail the build on mismatch.

---

## Sources

- [Box2D — Wheel Joint (official docs)](https://box2d.org/documentation/group__wheel__joint.html)
- [Box2D — Simulation / timestep guidance](https://box2d.org/documentation/md_simulation.html)
- [b2WheelJoint header & defaults (frequencyHz 2.0, dampingRatio 0.7)](https://jesse.tg/Box2D-Docs/classb2_wheel_joint.html)
- [Planck.js — Simulation docs (World.step, iterations)](https://piqnt.com/planck.js/docs/world/simulation)
- [Planck.js — Wheel Joint docs](https://piqnt.com/planck.js/docs/joint/wheel-joint)
- [Planck.js — WheelJoint API class reference](https://piqnt.com/planck.js/docs/api/classes/WheelJoint)
- [Planck.js — official Car example (frequencyHz 4, dampingRatio 0.7, wheel r 0.4, friction 0.9)](https://github.com/piqnt/planck.js/blob/master/example/Car.ts)
- [npm — `planck` package (v1.5.0, MIT)](https://www.npmjs.com/package/planck)
- [X-Moto on GitHub (GPL — concepts only)](https://github.com/xmoto/xmoto)
- [X-Moto `bin/Physics/original.xml` — published parameter defaults](https://github.com/xmoto/xmoto/blob/master/bin/Physics/original.xml)
- [X-Moto — Wikipedia (ODE/Chipmunk engine, head-collision death)](https://en.wikipedia.org/wiki/X-Moto)
- [Moto X3M — Coolmath Games](https://www.coolmathgames.com/0-moto-x3m)
- [Moto X3M stunt/landing guide](https://martialpeakmanga.com/reviews/moto-x3m-online-guide-for-performing-the-perfect-stunt)
- [Trials Fusion review — weight/lean feel (VentureBeat)](https://venturebeat.com/games/trials-fusion-is-a-beautiful-poem-of-physics-and-motion/)
- [StonkRider — official site](https://stonkrider.com/)
- [Emanuele Feronato — Box2D car/truck with motors and shocks](https://emanueleferonato.com/2011/08/22/step-by-step-creation-of-a-box2d-cartruck-with-motors-and-shocks/)
- [iforce2d — top-down car physics (grip via lateral velocity)](https://www.iforce2d.net/b2dtut/top-down-car)
