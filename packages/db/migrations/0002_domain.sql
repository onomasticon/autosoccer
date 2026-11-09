-- Domain model v1 (contracts @autosoccer/contracts 1.0.0).
-- Money: integer micro-USD. JSON payloads validated by zod contracts at the boundary.

create table teams (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  short_name text not null check (char_length(short_name) between 2 and 4),
  city text not null default '',
  primary_color text not null check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  crest jsonb not null,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  shirt_number int not null check (shirt_number between 1 and 99),
  position text not null check (position in ('GK', 'DF', 'MF', 'FW')),
  created_at timestamptz not null default now(),
  unique (team_id, shirt_number)
);
create index players_team_idx on players(team_id);

create table manager_agents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null unique references teams(id) on delete cascade,
  slug text not null unique,
  name text not null,
  persona text not null,
  philosophy text not null,
  model text not null,
  memory jsonb not null default '{"summary": "", "notes": [], "updatedAt": null}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table editorial_agents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  role text not null check (role in ('reporter', 'analyst', 'pundit')),
  bio text not null,
  voice text not null,
  avatar jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'active', 'completed')),
  seed bigint not null check (seed >= 0),
  sim_version text not null,
  budget_per_team_micro_usd bigint not null check (budget_per_team_micro_usd >= 0),
  starts_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'completed' or completed_at is not null)
);

create table season_teams (
  season_id uuid not null references seasons(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  primary key (season_id, team_id)
);

create table fixtures (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  round int not null check (round > 0),
  home_team_id uuid not null references teams(id),
  away_team_id uuid not null references teams(id),
  status text not null default 'scheduled' check (status in ('scheduled', 'ready', 'playing', 'completed', 'failed')),
  seed bigint not null check (seed between 0 and 4294967295),
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (home_team_id <> away_team_id),
  -- Double round robin: each ordered pairing exactly once per season.
  unique (season_id, home_team_id, away_team_id)
);
create index fixtures_season_round_idx on fixtures(season_id, round);

-- A team plays at most once per round.
create function fixtures_one_per_round() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from fixtures f
    where f.season_id = new.season_id and f.round = new.round and f.id <> new.id
      and (f.home_team_id in (new.home_team_id, new.away_team_id) or f.away_team_id in (new.home_team_id, new.away_team_id))
  ) then
    raise exception 'team already has a fixture in round %', new.round using errcode = '23505';
  end if;
  return new;
end $$;
create trigger fixtures_one_per_round_trg before insert or update on fixtures
  for each row execute function fixtures_one_per_round();

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_kind text not null check (agent_kind in ('manager', 'editorial')),
  agent_id uuid not null,
  purpose text not null check (purpose in ('pre_match', 'post_match', 'article')),
  season_id uuid not null references seasons(id) on delete cascade,
  fixture_id uuid references fixtures(id) on delete set null,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped_budget')),
  attempt int not null default 0 check (attempt >= 0),
  provider text,
  model text,
  prompt jsonb,
  output jsonb,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_runs_agent_idx on agent_runs(agent_id, created_at);

create table tactical_revisions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  version int not null check (version > 0),
  fixture_id uuid references fixtures(id) on delete set null,
  deployment jsonb not null check (deployment->>'kind' in ('tactical', 'scripted')),
  lineup jsonb not null,
  status text not null check (status in ('valid', 'rejected')),
  validation_errors jsonb not null default '[]',
  source text not null check (source in ('seed', 'manager', 'fallback')),
  agent_run_id uuid references agent_runs(id) on delete set null,
  rationale text,
  created_at timestamptz not null default now(),
  unique (team_id, season_id, version),
  check (status = 'rejected' or jsonb_array_length(validation_errors) = 0)
);
create index tactical_revisions_team_idx on tactical_revisions(team_id, season_id, version desc);

create table matches (
  id uuid primary key default gen_random_uuid(),
  -- One official match per fixture: a replayed/retried job can never create a second.
  fixture_id uuid not null unique references fixtures(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  seed bigint not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request jsonb not null,
  versions jsonb not null,
  home_revision_id uuid references tactical_revisions(id),
  away_revision_id uuid references tactical_revisions(id),
  home_score int check (home_score >= 0),
  away_score int check (away_score >= 0),
  final_hash text,
  ticks int,
  events jsonb not null default '[]',
  stats jsonb,
  diagnostics jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'completed' or (home_score is not null and away_score is not null and final_hash is not null and completed_at is not null))
);

create table replay_artifacts (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references matches(id) on delete cascade,
  uri text not null,
  format text not null check (format = 'autosoccer-replay'),
  format_version int not null,
  engine_version text not null,
  sdk_version text,
  byte_size int not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  final_hash text not null,
  verified boolean not null,
  created_at timestamptz not null default now()
);

create table compute_transactions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  agent_run_id uuid references agent_runs(id) on delete set null,
  kind text not null check (kind in ('grant', 'reserve', 'release', 'charge')),
  amount_micro_usd bigint not null,
  provider text,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now(),
  check (
    (kind = 'grant' and amount_micro_usd > 0) or
    (kind = 'reserve' and amount_micro_usd < 0) or
    (kind = 'release' and amount_micro_usd >= 0) or
    (kind = 'charge' and amount_micro_usd <= 0)
  )
);
create index compute_transactions_team_idx on compute_transactions(season_id, team_id);

create table articles (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  slug text not null unique,
  kind text not null check (kind in ('match_report', 'preview', 'analysis', 'column')),
  status text not null default 'draft' check (status in ('draft', 'published', 'rejected')),
  editorial_agent_id uuid not null references editorial_agents(id),
  headline text not null,
  standfirst text not null default '',
  body text not null,
  citations jsonb not null default '[]',
  match_id uuid references matches(id) on delete set null,
  fixture_id uuid references fixtures(id) on delete set null,
  team_ids uuid[] not null default '{}',
  agent_run_id uuid references agent_runs(id) on delete set null,
  ai_generated boolean not null default true check (ai_generated),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);
create index articles_published_idx on articles(status, published_at desc);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts > 0),
  run_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  result jsonb,
  artifacts jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_ready_idx on jobs(status, run_at) where status in ('queued', 'running');

update app_meta set value = '{"name": "autosoccer", "schema": "domain-v1"}', updated_at = now() where key = 'platform';
