-- 11-a-side: seasons may now play with eleven players a side.
alter table seasons drop constraint seasons_players_per_team_check;
alter table seasons add constraint seasons_players_per_team_check check (players_per_team in (5, 7, 11));
