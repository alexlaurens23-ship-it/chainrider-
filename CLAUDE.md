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
    src/scoring.ts            TIME-PRIMARY scoring (sole impl): SCORING_CONFIG (baseFinish/speedExp/trickWeight/crashTimePenaltyMs/parPaceMps {VOLATILE:8,DEGEN:7,SAVAGE:6}) + computeFinalScore (par/effectiveTime^1.5 + 0.15×trick garnish; DNF=trick only) + updateScore. SCORING = trick-detection values.
    src/sim.ts (control)      stepSim drive block: LOW-SPEED LAUNCH ASSIST (grounded+throttle+preSpeed<launchSpeedThreshold(3) → motorTorque ×launchBoost(1.8) → ×1 above) + CONTEXT-AWARE REVERSE (forwardVel>reverseEngageSpeed(1.5) or airborne → brakes unchanged; else grounded crawl → rear motor reverses at reverseMotorTorque(60)/reverseMotorSpeed(17), capped reverseMaxSpeed(5.5)) + REVERSE INCLINE TRACTION (reversing up a slope < -reverseHillMinSlopeDeg(15°) → chassis surface force ×reverseHillAssist(0.5)·m·g·sin, grip-independent — climbs out of steep Vs; mirrors hillAssist). General handling otherwise locked.
    src/terrain.ts            Pure polyline geometry: y/slope at x, wrapAngle, swept head-circle death check.
    src/constants.ts          SIM_DT, gravity, iterations, SIM_VERSION=12 (bump on any physics/scoring change), lead-in/run-out/checkpoint/freeze constants.
    src/types.ts              INPUT bitmask, BikeTune + DEFAULT_TUNE (incl. launchSpeedThreshold/launchBoost), Sim, SimSnapshot, TrackInfo, FinalResult.
    test/{grounded,scoring,respawn,launch,reverse}.test.ts  Vitest (15): incline climb + hard-landing + bit-identical replay; anti-exploit; respawn clearance; launch assist; context-aware reverse (forward brake decelerates > coast; standstill S backs up >3m, capped; steep-V escape: reverses up out of a 45° valley, assist > no-assist control).
apps/
  web/                        Vite + vanilla TS. Hash-routed SPA: #/ home, #/map/:slug/:period, #/ride/:trackId, #/playground.
    vite.config.ts            Dev server pinned to :5180 (strictPort) + /api proxy -> :8787.
    index.html                #app root + full <style> (palette, pages, ride HUD, run-complete card).
    src/main.ts               Mounts the router into #app.
    src/router.ts             Hash router: parse #hash → screen {mount(root,params)/unmount()}; toggles body.no-scroll for game screens. #/map/:slug/:period[/:tier] (4-seg = tier deep-link).
    src/net.ts                apiFetch + typed fetchers + in-memory caches. Tier/TierTracks types; MapEntry.tiers{VOLATILE,DEGEN,SAVAGE}{prize,raw,smooth}.
    src/ui/format.ts          difficultyColor + tierColor (VOLATILE amber/DEGEN red/SAVAGE magenta), formatSol/Score/Clock/Countdown.
    src/ui/sparkline.ts       drawSparkline (home cards). ui/chartPreview.ts: drawChartPreview (map detail, green-up/red-down + fill).
    src/shared/bike.ts        drawBike — shared bike renderer (ride + playground).
    src/screens/home.ts       Hero + live stats strip + trending cards — ONE per coin (groups the 18 maps by symbol, picks the 1Y map; clean symbol+name+sparkline, links to MapDetail) + UTC payout countdown.
    src/screens/mapDetail.ts  Period tabs (1Y/6M/3M, siblings by symbol) × TIER selector (VOLATILE/DEGEN/SAVAGE, default VOLATILE) × RAW/SMOOTH → map.tiers[tier][mode]: chart preview, stats + tier badge, prize ladder, leaderboard, RIDE target.
    src/screens/ride.ts       Wires fetch→loop+renderer+hud+input+run-complete; run AUTO-SUBMITS on end (finish/quit) via the card's autoSubmit (no Submit button).
    src/ride/loop.ts          Fixed-timestep ride loop; change-only [tick,keymask] log (P6 replay); maxCombo/air/speed tracking; 20-min (72000-tick) cap; respawn/quit.
    src/ride/render.ts        Camera (smoothed lookahead + speed zoom 1.0→0.8, kill-floor clamp); terrain culled via binary search (visibleRange) + green/red glow + gradient fill + gridlines; baked minimap + position dot.
    src/ride/chart.ts         segmentColor (up=green/down=red) + visibleRange (binary-search cull). ride/hud.ts: DOM HUD. ride/input.ts: keymask+R/M/Esc+dispose. ride/runComplete.ts: star card + speed/trick breakdown + auto-submit status line (Saving→Saved/Save failed) + Retry/New Track.
    src/playground/loop.ts    startPlayground(root)→{unmount}; tuning rig under #/playground (uses shared drawBike).
    src/playground/{track,input,render,panel,hud,selftest}.ts  TEST_TRACK, keymask, renderer, tune sliders, HUD, determinism self-test.
  api/                        Fastify on :8787 (ESM, tsx dev). Track pipeline + game endpoints live.
    src/trackgen.ts           PURE deterministic generation: normalize/rawTrack/smoothTrack/stats. TIERS=VOLATILE(×1.8,0.4)/DEGEN(×2.8,0.9)/SAVAGE(×3.6,1.2) via amplify+roughness(seeded)+per-segment-55°-clamp. generateTier(closes,tier,periodAmp=1); PERIOD_AMPLITUDE{1Y:1,6M:1.25,3M:1.5}. stats() also returns difficultyScore = steep-segment density (>35°) + avg-slope×1e-6 tiebreak, round8 (the payout-pool grade). Golden-tested.
    src/chartdata.ts          fetchCloses(source, sourceId, period): Period=1Y/6M/3M → CoinGecko days 365/180/90 (daily-bucketed) + GeckoTerminal. Retry ×3 expo backoff. ONLY place external APIs are called.
    src/db.ts                 Lazy service-role Supabase client (getDb).
    src/routes/tracks.ts      mapsRoutes (GET /api/maps: per-map tiers{VOLATILE/DEGEN/SAVAGE}{raw,smooth,prize} + legacy difficulty/tracks from VOLATILE; tier-keyed prizeLadder) + tracksRoutes (GET /api/tracks/:id: frozen points + tier).
    src/routes/admin.ts       X-Admin-Key gated: POST /maps (fetch period closes→generateAllTiers: 3 tiers × 2 modes = 6 frozen tracks, tier amplify ×PERIOD_AMPLITUDE[period], par per tier), POST /maps/:id/regenerate.
    src/routes/stats.ts       GET /api/stats: {ridesCompleted, totalSolPaid, config:{windowMinutes,maxScoreDefault}}. Never 500s (Home must render).
    src/routes/payoutPool.ts  GET /api/payout-pool: live top-20 hardest tracks by difficulty_score → {rank, prizeSol, difficultyScore, symbol/period/tier/mode}. Rule-based (cr_config.payout_tiers), reshuffles on re-grade. Max 1.6 SOL/window.
    src/payouts.ts            Payout domain (pure + testable): rankPool/prizeForRank/computeWindowPayouts (one winner per paying track = top verified FINISHING run; no finisher → no payout) / closeWindow(repo,windowId) (idempotent via paid-track filter + unique(window_id,track_id)) / PayoutRepo + createSupabaseRepo. P7 cron will call closeWindow.
    src/routes/leaderboards.ts GET /:trackId → [] until P7. runs.ts: POST /submit accepts payload, stores nothing yet (P6).
    src/routes/*.ts           auth/payouts plugin stubs ({todo:true}).
    sql/001_track_pipeline.sql Reference DDL for live schema + hardening (freeze trigger, unique indexes, period-constraint widening). Owner applies in Supabase SQL editor.
    sql/002_terrain_tiers.sql DESTRUCTIVE tier migration (P4.2): tier column + indexes + freeze-guard. (superseded by 003.)
    sql/003_periods_savage.sql + 003_clean.sql  DESTRUCTIVE (P4.5): wipe maps/tracks, tier→(VOLATILE,DEGEN,SAVAGE), period→(1Y,6M,3M), reprice prize_ladder. Owner pastes 003_clean.sql BEFORE reseeding.
    sql/004_difficulty_payouts.sql + 004_clean.sql  NON-destructive (P4.6): add cr_tracks.difficulty_score (NOT frozen) + cr_runs.finished + cr_payouts unique(window_id,track_id) + cr_config.payout_tiers (poolSize 20, rank rules 0.2/0.1/0.05). Owner pastes 004_clean.sql, THEN run backfill.
    scripts/seed-maps.ts      Seeds 6 coins × 3 periods → 108 tracks via admin HTTP. `npm run seed -w @chainrider/api`.
    scripts/backfill-difficulty.ts  Backfills cr_tracks.difficulty_score for all tracks from stored points (reads points, writes only difficulty_score → passes freeze guard; idempotent). `npm run backfill -w @chainrider/api` (after sql/004).
    scripts/gen-golden.ts     Regenerates golden strings for trackgen tests (only on deliberate algorithm changes).
    test/{trackgen,payouts}.test.ts  Vitest (37): points goldens byte-identical + stats incl. difficultyScore; payout rankPool/computeWindowPayouts/closeWindow (3 payouts, no-finisher skip, idempotent re-close).
    .env.example              SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, ADMIN_KEY, COINGECKO_API_KEY.
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

- **P4.5 — auto-submit, SAVAGE tier, low-speed launch, multi-period, memecoins** (2026-06-14): **(A)** run-complete card AUTO-SUBMITS on end (finish/quit) with a Saving→Saved/Failed status; Submit button removed (Retry/New Track kept). **(B)** Home decluttered → one card per coin (no tier chips). **(C)** tier ladder dropped CHILL, now VOLATILE/DEGEN/SAVAGE (new hardest: amplify ×3.6, roughness 1.2, par pace 6, magenta `#e23bff`); prizes all paid+shifted (VOLATILE [0.03,0.015,0.008] / DEGEN [0.07,0.035,0.015] / SAVAGE [0.15,0.08,0.04]). **Low-speed launch assist** in `stepSim` (the ONLY handling change): grounded+throttle+preSpeed<3m/s → motorTorque×1.8 scaling to ×1 at 3m/s, zero above — makes steep standstills recoverable, normal riding untouched. `SIM_VERSION=10`. **(D)** periods 1Y/6M/3M (CoinGecko 365/180/90d); `PERIOD_AMPLITUDE {1Y:1,6M:1.25,3M:1.5}` multiplies tier amplify so 3M is wildest; `generateTier(closes,tier,periodAmp=1)` keeps VOLATILE/DEGEN goldens byte-identical. **(E)** +2 memecoins POPCAT/BONK (data-validated best sustained rolling vol of WIF/PEPE/BONK/POPCAT; WIF unfetchable, PEPE quietest 3M). Verified: verify clean, 11/11 physics + 28/28 api tests, web build clean. **Applied live** (2026-06-14): owner pasted `sql/003_clean.sql`, seeded **108 tracks** confirmed via `/api/maps` (6 coins × 3 periods × 3 tiers, no CHILL).

- **P4.6 — steepness-graded payout pool (top 20 tracks)** (2026-06-14): no physics/frontend gameplay change. **(1)** `stats()` now returns deterministic `difficultyScore` = steep-segment density (>35°) + avg-slope×1e-6 tiebreak (round8); on cr_tracks via new `difficulty_score` column (NOT frozen → re-gradable); `scripts/backfill-difficulty.ts` recomputes it for all 108 from stored points (reads points, writes only the score → freeze guard untouched). **(2)** Paying pool = rule-based top-20 by score (`cr_config.payout_tiers`: poolSize 20, ranks 1/2-10/11-20 → 0.2/0.1/0.05 SOL; max 1.6/window); re-grading reshuffles automatically, no hardcoded ids. **(3)** `GET /api/payout-pool` returns the live top-20 with rank/prize/coin/period/tier/mode. **(4/5)** `payouts.ts`: pure `rankPool`/`computeWindowPayouts` + `closeWindow(repo,windowId)` — per paying track, the winner is the top VERIFIED FINISHING run (highest server_score); **a track with no finisher pays nothing** (no dead-window bleed); idempotent (app-level paid-track filter + DB `unique(window_id,track_id)`); per-track independent (a player can win N tracks → N payouts). Needs `cr_runs.finished` (added in migration; P6 re-sim populates it). `SIM_VERSION` unchanged. Verified: verify clean, 37/37 api tests (points goldens byte-identical), and a read-only report from stored points → **exact top-20 confirms the design**: all 20 are 3M; SAVAGE 12 / DEGEN 8; #1 = POPCAT 3M SAVAGE; total 1.6 SOL. **Applied live** (2026-06-14): owner pasted `sql/004_clean.sql`, backfilled all 108 (0 failures), and `/api/payout-pool` reproduced the exact top-20 (1.6 SOL, all 3M, SAVAGE 12/DEGEN 8, POPCAT 3M SAVAGE #1).

- **P4.7 — context-aware reverse** (2026-06-14): S/down (the brake bit) is now context-aware in `stepSim` — the ONLY handling change, all other tune locked. Moving forward (`forwardVel > reverseEngageSpeed` 1.5 m/s, chassis-forward projection) OR airborne → **brakes exactly as before** (byte-identical: rear motor 0 + rearBrakeTorque, front brake). Grounded + at/below crawl → **reverses**: rear motor positive (=backward) at `reverseMotorTorque` 30 / `reverseMotorSpeed` 12, thrust cut above `reverseMaxSpeed` 4 m/s; never airborne (no reverse thrust in air). Smooth (reverse motor decelerates residual forward roll then backs up — no snap). 4 new BikeTune fields + playground sliders. `SIM_VERSION=11`. New `reverse.test.ts` (forward brake decelerates > coast & stays forward; standstill S for 2 s backs up >3 m, grounded, capped). Verified: verify clean, 13/13 physics tests incl. bit-identical determinism replay.

- **P4.9 — reverse incline traction for steep-valley escape** (2026-06-15): P4.7 reverse couldn't climb out of a steep V — the rigid Box2D rear wheel slips on a 40-45° wall and the motor just spins. Fix (ONLY handling change; forward throttle/brake/lean/jump/suspension byte-identical): **(1)** bumped reverse power — `reverseMotorTorque` 30→60, `reverseMaxSpeed` 4→5.5, `reverseMotorSpeed` 12→17 (so 5.5 is reachable). **(2)** REVERSE INCLINE TRACTION ASSIST (the real fix, mirrors forward hillAssist): reversing + grounded + backing up a slope `< -reverseHillMinSlopeDeg`(15°) → apply a **chassis surface force** `reverseHillAssist`(0.5)·m·g·sin(slope) up-slope-and-backward. A body force is grip-independent, so rear-wheel micro-bounce no longer matters — chose this over scaling motor torque (which just spins a slipping wheel faster). **(3)** wheel restitution already 0 (default) — confirmed, no suspension change (preserves forward feel). 2 new BikeTune fields + sliders. `SIM_VERSION=12`. New steep-V escape test (settles at the bottom of a 45° V, holds reverse → climbs back up the entry wall; assist climbs dy≈8m vs no-assist control's ≈2m). Verified: verify clean, 15/15 physics tests incl. bit-identical determinism replay.

**In progress**
- Nothing.

**Next**
- **API cleanup (later)**: drop the legacy `difficulty`/`tracks` fields from `/api/maps` (superseded by tiers; unread by the client).
- **Manual browser pass**: Home (6 clean coin cards) → MapDetail period tabs (1Y/6M/3M) + tier selector (VOLATILE/DEGEN/SAVAGE) + mode reach every track, SAVAGE magenta/glow → ride to finish, confirm auto-submit status; `#/playground` self-test still PASSes.
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
