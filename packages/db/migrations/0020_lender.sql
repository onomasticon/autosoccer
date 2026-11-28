-- The league lender (insolvency/2, #97): loans, liens, forced auctions and administration for seasons
-- whose insolvency_rule is 'insolvency/2'. insolvency/1 seasons (walkovers, takeovers) are untouched.

-- Cash moves in the club treasury: a loan paid out (+), a repayment (−), and auction proceeds (± between clubs).
alter table club_ledger drop constraint club_ledger_kind_check;
alter table club_ledger add constraint club_ledger_kind_check
  check (kind in ('opening', 'distribution', 'result', 'prize', 'payroll', 'transfer', 'takeover', 'operating',
                  'loan', 'repayment', 'auction'));

create table club_loans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  -- The season it was opened in.
  season_id uuid not null references seasons(id) on delete cascade,
  opened_round int,
  kind text not null check (kind in ('secured', 'emergency', 'support')),
  principal bigint not null check (principal > 0),
  -- Repaid by the end of this season number.
  due_season int not null,
  status text not null default 'active' check (status in ('active', 'repaid')),
  rule text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'repaid') = (closed_at is not null))
);
create index club_loans_team_idx on club_loans(team_id, status);

-- The debt side of every loan: a balance is the sum of its entries. One row per obligation (key).
create table loan_entries (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references club_loans(id) on delete cascade,
  season_id uuid not null references seasons(id) on delete cascade,
  round int,
  kind text not null check (kind in ('disbursement', 'interest', 'repayment')),
  amount bigint not null,
  key text not null unique,
  created_at timestamptz not null default now(),
  check ((kind = 'repayment') = (amount < 0))
);
create index loan_entries_loan_idx on loan_entries(loan_id);

-- Players pledged as collateral for a secured loan. A player is pledged to at most one loan at a time.
create table loan_liens (
  loan_id uuid not null references club_loans(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  primary key (loan_id, player_id)
);
create unique index loan_liens_one_pledge_idx on loan_liens(player_id) where released_at is null;

-- The lender's check of each club before each round, once (the outcome and the numbers behind it).
create table lender_checks (
  season_id uuid not null references seasons(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  round int not null check (round > 0),
  outcome text not null check (outcome in ('solvent', 'emergency', 'default')),
  basis jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (season_id, team_id, round)
);

-- A club in administration: transfer embargo, surplus swept to the lender, its manager keeps the team.
create table administrations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  entered_season_id uuid not null references seasons(id) on delete cascade,
  entered_round int,
  debt_at_entry bigint not null,
  reason text not null,
  exited_season_id uuid references seasons(id) on delete cascade,
  exited_at timestamptz,
  created_at timestamptz not null default now(),
  check ((exited_season_id is null) = (exited_at is null))
);
create unique index administrations_one_active_idx on administrations(team_id) where exited_at is null;

-- A compulsory sealed-bid auction of a defaulting club's player: every eligible club's bid, the winner
-- (highest at or above the reserve; ties to a fixed club order), or failed (no valid bid).
create table collateral_auctions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  round int,
  seller_team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  reserve bigint not null,
  bids jsonb not null default '[]',
  winner_team_id uuid references teams(id),
  amount bigint,
  status text not null check (status in ('sold', 'failed')),
  key text not null unique,
  created_at timestamptz not null default now(),
  check ((status = 'sold') = (winner_team_id is not null and amount is not null))
);

create trigger club_loans_archived_trg before insert or update or delete on club_loans
  for each row execute function archived_guard();
create trigger loan_entries_archived_trg before insert or update or delete on loan_entries
  for each row execute function archived_guard();
create trigger lender_checks_archived_trg before insert or update or delete on lender_checks
  for each row execute function archived_guard();
create trigger collateral_auctions_archived_trg before insert or update or delete on collateral_auctions
  for each row execute function archived_guard();
