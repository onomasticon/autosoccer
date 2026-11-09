-- Baseline: platform metadata. Domain tables arrive in later migrations.
create table app_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into app_meta (key, value) values ('platform', '{"name": "autosoccer", "schema": "baseline"}');
