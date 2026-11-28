# The inaugural phase (`inaugural/1`, #95, #96, #99)

A new league's first 20 hours (8 hours of founding, then 12 hours of recruitment), run by the scheduler, before the operator activates the league. The module is `apps/server/src/modules/founding/inaugural.ts` and the migration is 0021.

| When (from the window opening) | Step | Rule |
| --- | --- | --- |
| Hours 0–8 | Up to three **founding rounds**, 2h40m apart, so founding takes 8 hours. Each round is one job, and every founder answers through its own model. Clashes are settled in a seeded order, never by who answered first | founding/1 |
| Hour 8 | **Season 1** is created for the founded clubs (finance/3, transfer/2, insolvency/2, from calendar/1). Each club gets its opening balance now, so it has money to recruit with. The **talent pool** is created as the league's own unattached players | recruit/1 |
| Hours 8–20 | Three **offer rounds** of 4 hours, run in order. Each is a market window of kind `recruitment`, settled by recruit/1's simultaneous offer round: every club's offers at once, so a faster model gains nothing | recruit/1 |
| Hour 20 | The **safety net**. A club still short of a viable squad (9 players, with a keeper and at least 6 outfielders) is assigned the best remaining players, a keeper first and then outfielders, at minimum terms plus the stated Ȼ250k fee each. The fee is charged even if it takes the club below zero, and is shown as such | recruit/1 |
| Hour 20 | The preseason window (72 hours, or `--first-preseason-hours` for season 1 only) and round 1, **once the operator activates the league** | calendar/1 |

- **Every manager uses its own model.** A club's manager is its founder, so all of its decisions (contracts, offers, pre- and post-match) go through that founder's model: direct for OpenAI and Anthropic, and pinned OpenRouter hosts otherwise. The original league keeps its single configured model.
- **The pool belongs to one league.** Pool players carry `pool_league_id`, and a league only sees its own free agents. A player released in a Phase 2 season joins that league's pool.
- **Activation is refused** until the safety net has run and every club has a viable, fully contracted squad (`bun run leagues activate` shows the check).
- **Exactly once.** Founding submissions are unique per founder and round, the phases are keyed, opening balances share finance's key, and safety-net fees are keyed per player.
- **A founder that never answers** gets feedback and up to three rounds, then waits for an operator, as before. If fewer than two clubs are founded, the phase stops and says so.

## Operating it

```
bun run leagues create --league founders --name "The Founders League" --confirm founders
bun run leagues inaugural --league founders --models <slug>,<slug>,… --opens 2027-01-04T09:00:00Z --seed 7 [--first-preseason-hours 12] [--confirm founders]
bun run leagues inaugural-status --league founders
bun run leagues activate --league founders --confirm founders
```

`inaugural` only schedules the phase. No model is called until the scheduler reaches founding round 1.

## Evidence

`founding/inaugural.test.ts` runs the whole phase through the real scheduler and job worker, with four registry founders and offline models:

- one club is founded per founder, and each club's manager runs on that founder's model;
- season 1 is created for exactly those clubs, with opening balances and a pool of the size recruit/1 generates;
- the three offer rounds settle in order, with real signings and every club deciding in each round;
- activation is refused during recruitment, and allowed once every squad is viable (9–16 players, with a keeper), contracted and registered;
- every manager call went through its own manager's model;
- the first season is then played to completion, with every fixture played.

## A fix to recruit/1

recruit/1's viability test used to ask only for 9 players and a keeper. A club that signed, say, four keepers and five outfielders counted as viable but couldn't field a 7-a-side team, and the safety net could fill an empty squad with keepers. A viable squad now also needs 6 outfielders, and the net takes one keeper and then outfielders. Regression tests are in `players/recruitment.test.ts`. The end-to-end test found it: because team ids are random, its seeded tie-break order differs from run to run.

## Not yet

- **Pool preferences.** The pool's generated preferences (asking wage, preferred length, playing time) aren't stored yet. Recruitment uses the free-agency terms derived from each player's rating: 90% of the market wage, with the contract length by age.
- **Founding deadlines.** A founding round waits for every founder's call, bounded by each client's timeout. There's no separate deadline.
