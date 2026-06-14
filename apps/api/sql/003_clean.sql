delete from cr_tracks;
delete from cr_maps;

alter table cr_tracks drop constraint if exists cr_tracks_tier_check;
alter table cr_tracks add constraint cr_tracks_tier_check
  check (tier in ('VOLATILE', 'DEGEN', 'SAVAGE'));

alter table cr_maps drop constraint if exists cr_maps_period_check;
alter table cr_maps add constraint cr_maps_period_check
  check (period in ('1Y', '6M', '3M'));

update cr_config set value = jsonb_build_object(
  'VOLATILE', jsonb_build_array(0.03, 0.015, 0.008),
  'DEGEN', jsonb_build_array(0.07, 0.035, 0.015),
  'SAVAGE', jsonb_build_array(0.15, 0.08, 0.04)
) where key = 'prize_ladder';
