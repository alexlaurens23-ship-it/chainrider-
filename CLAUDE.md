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
    src/scoring.ts            TIME-PRIMARY scoring (sole impl): SCORING_CONFIG (baseFinish/speedExp/trickWeight/crashTimePenaltyMs/parPaceMps) + computeFinalScore (par/effectiveTime^1.5 + 0.15×trick garnish; DNF=trick only) + updateScore (rawTrickPoints accumulation; crash adds time not −points). SCORING = trick-detection values.
    src/terrain.ts            Pure polyline geometry: y/slope at x, wrapAngle, swept head-circle death check.
    src/constants.ts          SIM_DT, gravity, iterations, SIM_VERSION=9 (bump on any physics/scoring change), lead-in/run-out/checkpoint/freeze constants.
    src/types.ts              INPUT bitmask (1 thr/2 brk/4 leanL/8 leanR/16 jump), BikeTune + DEFAULT_TUNE, Sim, SimSnapshot, TrackInfo, FinalResult.
    test/{grounded,scoring,respawn}.test.ts  Vitest (`npm test -w @chainrider/physics`): incline climb + hard-landing + bit-identical replay; time-primary anti-exploit; respawn clearance (both wheels above terrain at every checkpoint incl. 40° incline).
apps/
  web/                        Vite + vanilla TS. Hash-routed SPA: #/ home, #/map/:slug/:period, #/ride/:trackId, #/playground.
    vite.config.ts            Dev server pinned to :5180 (strictPort) + /api proxy -> :8787.
    index.html                #app root + full <style> (palette, pages, ride HUD, run-complete card).
    src/main.ts               Mounts the router into #app.
    src/router.ts             Hash router: parse #hash → screen {mount(root,params)/unmount()}; toggles body.no-scroll for game screens. #/map/:slug/:period[/:tier] (4-seg = tier deep-link).
    src/net.ts                apiFetch + typed fetchers + in-memory caches. Tier/TierTracks types; MapEntry.tiers{CHILL,VOLATILE,DEGEN}{prize,raw,smooth} (legacy difficulty/tracks intentionally omitted from the type).
    src/ui/format.ts          difficultyColor + tierColor (CHILL mint/VOLATILE amber/DEGEN red), formatSol/Score/Clock/Countdown.
    src/ui/sparkline.ts       drawSparkline (home cards). ui/chartPreview.ts: drawChartPreview (map detail, green-up/red-down + fill).
    src/shared/bike.ts        drawBike — shared bike renderer (ride + playground).
    src/screens/home.ts       Hero + live stats strip (/api/stats) + trending cards (sparkline + 3 prized tier chips CHILL/VOLATILE/DEGEN deep-linking to map+tier) + UTC payout countdown.
    src/screens/mapDetail.ts  TIER selector (primary, default VOLATILE) × RAW/SMOOTH mode → map.tiers[tier][mode]: drives chart preview, stats row + tier badge, prize ladder, leaderboard (empty until P7, keyed to track), RIDE target.
    src/screens/ride.ts       Wires fetch→loop+renderer+hud+input+run-complete; Submit posts real payload to /api/runs/submit.
    src/ride/loop.ts          Fixed-timestep ride loop; change-only [tick,keymask] log (P6 replay); maxCombo/air/speed tracking; 20-min (72000-tick) cap; respawn/quit.
    src/ride/render.ts        Camera (smoothed lookahead + speed zoom 1.0→0.8, kill-floor clamp); terrain culled via binary search (visibleRange) + green/red glow + gradient fill + gridlines; baked minimap + position dot.
    src/ride/chart.ts         segmentColor (up=green/down=red) + visibleRange (binary-search cull). ride/hud.ts: DOM HUD. ride/input.ts: keymask+R/M/Esc+dispose. ride/runComplete.ts: star card (STAR_FRACTIONS × maxScore) + toast.
    src/playground/loop.ts    startPlayground(root)→{unmount}; tuning rig under #/playground (uses shared drawBike).
    src/playground/{track,input,render,panel,hud,selftest}.ts  TEST_TRACK, keymask, renderer, tune sliders, HUD, determinism self-test.
  api/                        Fastify on :8787 (ESM, tsx dev). Track pipeline + game endpoints live.
    src/trackgen.ts           PURE deterministic generation: downsample/normalize (6m/candle, vol-scaled 25–90m band, 55° global clamp)/rawTrack/smoothTrack (Catmull-Rom)/stats/difficultyFor. TIERS: amplify(×factor from mean line)/roughness(seeded hashPoints+mulberry32 bumps, never Math.random)/clampSlopeSegments(per-segment 55° cap → sustained challenge)/generateTier(CHILL≡normalize byte-identical; VOLATILE ×1.8+0.4; DEGEN ×2.8+0.9). Golden-tested.
    src/chartdata.ts          fetchCloses(source, sourceId, period): CoinGecko (daily-bucketed; optional COINGECKO_API_KEY for ALL/days=max) + GeckoTerminal ("network:pool" source_id). Retry ×3 expo backoff, Retry-After honored. ONLY place external APIs are called.
    src/db.ts                 Lazy service-role Supabase client (getDb).
    src/routes/tracks.ts      mapsRoutes (GET /api/maps: per-map tiers{CHILL/VOLATILE/DEGEN}{raw,smooth,prize} + legacy difficulty/tracks from VOLATILE for the pre-tier UI; tier-keyed prizeLadder) + tracksRoutes (GET /api/tracks/:id: frozen points + tier, served even when inactive).
    src/routes/admin.ts       X-Admin-Key gated (fail closed): POST /maps (fetch→generateAllTiers: 3 tiers × 2 modes = 6 frozen tracks v1, par per tier from SCORING_CONFIG.parPaceMps; no map difficulty), POST /maps/:id/regenerate (version n+1, old rows only get active=false).
    src/routes/stats.ts       GET /api/stats: {ridesCompleted, totalSolPaid, config:{windowMinutes,maxScoreDefault}}. Never 500s (Home must render).
    src/routes/leaderboards.ts GET /:trackId → [] until P7 (top-10 stub). runs.ts: POST /submit accepts real payload incl. input log, stores nothing yet (P6).
    src/routes/*.ts           auth/payouts plugin stubs ({todo:true}).
    sql/001_track_pipeline.sql Reference DDL for live schema + hardening (freeze trigger, unique indexes, period-constraint widening). Owner applies in Supabase SQL editor.
    sql/002_terrain_tiers.sql DESTRUCTIVE tier migration: wipe pre-tier maps/tracks, drop cr_maps.difficulty, add cr_tracks.tier (CHILL/VOLATILE/DEGEN) + (map,tier,mode) unique indexes + freeze-guard incl. tier, retier prize_ladder. Owner pastes into Supabase SQL editor BEFORE reseeding.
    scripts/seed-maps.ts      Seeds 4 coins (BTC/ETH/SOL/DOGE) at 1Y via admin HTTP API → 3 tiers × 2 modes = 24 tracks. Idempotent (409=skip), 15s between calls. `npm run seed -w @chainrider/api`.
    scripts/gen-golden.ts     Regenerates golden strings for trackgen tests (normalize + per-tier; only on deliberate algorithm changes).
    test/trackgen.test.ts     Vitest (27): golden byte-identical (normalize + CHILL≡normalize + VOLATILE/DEGEN) + tier escalation + property tests.
    .env.example              SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, ADMIN_KEY, COINGECKO_API_KEY (optional, needed for ALL maps).
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
- Wheelie recovery assist (2026-06-12): new tune param `wheelieRecoveryBoost` (default 1.7) — applied attitude torque is multiplied by it while holding lean-forward with rear wheel grounded + front airborne (decay state not boosted; all other states unchanged). Slider added. `SIM_VERSION=4`. Verified: verify clean + bit-identical double replay.
- **P2 complete — tune locked** (2026-06-12): final DEFAULT_TUNE locked from the playground (only delta from v1: attitudeMin 5.5 → **8.5**; wheelieRecoveryBoost 1.7 + chassisSpinCap 6.5 included). `SIM_VERSION=5`. Verified: verify clean + determinism smoke ×10 bit-identical.

- **P2.1 — arcade grounded stabilization layer** (2026-06-12): four grounded-only assists in `stepSim`, every one gated on ≥1 wheel grounded (fully-airborne ticks run the pre-P2.1 code paths — locked air feel untouched): (1) PD auto-stabilizer pulling chassis toward the direction-averaged terrain slope under the wheels (`stabilizerStrength` 90, `stabilizerDamping` 12; any lean input drops authority to 30% so deliberate wheelies/manuals win; off during crash freeze), (2) motor torque taper — full to 40% of maxOmega, then linear to `torqueFalloffFloor` 0.35 at maxOmega, (3) hill traction assist — throttle uphill >15°: force along surface = `hillAssist` 0.45 × m·g·sin(slope); zero downhill/in air, (4) anti-wheelie bias — grounded throttle torque scaled linearly to `antiWheelieFloor` 0.4 between 25°→50° nose-up vs slope, bypassed entirely while lean-back held. `maxMotorTorque` 60 → **41**. `SIM_VERSION=6`. New vitest suite in `packages/physics/test/` (vitest devDep). Verified: verify clean, tests pass (climb reaches top with ≤8° pitch error), 10× dist replay bit-identical, flat full-throttle max pitch 9.5° vs deliberate wheelie unrestricted.

- **P3 — track pipeline** (2026-06-12): full chart→track pipeline in `apps/api`. Pure deterministic `trackgen.ts` (downsample ≤1000 candles for ALL, normalize 6m/candle + vol-scaled 25–90m band + 55° slope clamp via single global y-rescale, centripetal Catmull-Rom smooth mode resampled 1 vtx/m with monotonic-x guard, stats/difficulty easy<20°/med<32°/hard<45°/insane≥45° from raw) — golden-tested byte-identical (21 vitest tests). `chartdata.ts` fetchers (CoinGecko + GeckoTerminal, retry ×3). Routes: GET /api/maps, GET /api/tracks/:id, admin POST /maps + /maps/:id/regenerate (X-Admin-Key, fail-closed). Discovered the **live Supabase schema pre-exists** (integer ids; cr_tracks has FLAT stats columns point_count/world_length/max_slope_deg/volatility/par_time_ms, NOT jsonb; cr_config prize_ladder is per-difficulty arrays) — code adapted to it; `sql/001_track_pipeline.sql` is reference + optional hardening. **Period vocabulary is uppercase `90D|180D|1Y|ALL`** (live cr_maps check constraint currently allows only 1Y/ALL; widening statement in sql file). Seeded + verified live end-to-end: btc-1y (regenerated to v2; v1 frozen-but-servable confirmed), eth-1y, sol-1y. Verify + tests clean.

- **P4/P5 — playable game UI** (2026-06-13): hash-routed SPA in `apps/web` (router + screen lifecycle replacing the single-canvas mount; playground refactored to `startPlayground(root)→{unmount}` under `#/playground`). **Home** (`#/`): hero, live stats strip from new `GET /api/stats`, trending cards (per-map sparkline from raw track points, difficulty badge, rank-1 SOL prize), UTC-aligned 30-min payout countdown (client-computed). **Map detail** (`#/map/:slug/:period`): full chart preview (green-up/red-down + fill), period tabs (siblings grouped by symbol), RAW/SMOOTH toggle, stats row + prize ladder, top-10 leaderboard (empty-state; `GET /api/leaderboards/:trackId` stubbed `[]`), RIDE button. **Ride** (`#/ride/:trackId`): fetches frozen points → `createSim` → P2 fixed-timestep loop; camera with smoothed lookahead + speed zoom (1.0→0.8) + kill-floor clamp; terrain = the chart, **culled via binary-search `visibleRange`** so per-frame work is bounded by visible segments (verified: 40m window over a 1255-pt track touches <15 segments → offscreen-cache fallback not needed); green/red glow + gradient fill + gridlines; DOM HUD (score/combo/air/clock/minimap/legend); change-only `[tick,keymask]` input log (the P6 replay), 20-min cap; run-complete card (star rating = `STAR_FRACTIONS` × `max_score_per_track_default`, flips/crashes/combo/time grid, Submit posts real payload to stub `POST /api/runs/submit`, Retry, New Track). Zero physics/scoring in web (shared `drawBike` is the only extracted render logic). Verified: `npm run verify` clean (all 4 workspaces), web `vite build` clean (29 modules), API endpoints return correct shapes, dev-server `/api` proxy works end-to-end, terrain-culling logic check passed. **Not browser-verified** (no automation tool in this env): live rendering/camera feel + the actual ride loop need a manual pass at `http://localhost:5180/#/`.

- **P4.1 — crash on head contact only** (2026-06-13): removed the hard-landing-impulse crash trigger from `stepSim` (old condition D) and the post-solve chassis/wheel impulse accumulator that fed it (plus the now-dead `tickMaxImpulse`/`headContact` Sim fields). Crash now fires ONLY on head-vs-track contact — `isHeadTouching` (head sensor) or `sweptCircleHitsTerrain` (swept head circle) — or `pos.y < killY` (the void). The chassis box + wheels resting/grazing/bottoming on terrain at any angle or speed is never a crash; the box stays a solid colliding fixture. `landingAligned` kept (scoring's clean-landing detector still uses it); `hardLandingImpulse` left in `BikeTune` (unused by sim, still a panel slider). `SIM_VERSION=7`. New vitest regression: an 8 m drop landing wheels-down keeps `crashes===0`. Verified: verify clean (all 4 workspaces), 3/3 physics tests pass incl. bit-identical replay.

- **P4.2 — time-primary scoring + terrain tiers + DOGE** (2026-06-14): bike tune LOCKED (unchanged). **(A) Scoring** reworked time-primary in `scoring.ts`: `score = speedScore + trickBonus`, `speedScore = round(10000·(par/effectiveTime)^1.5)` at finish only, `effectiveTime = finishTime + crashes·3000ms`, `trickBonus = round(rawTrickPoints·0.15)`; DNF = trickBonus only. Crashes no longer subtract points (they cost time); trick detection unchanged (feeds rawTrickPoints). `SCORING_CONFIG` holds all knobs incl. `parPaceMps {CHILL:9,VOLATILE:8,DEGEN:7}`. `computeFinalScore` is a pure exported fn (anti-exploit tested: fast clean > slow+flips+crashes; DNF < finish). Snapshot/FinalResult expose speedScore/trickBonus/effectiveTimeMs. `SIM_VERSION=8`. **(B) Terrain tiers** in `trackgen.ts`: amplify(deviation from mean line ×factor) + roughness(seeded hashPoints→mulberry32, NEVER Math.random) + per-segment 55° clamp (replaces global rescale for tiers → sustained ~55°, not one spike). `generateTier`: CHILL≡normalize byte-identical (existing goldens intact), VOLATILE ×1.8/0.4, DEGEN ×2.8/0.9. Each (map,tier,mode) = a frozen track with per-tier par. `/api/maps` additive: per-map `tiers{}` + legacy difficulty/tracks (from VOLATILE) so the pre-tier UI keeps working; prize_ladder tier-keyed (CHILL/VOLATILE/DEGEN). DOGE added (uncorrelated). Run-complete card shows speed/trick split + time+crash-penalty. Verified: `npm run verify` clean, 8/8 physics + 27/27 api tests pass, real-data smoke (BTC/DOGE 1Y): steep-segment density escalates CHILL→VOLATILE→DEGEN (BTC 1→3→30, DOGE 1→6→20 of 364) and DOGE differs from BTC. **NOT yet applied live** (no Postgres DDL channel here): owner must paste `sql/002_terrain_tiers.sql` then `npm run seed -w @chainrider/api` → 24 tracks.

- **P4.2 applied live** (2026-06-14): owner pasted `sql/002` (+ a follow-up `alter table cr_tracks drop constraint cr_tracks_map_id_mode_version_key` — a pre-existing dashboard constraint that omitted tier; now folded into the 002 files). Seeded 4 coins → **24 tracks** verified via `/api/maps` (per-tier par 243/273/312 s, DEGEN steepest). Migration fix committed as P4.2a.

- **P4.4 — fix checkpoint respawn clipping** (2026-06-14): respawn placed the chassis from terrain height at the checkpoint x only, but `setBikePose` puts the wheels at `x ± wheelbase/2` where, on a slope, the uphill wheel's terrain is `≈halfBase·tan(slope)` higher → that wheel spawned under the surface (≈0.61 m at 40°). Fix in `buildTrackInfo`: checkpoint Y now lifts above the **max terrain under the whole bike footprint** (`maxTerrainBetween` over `x ± max(wheelbase/2, chassisWidth/2)`, including any peak vertex) + wheelRadius + axleDropY + `SPAWN_CLEARANCE` (0.02 → **0.3 m**), so both wheel bottoms clear their local terrain on any slope and the bike drops/settles. Upright, zero velocity unchanged. `SIM_VERSION=9`. New `respawn.test.ts` (both wheels above terrain at every checkpoint on a 40° incline); verified on real BTC DEGEN smooth track (worst gap exactly 0.30 m, 0 penetration). verify + 9/9 physics tests pass.

- **P4.3 — tier selection UI** (2026-06-14): Home/MapDetail now drive all three tiers from `map.tiers[]` (no physics/scoring change). **Home** cards: removed the stale legacy badge; each card = a coin link (symbol + neutral-cyan sparkline from the VOLATILE track) + a row of **3 prized tier chips** (CHILL mint 0.02 / VOLATILE amber 0.05 / DEGEN red 0.12, DEGEN glowing), each deep-linking to `#/map/:slug/:period/:tier`. **MapDetail**: new TIER selector (primary, above RAW/SMOOTH) defaulting VOLATILE; tier × mode → `map.tiers[tier][mode]` drives chart preview, stats row + tier badge, full prize ladder, leaderboard (still P7 empty-state, keyed to the selected track), and RIDE target — all 6 tracks/coin reachable. `tierColor` added to `ui/format.ts`; router gains a 4-seg tier deep-link route. Reverted the temp `LEGACY_TIER=DEGEN` hack back to VOLATILE. Verified: `npm run verify` clean, web `vite build` clean, `/api/maps` carries per-tier prizes + raw/smooth trackIds for all 24. **Single-player feature-complete.**

**In progress**
- Nothing.

**Next**
- **API cleanup (later)**: the legacy `difficulty` + `tracks` fields in `/api/maps` (`tracks.ts`, backed by `LEGACY_TIER`) are now superseded by the tier UI and unread by the client — drop them from the route + `cr_tracks` legacy plumbing once confirmed nothing else reads them.
- **Manual browser pass**: walk `#/` (4 coins × 3 tier chips) → `#/map/btc-1y/1Y/DEGEN` (tier selector swaps preview/stats/prize/ride) → a ride to finish + Submit; confirm run-complete speed/trick breakdown; `#/playground` self-test still PASSes.
- **P6/P7**: server re-sim validation of submitted runs (`/api/runs/submit`) + real per-tier leaderboards (`/api/leaderboards/:trackId`).
- **ALL-period maps still blocked**: CoinGecko keyless+demo key both 401 on `days=max` (365-day cap is paid-only — confirmed). Decision taken: **add a Binance source** (free, full history via weekly klines) — not yet built. Needs `cr_maps` source check widened to include `binance` + a `chartdata.ts` Binance fetcher.
- Owner: apply the HARDENING section of `apps/api/sql/001_track_pipeline.sql` in the Supabase SQL editor (freeze trigger, unique indexes, period-constraint widening for 90D/180D memecoin maps).
- Memecoin maps: paste GeckoTerminal pool addresses into the two placeholders in `apps/api/scripts/seed-maps.ts`.
- Difficulty calibration: all three 1Y majors land "insane" (real daily candles at 6m spacing are steep) — thresholds or SPACING_M may need a pass once playable.
- Neon bike renderer per Appendix B (replace primitive shapes); rear light ribbon.
- API: wire `simulateReplay` into run submission validation (P6) — `cr_runs` already exists in the live schema.

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
