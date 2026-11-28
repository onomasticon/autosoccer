-- Contracts, free agency and the midseason window (transfer/2, #96). Only seasons whose
-- transfer_rule is 'transfer/2' use any of this; the original league (transfer/1) is untouched.

-- A free agent belongs to no club. Only transfer/2 ever releases a player, so legacy rows keep a club.
alter table players alter column team_id drop not null;
alter table players add column free_agent_since_season_id uuid references seasons(id);

-- A player's contract with a club: a fixed wage per season for a run of football years (season
-- numbers of the league). At most one active contract per player.
create table player_contracts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  -- The season the contract was signed for (its first season), and so its league.
  season_id uuid not null references seasons(id) on delete cascade,
  wage_per_season bigint not null check (wage_per_season >= 0),
  starts_season int not null check (starts_season > 0),
  ends_season int not null check (ends_season >= starts_season),
  via text not null check (via in ('founding', 'recruitment', 'renewal', 'free_agent', 'transfer', 'safety_net')),
  status text not null default 'active' check (status in ('active', 'expired', 'released', 'transferred')),
  rule text not null,
  run_id uuid references agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((status = 'active') = (ended_at is null))
);
create unique index player_contracts_one_active_idx on player_contracts(player_id) where status = 'active';
create index player_contracts_team_idx on player_contracts(team_id, status);

-- transfer/2 windows: preseason and midseason, each with a renewals step (preseason only) then free
-- agency. The deadline is hard: anything not decided by then lapses to the safe default.
create table market_windows (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  kind text not null check (kind in ('preseason', 'midseason')),
  rule text not null,
  -- The round the window's moves take effect from (1 for preseason).
  effective_round int not null check (effective_round > 0),
  opens_at timestamptz not null,
  phase_ends_at timestamptz not null,
  deadline timestamptz not null,
  phase text not null default 'renewals' check (phase in ('renewals', 'free_agency', 'closed')),
  closed_at timestamptz,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (season_id, kind),
  check (deadline >= opens_at),
  check ((phase = 'closed') = (closed_at is not null))
);

-- A club's decision on a player whose contract ends: renew (at the market wage) or release.
create table contract_decisions (
  window_id uuid not null references market_windows(id) on delete cascade,
  contract_id uuid not null references player_contracts(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  decision text not null check (decision in ('renew', 'release')),
  -- 'manager' (the club's own call) or 'default' (no decision by the deadline: the player is kept).
  source text not null check (source in ('manager', 'default')),
  reason text not null,
  run_id uuid references agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (window_id, contract_id)
);

-- Wage offers to free agents. Submitted before the deadline, settled together (recruit/1 rules: the
-- player picks the offer that suits him best; ties go to a seeded order, never the fastest club).
create table free_agent_offers (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references market_windows(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  wage_per_season bigint not null check (wage_per_season > 0),
  years int not null check (years between 1 and 4),
  reason text not null,
  run_id uuid references agent_runs(id) on delete set null,
  submitted_at timestamptz not null default now(),
  outcome text check (outcome in ('signed', 'outbid', 'below-terms', 'no-room', 'over-budget', 'late', 'invalid')),
  unique (window_id, player_id, team_id)
);
create index free_agent_offers_window_idx on free_agent_offers(window_id);

-- A move during a season (the midseason window): from this round on, the player represents to_team.
-- Season-start registrations stay in player_registrations; this records changes within a season, so
-- every lineup and payroll can be read as of its round.
create table registration_moves (
  season_id uuid not null references seasons(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  from_round int not null check (from_round > 1),
  from_team_id uuid references teams(id),
  to_team_id uuid references teams(id),
  via text not null check (via in ('free_agent', 'release', 'transfer')),
  window_id uuid references market_windows(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (season_id, player_id, from_round),
  check (from_team_id is distinct from to_team_id)
);

-- Archived leagues stay read-only (0016): guard the new season-scoped tables too.
create trigger player_contracts_archived_trg before insert or update or delete on player_contracts
  for each row execute function archived_guard();
create trigger market_windows_archived_trg before insert or update or delete on market_windows
  for each row execute function archived_guard();
create trigger registration_moves_archived_trg before insert or update or delete on registration_moves
  for each row execute function archived_guard();
