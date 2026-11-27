-- Club founding (#95): founder models create their clubs' identities before a new league starts.
-- Nothing here touches the original league; founders exist only for leagues that invite them.

-- One founder per inaugural club: a model invited to a league. It becomes the club's owner,
-- sporting director and head coach. invited → founded, or awaiting (resubmissions exhausted; an
-- operator decides; the platform never invents an identity on the model's behalf).
create table founders (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Registry slug of the model (models/registry.ts). Fixed: a founder never changes model.
  model text not null,
  status text not null default 'invited' check (status in ('invited', 'founded', 'awaiting')),
  rounds int not null default 0 check (rounds >= 0),
  team_id uuid unique references teams(id),
  created_at timestamptz not null default now(),
  unique (league_id, model),
  check ((status = 'founded') = (team_id is not null))
);

-- Every submission, accepted or not, with the validator's reasons and the call's provenance.
create table founding_submissions (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null references founders(id) on delete cascade,
  round int not null check (round > 0),
  -- The submitted charter (null when the model's output wasn't a valid charter at all).
  charter jsonb,
  accepted boolean not null,
  reasons jsonb not null default '[]',
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_micro_usd bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (founder_id, round)
);

-- The founding charter: immutable once written. Later identity changes are dated rows in
-- team_identities; the charter itself is history.
create table club_charters (
  team_id uuid primary key references teams(id) on delete cascade,
  founder_id uuid not null unique references founders(id),
  league_id uuid not null references leagues(id),
  charter jsonb not null,
  -- Who made it: model, provider, whether it was live, the submission and round.
  provenance jsonb not null,
  founded_at timestamptz not null default now()
);

create function club_charters_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'a founding charter is immutable' using errcode = '23514';
end $$;
create trigger club_charters_immutable_trg before update or delete on club_charters
  for each row execute function club_charters_immutable();
