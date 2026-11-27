-- Leagues (#93, Phase 2 foundation): a competition that owns seasons, with a lifecycle.
--
-- Reset the competition, not the universe: clubs, players, managers, articles and replays stay
-- independently identified. A league owns its seasons; everything season-scoped (fixtures,
-- matches, registrations, the club ledger's season rows, compute grants, articles, transfer
-- windows) is reachable from exactly one league through its season.
--
-- Backfill: every existing season joins the original league. No id, slug, result, forfeit,
-- article body, replay pin or frozen match request changes, so every existing URL still resolves.
--
-- Rollback safety: deploy rollbacks don't undo migrations. Code from before this migration inserts
-- seasons without a league, so a trigger files those under the default league.

create table leagues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  -- draft: being set up (founding, recruitment), invisible to the public schedule.
  -- active: plays seasons. concluded: finished its last season; never rolls over again.
  -- archived: read-only history; the database refuses new seasons, fixtures, results and money.
  status text not null default 'draft' check (status in ('draft', 'active', 'concluded', 'archived')),
  -- Division-ready, not division-aware: tiers and promotion/relegation are not implemented.
  division text,
  tier int check (tier is null or tier > 0),
  -- The league the site shows by default. Exactly one at most; changing it never moves records.
  is_default boolean not null default false,
  -- How the league's next season is created: 'legacy' is the original league's automatic
  -- rollover (league/rollover.ts); 'manual' leagues only get seasons from an operator command.
  rollover text not null default 'manual' check (rollover in ('legacy', 'manual')),
  -- The rulesets the league's new seasons are created with (null: platform defaults).
  rules jsonb not null default '{}',
  description text not null default '',
  activated_at timestamptz,
  concluded_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'concluded' or concluded_at is not null),
  check (status <> 'archived' or (archived_at is not null and concluded_at is not null))
);
create unique index leagues_one_default_idx on leagues(is_default) where is_default;

insert into leagues (slug, name, status, is_default, rollover, description, activated_at)
select 'original', 'The Original League', 'active', true, 'legacy',
  'The league as it began: four founding clubs, then ten, with persona-driven AI managers.',
  coalesce((select min(coalesce(starts_at, created_at)) from seasons), now());

alter table seasons add column league_id uuid references leagues(id);
update seasons set league_id = (select id from leagues where slug = 'original');

create function seasons_default_league() returns trigger language plpgsql as $$
begin
  if new.league_id is null then
    new.league_id := (select id from leagues where is_default);
  end if;
  if new.league_id is null then
    raise exception 'season % has no league and there is no default league', new.slug using errcode = '23502';
  end if;
  return new;
end $$;
create trigger seasons_default_league_trg before insert on seasons
  for each row execute function seasons_default_league();

alter table seasons alter column league_id set not null;
create index seasons_league_idx on seasons(league_id, created_at);

-- The announced last season: when it completes, the league concludes instead of rolling over, so
-- the cutover happens at a season boundary and the legacy rollover can't race it.
alter table leagues add column final_season_id uuid references seasons(id);
-- What the league held when it was archived (counts and checksums), to verify nothing changed since.
alter table leagues add column archive_inventory jsonb;
-- The operator's backup reference recorded at archival (e.g. the R2 dump name).
alter table leagues add column archive_backup_ref text;

-- A concluded or archived league never gets a new season; a season can't change league.
create function seasons_league_guard() returns trigger language plpgsql as $$
declare st text;
begin
  if tg_op = 'UPDATE' and new.league_id is distinct from old.league_id then
    raise exception 'a season cannot move to another league' using errcode = '23514';
  end if;
  select status into st from leagues where id = new.league_id;
  if tg_op = 'INSERT' and st in ('concluded', 'archived') then
    raise exception 'league is % and takes no new seasons', st using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and st = 'archived' then
    raise exception 'league is archived: its seasons are read-only' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger seasons_league_guard_trg before insert or update on seasons
  for each row execute function seasons_league_guard();

-- Archived history is immutable: writes to a season-scoped record of an archived league fail.
create function season_archived(p_season uuid) returns boolean language sql stable as $$
  select exists (select 1 from seasons s join leagues l on l.id = s.league_id
                 where s.id = p_season and l.status = 'archived')
$$;

create function archived_guard() returns trigger language plpgsql as $$
declare sid uuid;
begin
  if tg_op = 'DELETE' then
    sid := old.season_id;
  else
    sid := new.season_id;
  end if;
  if sid is not null and season_archived(sid) then
    raise exception '% is read-only: its league is archived', tg_table_name using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger season_teams_archived_trg before insert or update or delete on season_teams
  for each row execute function archived_guard();
create trigger fixtures_archived_trg before insert or update or delete on fixtures
  for each row execute function archived_guard();
create trigger club_ledger_archived_trg before insert or update or delete on club_ledger
  for each row execute function archived_guard();
create trigger player_registrations_archived_trg before insert or update or delete on player_registrations
  for each row execute function archived_guard();
create trigger tactical_revisions_archived_trg before insert or update or delete on tactical_revisions
  for each row execute function archived_guard();
create trigger agent_runs_archived_trg before insert on agent_runs
  for each row execute function archived_guard();
create trigger compute_transactions_archived_trg before insert on compute_transactions
  for each row execute function archived_guard();

-- Matches hang off fixtures: guard them through their fixture.
create function matches_archived_guard() returns trigger language plpgsql as $$
declare sid uuid;
begin
  select season_id into sid from fixtures where id = coalesce(new.fixture_id, old.fixture_id);
  if sid is not null and season_archived(sid) then
    raise exception 'matches are read-only: the league is archived' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger matches_archived_trg before insert or update or delete on matches
  for each row execute function matches_archived_guard();

-- A club plays in at most one league at a time: it can't be in an unfinished season of one league
-- while it is in an unfinished season of another.
create function season_teams_one_league() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from season_teams st
      join seasons s on s.id = st.season_id
      join seasons n on n.id = new.season_id
    where st.team_id = new.team_id and st.season_id <> new.season_id
      and s.league_id <> n.league_id and s.status in ('draft', 'scheduled', 'active')
  ) then
    raise exception 'club already plays in another league''s unfinished season' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger season_teams_one_league_trg before insert on season_teams
  for each row execute function season_teams_one_league();
