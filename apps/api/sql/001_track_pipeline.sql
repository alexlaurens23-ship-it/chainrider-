-- CHAINRIDER track pipeline — REFERENCE + optional hardening.
--
-- NOTE: the live Supabase project already contains cr_maps / cr_tracks /
-- cr_config (created in the Supabase dashboard, outside this repo, with
-- integer identity ids and flat stats columns on cr_tracks). The CREATE
-- statements below document the shape the API code expects and are
-- idempotent (`if not exists`) so running this file against the live DB is
-- harmless. The HARDENING section at the bottom is new and recommended.

create table if not exists cr_maps (
  id          integer generated always as identity primary key,
  slug        text not null unique,
  symbol      text not null,
  name        text not null,
  source      text not null check (source in ('coingecko', 'geckoterminal')),
  source_id   text not null,
  period      text not null check (period in ('90D', '180D', '1Y', 'ALL')),
  difficulty  text not null check (difficulty in ('easy', 'medium', 'hard', 'insane')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists cr_tracks (
  id             integer generated always as identity primary key,
  map_id         integer not null references cr_maps(id),
  mode           text not null check (mode in ('raw', 'smooth')),
  version        integer not null check (version >= 1),
  -- FROZEN once inserted (hard rule 1): regeneration inserts a new version
  -- and flips active on old rows; points are never updated or deleted.
  points         jsonb not null,
  point_count    integer not null,
  world_length   numeric not null,
  max_slope_deg  numeric not null,
  volatility     numeric not null,
  par_time_ms    integer,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists cr_config (
  key    text primary key,
  value  jsonb not null
);

-- ── HARDENING (recommended; idempotent) ─────────────────────────────────────

-- The live cr_maps_period_check only allows ('1Y','ALL'). The API supports
-- 90D/180D too (memecoin pool maps); widen the constraint to enable them:
alter table cr_maps drop constraint if exists cr_maps_period_check;
alter table cr_maps add constraint cr_maps_period_check
  check (period in ('90D', '180D', '1Y', 'ALL'));

-- One row per map+mode+version; at most one active track per map+mode.
create unique index if not exists cr_tracks_map_mode_version
  on cr_tracks (map_id, mode, version);
create unique index if not exists cr_tracks_one_active
  on cr_tracks (map_id, mode) where active;

-- DB-level enforcement of the frozen-track rule: the only column that may
-- ever change on cr_tracks is the active flag.
create or replace function cr_tracks_freeze_guard() returns trigger as $$
begin
  if new.points is distinct from old.points
     or new.point_count is distinct from old.point_count
     or new.world_length is distinct from old.world_length
     or new.max_slope_deg is distinct from old.max_slope_deg
     or new.volatility is distinct from old.volatility
     or new.map_id is distinct from old.map_id
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
