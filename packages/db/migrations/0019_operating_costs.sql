-- finance/3 running costs (#97): a club's staff, travel and ground costs, paid each round. Only
-- seasons whose finance_rule is 'finance/3' write them; earlier seasons are untouched.
alter table club_ledger drop constraint club_ledger_kind_check;
alter table club_ledger add constraint club_ledger_kind_check
  check (kind in ('opening', 'distribution', 'result', 'prize', 'payroll', 'transfer', 'takeover', 'operating'));
