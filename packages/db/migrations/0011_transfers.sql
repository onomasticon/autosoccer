-- Transfer market (#80, increment 2): an unattended window between seasons, with listings, competing
-- bids, the seller's decision and one atomic settlement per deal.
--
-- Registration: a player is registered with exactly one club per season (primary key). Transfers
-- only happen in the window before a season kicks off, so the registration fixes the club a player
-- represents for the whole season. players.team_id stays the current club; history reads the
-- registration (or the side in a match's frozen request), so past goals and replays stay with the
-- club represented at the time. Every existing season is backfilled from today's squads, which is
-- exact: no player has moved yet.
create table player_registrations (
  season_id uuid not null references seasons(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  -- The completed bid that moved the player to this club for this season (null: carried over).
  transfer_id uuid,
  created_at timestamptz not null default now(),
  primary key (season_id, player_id)
);
create index player_registrations_team_idx on player_registrations(season_id, team_id);
insert into player_registrations (season_id, player_id, team_id)
select st.season_id, p.id, p.team_id from players p join season_teams st on st.team_id = p.team_id
on conflict do nothing;

-- Adoption boundary: only seasons with a transfer_rule open a window (seasons created from now on,
-- by default, and only after a completed season with club finances).
alter table seasons add column transfer_rule text;

create table transfer_windows (
  id uuid primary key default gen_random_uuid(),
  -- The season the window feeds: deals register players for it.
  season_id uuid not null unique references seasons(id) on delete cascade,
  rule text not null,
  opens_at timestamptz not null,
  -- Hard deadline: whatever hasn't been decided by then lapses, and the window settles. Always before
  -- round 1 kicks off; round 1 is never released while a window is open.
  deadline timestamptz not null,
  phase text not null default 'listing' check (phase in ('listing', 'bidding', 'replying', 'closed')),
  -- When each phase ends at the latest (it ends sooner once every manager has answered).
  phase_ends_at timestamptz not null,
  closed_at timestamptz,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (deadline >= opens_at),
  check ((phase = 'closed') = (closed_at is not null))
);

-- A club inviting offers for one of its players ("soliciting").
create table transfer_listings (
  window_id uuid not null references transfer_windows(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  asking_fee bigint check (asking_fee > 0),
  reason text not null,
  agent_run_id uuid references agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (window_id, player_id)
);

create table transfer_bids (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references transfer_windows(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  seller_team_id uuid not null references teams(id) on delete cascade,
  buyer_team_id uuid not null references teams(id) on delete cascade,
  -- Whole credits; the player's wage at the buyer follows finance rules (recorded for the record).
  fee bigint not null check (fee > 0),
  wage bigint not null check (wage >= 0),
  -- pending → accepted | rejected | lapsed (no reply by the deadline) | outbid (another bid for the
  -- same player was accepted); accepted → completed | failed (settlement checks).
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'lapsed', 'outbid', 'completed', 'failed')),
  buyer_reason text not null,
  seller_reason text,
  -- Why a settlement failed, or how a tie was resolved.
  outcome text,
  buyer_run_id uuid references agent_runs(id) on delete set null,
  seller_run_id uuid references agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  settled_at timestamptz,
  -- One bid per buying club per player per window.
  unique (window_id, player_id, buyer_team_id),
  check (seller_team_id <> buyer_team_id)
);
create index transfer_bids_window_idx on transfer_bids(window_id, status);
-- At most one deal completes per player per window.
create unique index transfer_bids_one_deal_idx on transfer_bids(window_id, player_id) where status = 'completed';

alter table player_registrations
  add constraint player_registrations_transfer_fk foreign key (transfer_id) references transfer_bids(id) on delete set null;

-- Transfer fees in the club treasury: the buyer pays (negative), the seller receives (positive).
alter table club_ledger drop constraint club_ledger_kind_check;
alter table club_ledger add constraint club_ledger_kind_check
  check (kind in ('opening', 'distribution', 'result', 'prize', 'payroll', 'transfer'));

-- Manager runs in the window: listing, bidding and replying.
alter table agent_runs drop constraint agent_runs_purpose_check;
alter table agent_runs add constraint agent_runs_purpose_check
  check (purpose in ('pre_match', 'post_match', 'article', 'transfer'));
