-- Ending a season early (#101 launch): the operator stops a league's season part-way. Its played
-- matches stay on record; its unplayed fixtures are removed. An ended-early season has no champion,
-- so it gets its own status: everything that crowns, counts titles or sets records reads 'completed'.
alter table seasons drop constraint seasons_status_check;
alter table seasons add constraint seasons_status_check
  check (status in ('draft', 'scheduled', 'active', 'completed', 'ended_early'));

-- How far it got, and how long it was meant to be.
alter table seasons add column ended_after_round int check (ended_after_round >= 0);
alter table seasons add column planned_rounds int check (planned_rounds > 0);
alter table seasons add check ((status = 'ended_early') = (ended_after_round is not null and planned_rounds is not null));
