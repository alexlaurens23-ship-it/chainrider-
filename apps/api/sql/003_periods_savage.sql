-- CHAINRIDER P4.5 — drop CHILL / add SAVAGE tier, switch periods to 1Y/6M/3M,
-- reprice the ladder. Paste into the Supabase SQL editor AFTER 002. DESTRUCTIVE:
-- clears maps/tracks (0 cr_runs / cr_payouts reference them) so the new seed
-- recreates them cleanly. See 003_clean.sql for the comment-free version.

-- 1. Clear old data (old tier vocabulary + old periods are incompatible).
delete from cr_tracks;
delete from cr_maps;

-- 2. Tier ladder: VOLATILE / DEGEN / SAVAGE (no CHILL).
alter table cr_tracks drop constraint if exists cr_tracks_tier_check;
alter table cr_tracks add constraint cr_tracks_tier_check
  check (tier in ('VOLATILE', 'DEGEN', 'SAVAGE'));

-- 3. Periods: 1Y / 6M / 3M.
alter table cr_maps drop constraint if exists cr_maps_period_check;
alter table cr_maps add constraint cr_maps_period_check
  check (period in ('1Y', '6M', '3M'));

-- 4. Prize ladder — all three tiers pay, shifted harder.
update cr_config set value = jsonb_build_object(
  'VOLATILE', jsonb_build_array(0.03, 0.015, 0.008),
  'DEGEN', jsonb_build_array(0.07, 0.035, 0.015),
  'SAVAGE', jsonb_build_array(0.15, 0.08, 0.04)
) where key = 'prize_ladder';
