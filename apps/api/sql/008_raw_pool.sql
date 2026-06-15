-- 008: P7.1 — top-10 RAW-only paying pool + repriced ladder.
-- Paste into the Supabase SQL editor. Idempotent (a plain config update).
--
-- Pool = the 10 hardest RAW tracks by difficulty_score (smooth never pays).
-- Prize by pool rank: 1 -> 0.2, 2-5 -> 0.1, 6-10 -> 0.05 SOL (max 0.85/window).
-- The RAW-only filter lives in the app (fetchPoolTracks / payout-pool route);
-- this just resets poolSize + the rank ladder in cr_config.
--
-- Built with jsonb_build_object (not a long string literal) so the editor can't
-- wrap a CR into the JSON.

update cr_config
set value = jsonb_build_object(
  'poolSize', 10,
  'rules', jsonb_build_array(
    jsonb_build_object('maxRank', 1, 'sol', 0.2),
    jsonb_build_object('maxRank', 5, 'sol', 0.1),
    jsonb_build_object('maxRank', 10, 'sol', 0.05)
  )
)
where key = 'payout_tiers';
