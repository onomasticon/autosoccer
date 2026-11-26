-- Bankruptcy, walkovers and rescue takeovers (#80, increment 3).
--
-- Adoption boundary: only seasons with an insolvency_rule run solvency checks. Seasons that existed
-- when this migration ran keep it null, so an existing league adopts bankruptcy from the next
-- season it creates. Past results, frozen match requests and verified replays are untouched.
alter table seasons add column insolvency_rule text;

-- A fixture that was never played: a walkover (one club withdrawn: the other is awarded the win) or
-- void (both withdrawn: no points). Such a fixture is completed without a match row, so it has no
-- simulated events, replay, lineups or goals.
alter table fixtures add column outcome text check (outcome in ('walkover', 'void'));
alter table fixtures add column walkover_team_id uuid references teams(id);
alter table fixtures add constraint fixtures_forfeit_shape check (
  (outcome is null and walkover_team_id is null)
  or (outcome = 'walkover' and status = 'completed' and walkover_team_id in (home_team_id, away_team_id))
  or (outcome = 'void' and status = 'completed' and walkover_team_id is null));

-- A club declared bankrupt in a season: withdrawn from that round on (effective_round), ineligible for
-- the title and finishing-position prize. One per club per season, so a retried check never declares twice.
create table club_withdrawals (
  season_id uuid not null references seasons(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  effective_round int not null check (effective_round > 0),
  rule text not null,
  reason text not null,
  -- The numbers behind the declaration: cash, money due, the round's wages.
  basis jsonb not null default '{}',
  declared_at timestamptz not null default now(),
  primary key (season_id, team_id)
);

-- Dated club identities. A club keeps its id, slug (links and supporter follows), league slot and
-- honours across a rebrand; each identity applies from a season on. The founding identity has no
-- from_season_id. teams always holds the current identity.
create table team_identities (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  from_season_id uuid references seasons(id) on delete cascade,
  name text not null,
  short_name text not null,
  city text not null,
  primary_color text not null,
  secondary_color text not null,
  crest jsonb not null,
  -- 'founding' or 'takeover'; a takeover names the season the club withdrew from.
  reason text not null check (reason in ('founding', 'takeover')),
  takeover_of_season_id uuid references seasons(id) on delete cascade,
  memo text not null default '',
  created_at timestamptz not null default now(),
  check ((reason = 'founding') = (from_season_id is null)),
  check ((reason = 'takeover') = (takeover_of_season_id is not null))
);
create unique index team_identities_founding_idx on team_identities(team_id) where from_season_id is null;
create unique index team_identities_from_idx on team_identities(team_id, from_season_id) where from_season_id is not null;
create unique index team_identities_takeover_idx on team_identities(team_id, takeover_of_season_id)
  where takeover_of_season_id is not null;

insert into team_identities (team_id, name, short_name, city, primary_color, secondary_color, crest, reason)
select id, name, short_name, city, primary_color, secondary_color, crest, 'founding' from teams;

-- The new owners' capital on a takeover.
alter table club_ledger drop constraint club_ledger_kind_check;
alter table club_ledger add constraint club_ledger_kind_check
  check (kind in ('opening', 'distribution', 'result', 'prize', 'payroll', 'transfer', 'takeover'));

-- A club's name as it was known in a season (the identity in force then), for read queries.
create function team_name_as_of(p_team uuid, p_season uuid) returns text language sql stable as $$
  select coalesce(
    (select i.name from team_identities i left join seasons fs on fs.id = i.from_season_id
     where i.team_id = p_team
       and (i.from_season_id is null or fs.created_at <= (select created_at from seasons where id = p_season))
     order by fs.created_at desc nulls last limit 1),
    (select name from teams where id = p_team))
$$;
