-- 7-a-side: each season records how many players a side it plays with. Seasons created
-- before this migration were 5-a-side; new seasons default to 7 in createSeason.
alter table seasons
  add column players_per_team smallint not null default 5
  check (players_per_team in (5, 7));
