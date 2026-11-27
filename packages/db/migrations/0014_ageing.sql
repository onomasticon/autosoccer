-- Ageing, retirement and academy graduates (ageing/1).
--
-- * born_season: the league season number a player was "born" in, so their age in Season N is
--   N - born_season. Founders and expansion players get one when ageing is first applied (a
--   deterministic starting age of 18–33); academy graduates join at 17–19.
-- * development_rate: how fast a player improves when young and declines when old (0.6–1.6). Hidden:
--   never served by the API or shown to managers.
-- * retired_season_id: the last season a player played; retired players leave their squad but keep
--   their record (careers, goals, replays). team_id stays their last club.
-- * base_attributes: a graduate's own starting ratings (founders' come from the deterministic
--   baseline in attributes.ts).
alter table players add column born_season int;
alter table players add column development_rate real check (development_rate between 0.3 and 2);
alter table players add column retired_season_id uuid references seasons(id) on delete set null;
alter table players add column base_attributes jsonb;
-- The season a graduate was promoted for (null for founders), so an intake is never repeated.
alter table players add column academy_season_id uuid references seasons(id) on delete set null;
create index players_active_idx on players(team_id) where retired_season_id is null;
-- Shirt numbers are unique among a club's active players: a graduate can wear a retiree's number,
-- and old match records keep the number the player wore then.
alter table players drop constraint players_team_id_shirt_number_key;
create unique index players_team_shirt_active_idx on players(team_id, shirt_number) where retired_season_id is null;
