-- The newsroom's league desk and news cycle.
--
-- * 'news' articles: league news written by the correspondent from official records (transfer
--   window round-ups, club finances, bankruptcies and takeovers, changes to the league's format and
--   rules, champions). `topic` says which; one article per topic and subject (agent_runs key).
-- * `priority`: how big the story is (a champion outranks a round-1 preview). The homepage ranks by
--   it; the news page stays in publication order.
-- * `published_at` is now the article's place in the league's news cycle, derived from the
--   schedule (a report a few minutes after its match, previews in the hours before kickoff), so
--   pieces about the same moment are staggered and ordered as they would be in a real newsroom. An
--   article dated later than now is held back until then.
alter table articles drop constraint articles_kind_check;
alter table articles add constraint articles_kind_check
  check (kind in ('match_report', 'preview', 'analysis', 'column', 'news'));
alter table articles add column topic text;
alter table articles add column priority int not null default 0;

alter table editorial_agents drop constraint editorial_agents_role_check;
alter table editorial_agents add constraint editorial_agents_role_check
  check (role in ('reporter', 'analyst', 'pundit', 'correspondent'));

create index articles_priority_idx on articles(status, priority desc, published_at desc);
