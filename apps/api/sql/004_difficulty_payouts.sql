-- CHAINRIDER P4.6 — steepness-graded payout pool. Paste into the Supabase SQL
-- editor AFTER 003. NON-destructive (adds columns/constraint/config only). See
-- 004_clean.sql for the comment-free version. After applying, run the backfill
-- (`npm run backfill -w @chainrider/api`) to populate difficulty_score.

-- 1. Steepness grade per track. NOT frozen (re-gradable) → intentionally absent
-- from cr_tracks_freeze_guard, so a difficulty_score-only update is allowed.
alter table cr_tracks add column if not exists difficulty_score numeric;

-- 2. Whether a run reached the finish (set by P6 re-sim). Payouts require a
-- verified FINISHING run; cr_runs is empty today so the default is harmless.
alter table cr_runs add column if not exists finished boolean not null default false;

-- 3. One payout per (window, track) — the idempotency backstop for closeWindow.
alter table cr_payouts drop constraint if exists cr_payouts_window_track_uniq;
alter table cr_payouts add constraint cr_payouts_window_track_uniq unique (window_id, track_id);

-- 4. Rule-based paying pool (top-20 by difficulty_score). Amounts by RANK, not
-- by track id, so re-grading reshuffles the pool automatically. Max 1.6 SOL/win.
insert into cr_config (key, value) values (
  'payout_tiers',
  jsonb_build_object(
    'poolSize', 20,
    'rules', jsonb_build_array(
      jsonb_build_object('maxRank', 1, 'sol', 0.2),
      jsonb_build_object('maxRank', 10, 'sol', 0.1),
      jsonb_build_object('maxRank', 20, 'sol', 0.05)
    )
  )
) on conflict (key) do update set value = excluded.value;
