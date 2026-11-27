-- Injuries and emergency call-ups (injury/1).
--
-- Adoption boundary: only seasons with an injury_rule roll injuries, so an existing league adopts
-- them from its next season. Past results, frozen match requests and replays are untouched.
alter table seasons add column injury_rule text;

-- A player hurt in a match misses the rounds out_from_round..out_until_round of that season.
-- One roll per match (injury_checks) and at most one injury per player per match.
create table player_injuries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  injured_round int not null,
  out_from_round int not null,
  out_until_round int not null check (out_until_round >= out_from_round),
  rule text not null,
  created_at timestamptz not null default now(),
  unique (match_id, player_id)
);
create index player_injuries_season_idx on player_injuries(season_id, team_id, out_from_round, out_until_round);

create table injury_checks (
  match_id uuid primary key references matches(id) on delete cascade,
  injuries int not null,
  checked_at timestamptz not null default now()
);

-- Who couldn't play a fixture and who started instead (a squad player, or an emergency call-up).
create table lineup_changes (
  fixture_id uuid not null references fixtures(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  replaced_by uuid not null references players(id) on delete cascade,
  reason text not null check (reason in ('injured')),
  emergency boolean not null default false,
  primary key (fixture_id, player_id)
);

-- An emergency call-up: a temporary player registered for one season only when a club can't field
-- a side (or a goalkeeper). Never part of the squad (retired_season_id is set to that season).
alter table players add column emergency_season_id uuid references seasons(id) on delete set null;
