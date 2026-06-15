-- 007: P7 payout admin (paste into the Supabase SQL editor).
-- Non-destructive + idempotent.
--
-- The admin panel can SKIP a pending payout (suspected cheat, dust, etc.) with
-- a note. That needs one new column. Status 'skipped' is app-level alongside the
-- existing 'pending'/'paid'. If cr_payouts.status has a CHECK constraint that
-- only allows pending/paid, widen it to include 'skipped' (uncomment below).

alter table cr_payouts add column if not exists skip_reason text;

-- If a status CHECK constraint exists and rejects 'skipped', recreate it:
-- alter table cr_payouts drop constraint if exists cr_payouts_status_check;
-- alter table cr_payouts add constraint cr_payouts_status_check
--   check (status in ('pending', 'paid', 'skipped'));
