-- CHAINRIDER P4.2 — difficulty tiers (CHILL/VOLATILE/DEGEN). Paste into the
-- Supabase SQL editor AFTER 001. This is DESTRUCTIVE: it clears the pre-tier
-- maps/tracks (safe — there are 0 cr_runs / cr_payouts referencing them) so the
-- tier seed can recreate them cleanly.

-- 1. Clear the old pre-tier data.
delete from cr_tracks;
delete from cr_maps;

-- 2. Difficulty is now per-tier (on cr_tracks), not per-map.
alter table cr_maps drop column if exists difficulty;

-- 3. Add the tier column (table is empty, so NOT NULL is safe).
alter table cr_tracks add column if not exists tier text;
update cr_tracks set tier = 'CHILL' where tier is null;  -- no-op on empty table
alter table cr_tracks alter column tier set not null;
alter table cr_tracks drop constraint if exists cr_tracks_tier_check;
alter table cr_tracks add constraint cr_tracks_tier_check
  check (tier in ('CHILL', 'VOLATILE', 'DEGEN'));

-- 4. Uniqueness is now per (map, tier, mode).
drop index if exists cr_tracks_map_mode_version;
drop index if exists cr_tracks_one_active;
create unique index if not exists cr_tracks_map_tier_mode_version
  on cr_tracks (map_id, tier, mode, version);
create unique index if not exists cr_tracks_one_active
  on cr_tracks (map_id, tier, mode) where active;

-- 5. Freeze guard: tier joins the immutable columns (only active/par_time_ms mutable).
create or replace function cr_tracks_freeze_guard() returns trigger as $$
begin
  if new.points is distinct from old.points
     or new.point_count is distinct from old.point_count
     or new.world_length is distinct from old.world_length
     or new.max_slope_deg is distinct from old.max_slope_deg
     or new.volatility is distinct from old.volatility
     or new.map_id is distinct from old.map_id
     or new.tier is distinct from old.tier
     or new.mode is distinct from old.mode
     or new.version is distinct from old.version
     or new.created_at is distinct from old.created_at then
    raise exception 'cr_tracks rows are frozen: only "active"/"par_time_ms" may be updated';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists cr_tracks_freeze on cr_tracks;
create trigger cr_tracks_freeze before update on cr_tracks
  for each row execute function cr_tracks_freeze_guard();

-- 6. Prize ladder is now keyed by tier.
update cr_config
  set value = '{"CHILL":[0.02,0.01,0.005],"VOLATILE":[0.05,0.025,0.01],"DEGEN":[0.12,0.06,0.03]}'::jsonb
  where key = 'prize_ladder';
