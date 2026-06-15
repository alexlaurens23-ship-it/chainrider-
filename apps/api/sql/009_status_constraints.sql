-- 009_status_constraints.sql  (P7.4 follow-up — CRITICAL, owner pastes in Supabase SQL editor)
--
-- ROOT CAUSE of "runs never verify / windows never close / no payouts ever":
-- the pre-existing dashboard CHECK constraints on these tables NEVER allowed the
-- application's status vocabulary. Proven against the live DB:
--   cr_runs.verify_status has only ever held 'failed' / 'pending' — writing
--     'verified' is REJECTED by cr_runs_verify_status_check, so every run that
--     passes verification silently stays 'pending' (the UPDATE is refused).
--   cr_payout_windows.status has only ever held 'open' — closeWindow() writes
--     'settled', REJECTED by cr_payout_windows_status_check, so windows never
--     close and no payouts are ever created.
--
-- The app vocabulary is correct and consistent (verified/flagged/failed/pending;
-- open/settled; pending/paid/skipped). This widens the DB constraints to match.
-- Non-destructive + idempotent: existing rows ('pending','failed','open') all
-- satisfy the new constraints, so ADD validates cleanly.

-- cr_runs.verify_status — allow the full P6/P7 verification vocabulary.
alter table cr_runs drop constraint if exists cr_runs_verify_status_check;
alter table cr_runs add constraint cr_runs_verify_status_check
  check (verify_status in ('pending', 'verified', 'flagged', 'failed'));

-- cr_payout_windows.status — allow the close path's 'settled' (keep 'open').
-- ('closed' included defensively in case any tooling uses it.)
alter table cr_payout_windows drop constraint if exists cr_payout_windows_status_check;
alter table cr_payout_windows add constraint cr_payout_windows_status_check
  check (status in ('open', 'settled', 'closed'));

-- cr_payouts.status — allow the admin lifecycle (pending → paid / skipped).
alter table cr_payouts drop constraint if exists cr_payouts_status_check;
alter table cr_payouts add constraint cr_payouts_status_check
  check (status in ('pending', 'paid', 'skipped'));
