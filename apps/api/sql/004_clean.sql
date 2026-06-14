alter table cr_tracks add column if not exists difficulty_score numeric;

alter table cr_runs add column if not exists finished boolean not null default false;

alter table cr_payouts drop constraint if exists cr_payouts_window_track_uniq;
alter table cr_payouts add constraint cr_payouts_window_track_uniq unique (window_id, track_id);

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
