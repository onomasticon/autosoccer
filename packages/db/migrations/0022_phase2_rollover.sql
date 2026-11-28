-- Phase 2 season rollover (#101): when a new league's season completes, the next one is created on
-- calendar/1 with the same clubs. Academy graduates who replace retirees sign contracts; the rollover
-- itself is a league phase, so its steps run once each and its summary is on record.
alter table player_contracts drop constraint player_contracts_via_check;
alter table player_contracts add constraint player_contracts_via_check
  check (via in ('founding', 'recruitment', 'renewal', 'free_agent', 'transfer', 'safety_net', 'academy'));

alter table league_phases drop constraint league_phases_kind_check;
alter table league_phases add constraint league_phases_kind_check check (kind in ('founding', 'safety_net', 'rollover'));
