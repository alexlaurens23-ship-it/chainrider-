-- P9.5 — temporarily lift the cr_tracks freeze guard so the rideability
-- re-smooth (scripts/smooth-tracks.ts) can rewrite `points` + slope stats
-- IN PLACE (preserving ids + leaderboards; NOT a CoinGecko regen).
--
-- The freeze trigger normally allows updating only `active`/`par_time_ms`
-- (sql/001_track_pipeline.sql). The re-smooth changes points / point_count /
-- world_length / max_slope_deg / volatility too, so it must be disabled for
-- the duration of the script, then RE-ENABLED immediately after.
--
-- Owner steps (Supabase SQL editor):
--   1. Run STEP 1 below (disable the trigger).
--   2. Run:  npm run smooth-tracks -w @chainrider/api
--   3. Run STEP 2 below (re-enable the trigger).  ← do not skip; the freeze
--      rule is a launch safety guard.

-- STEP 1 — disable the freeze guard.
alter table cr_tracks disable trigger cr_tracks_freeze;

-- STEP 2 — re-enable the freeze guard (run AFTER the script completes).
-- alter table cr_tracks enable trigger cr_tracks_freeze;
