-- Club finances (#80, increment 1): a fictional club treasury carried across seasons, kept
-- entirely apart from the real AI compute ledger (#24, ledger_entries).
--
-- Adoption boundary: only seasons with a finance_rule settle money. Seasons that existed when this
-- migration ran (completed, active or scheduled) keep finance_rule null and are never settled, so
-- past results, frozen match requests and replays are untouched; the league adopts finances from
-- the next season it creates.
alter table seasons add column finance_rule text;

create table club_ledger (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  -- Null only for the one-off opening balance.
  season_id uuid references seasons(id) on delete cascade,
  round int,
  kind text not null check (kind in ('opening', 'distribution', 'result', 'prize', 'payroll')),
  -- Whole credits (cr); income positive, spending negative.
  amount bigint not null,
  -- Settlement key: one row per obligation, so retries and repeated scheduler ticks never pay twice.
  key text not null unique,
  -- The finance rule version that produced it (e.g. 'finance/1').
  rule text not null,
  memo text not null,
  basis jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index club_ledger_team_idx on club_ledger(team_id, created_at);
create index club_ledger_season_idx on club_ledger(season_id, team_id);
