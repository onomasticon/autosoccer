-- Compute ledger guards (#24): idempotent grants and per-attempt charges.
alter table compute_transactions add column attempt int not null default 0;

-- One budget grant per team per season.
create unique index compute_grant_once on compute_transactions (season_id, team_id) where kind = 'grant';
-- A run attempt is charged at most once (a retried settle can't double-charge).
create unique index compute_charge_once on compute_transactions (agent_run_id, attempt) where kind = 'charge';
