-- Player careers (#70): one ratings snapshot per player per season, written once when the season is
-- created (league/careers.ts). Seasons from before snapshots existed have none and use the
-- deterministic baseline ratings. Snapshots are forward-only: a played match's frozen request keeps
-- whatever ratings it was played with.
create table player_ratings (
  player_id uuid not null references players(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  attributes jsonb not null,
  overall int not null check (overall between 1 and 99),
  -- The development rule that produced it (e.g. 'develop/1', or 'baseline' for a first snapshot).
  rule text not null,
  -- What it was computed from: the previous season, starts, matches, goals and each change.
  basis jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (player_id, season_id)
);
create index player_ratings_season_idx on player_ratings(season_id);
