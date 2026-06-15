-- 010_daily_challenge.sql  (P7.6 — owner pastes in Supabase SQL editor)
--
-- Daily challenge: one random track per UTC day; top verified+finished run wins
-- 0.5 SOL (1st only). Layered on the existing run/leaderboard/payout system —
-- daily runs are just cr_runs filtered by the day's track + window, and the daily
-- payout reuses cr_payouts (kind='daily') so the Telegram bot + public receipts
-- pick it up unchanged. Non-destructive + idempotent.

-- One row per UTC day.
create table if not exists cr_daily_challenges (
  id               bigserial primary key,
  track_id         bigint not null references cr_tracks(id),
  challenge_date   date not null unique,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'open' check (status in ('open', 'settled')),
  winner_player_id uuid null references cr_players(id),
  winner_score     integer null,
  paid             boolean not null default false,
  created_at       timestamptz not null default now()
);

-- Tunable daily prize (SOL), read by the engine; default 0.5.
insert into cr_config (key, value) values ('daily_prize_sol', '0.5')
  on conflict (key) do nothing;

-- Let cr_payouts carry daily payouts so the Telegram bot (markPayoutPaid /
-- /pending) and the public /paid receipts handle them with no code change.
alter table cr_payouts add column if not exists kind text not null default 'window';
alter table cr_payouts drop constraint if exists cr_payouts_kind_check;
alter table cr_payouts add constraint cr_payouts_kind_check check (kind in ('window', 'daily'));

alter table cr_payouts add column if not exists daily_challenge_id bigint references cr_daily_challenges(id);

-- Daily payouts aren't tied to a 30-min window.
alter table cr_payouts alter column window_id drop not null;

-- One payout per daily challenge → settling twice inserts nothing new (idempotent).
create unique index if not exists cr_payouts_daily_uniq
  on cr_payouts (daily_challenge_id) where daily_challenge_id is not null;
