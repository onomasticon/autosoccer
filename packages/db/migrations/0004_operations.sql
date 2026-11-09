-- Operations (#26): worker heartbeats for liveness monitoring.
create table worker_heartbeats (
  worker_id text primary key,
  role text not null check (role in ('worker', 'scheduler')),
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  jobs_succeeded int not null default 0,
  jobs_failed int not null default 0,
  last_job_kind text
);
