-- 008: P7.1 — top-10 RAW-only paying pool + repriced ladder.
-- Paste into the Supabase SQL editor. Idempotent (a plain config update).
--
-- Pool = the 10 hardest RAW tracks by difficulty_score (smooth never pays).
-- Prize by pool rank: 1 → 0.2, 2-5 → 0.1, 6-10 → 0.05 SOL (max 0.85/window).
-- The RAW-only filter lives in the app (fetchPoolTracks / payout-pool route);
-- this just resets poolSize + the rank ladder in cr_config.

update cr_config
set value = '{"poolSize":10,"rules":[{"maxRank":1,"sol":0.2},{"maxRank":5,"sol":0.1},{"maxRank":10,"sol":0.05}]}'::jsonb
where key = 'payout_tiers';
