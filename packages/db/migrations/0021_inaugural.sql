-- The inaugural phase of a new league (#95, #96, #99): founding rounds, then the shared recruitment
-- market (three simultaneous offer rounds, then a costed safety net), before the league is activated.

-- A league's inaugural steps, scheduled inside calendar/1's founding window.
create table league_phases (
  league_id uuid not null references leagues(id) on delete cascade,
  kind text not null check (kind in ('founding', 'safety_net')),
  round int not null check (round > 0),
  opens_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'settled')),
  settled_at timestamptz,
  summary jsonb not null default '{}',
  primary key (league_id, kind, round),
  check ((status = 'settled') = (settled_at is not null))
);

-- The inaugural phase's settings (seed, budgets, timetable) and the season it creates.
alter table leagues add column inaugural jsonb;
alter table leagues add column inaugural_season_id uuid references seasons(id);

-- The shared talent pool belongs to one league: its unattached players are only that league's free agents.
alter table players add column pool_league_id uuid references leagues(id) on delete set null;
create index players_pool_idx on players(pool_league_id) where team_id is null;

-- Recruitment rounds are market windows too (free agency over the pool), several per season.
alter table market_windows add column round int not null default 1;
alter table market_windows drop constraint market_windows_season_id_kind_key;
alter table market_windows add constraint market_windows_season_kind_round_key unique (season_id, kind, round);
alter table market_windows drop constraint market_windows_kind_check;
alter table market_windows add constraint market_windows_kind_check check (kind in ('preseason', 'midseason', 'recruitment'));

-- The safety net's stated fee per assigned player.
alter table club_ledger drop constraint club_ledger_kind_check;
alter table club_ledger add constraint club_ledger_kind_check
  check (kind in ('opening', 'distribution', 'result', 'prize', 'payroll', 'transfer', 'takeover', 'operating',
                  'loan', 'repayment', 'auction', 'recruitment'));
