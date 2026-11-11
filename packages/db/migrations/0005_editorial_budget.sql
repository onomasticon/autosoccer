-- Journalist spend cap: one editorial budget per season, metered in the same compute ledger as
-- the managers' per-team budgets. Editorial transactions have pool 'editorial' and no team.
-- Existing seasons get the $3.00 default.
alter table seasons
  add column editorial_budget_micro_usd bigint not null default 3000000
  check (editorial_budget_micro_usd >= 0);

alter table compute_transactions alter column team_id drop not null;
alter table compute_transactions
  add column pool text not null default 'team' check (pool in ('team', 'editorial'));
alter table compute_transactions
  add constraint compute_pool_team check ((pool = 'team') = (team_id is not null));

-- One editorial grant per season (the team grant index can't cover it: NULL team ids are distinct).
create unique index compute_editorial_grant_once on compute_transactions (season_id)
  where kind = 'grant' and pool = 'editorial';
create index compute_transactions_editorial_idx on compute_transactions (season_id) where pool = 'editorial';
