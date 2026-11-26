# Club finances (`finance/1`)

Every club has a bank balance in **credits (cr)**, the league's fictional money. Winning earns money, paying players costs money, and the balance carries from one season to the next. In later increments of #80, clubs will be able to buy and sell players, and a club that runs out of money will be declared bankrupt and forfeit its season.

This is separate from the AI managers' compute budget (#24). That budget measures real model spend, in US dollars, and keeps its own accounts.

## How the money works

| What | When | Amount |
| --- | --- | ---: |
| Opening balance | Once, the first time a club plays a season with club finances | 12m cr |
| League distribution | Every club, when the season's first round kicks off | 6m cr |
| A win | After the official result | 600k cr |
| A draw | After the official result | 250k cr |
| A defeat | | nothing |
| Finishing prize | When the season ends: 1st / 2nd / 3rd / 4th | 4m / 2.5m / 1.5m / 800k cr |
| Wages | Every round, when the round kicks off, for every player on the books | 30k cr + 3k cr per rating point above 45, at least 20k cr per player |

Wages follow each player's overall rating for the season, so a stronger squad costs more to keep. The seed squads cost about 1.45–1.5m cr a round each, roughly 8.8–9m cr over a six-round season.

What a six-season run shows ([finance-balance.md](finance-balance.md)):

- **Performance pays.** The clubs with the most titles and prizes end on about 20–23m cr. The others end on about 14–15m cr.
- **A bad season costs money.** Finishing last with few wins loses about 1.4m cr. A struggling club can recover: Saltmarsh fell from 12m to 8.9m cr over three seasons, then won the title and rebuilt.
- **Nobody goes broke on wages alone.** Without transfers, a run of bad seasons only slows a club down. The risk of insolvency comes in the next increment, from transfer fees and the higher wages of signed players. The rules will be retuned then, using this same exercise.

The numbers live in one versioned table (`apps/server/src/modules/finance/rules.ts`). Changing them means changing the version, and every ledger entry records the version that produced it.

## What the managers see

Before each match, the AI manager is told:

- the club's cash;
- the wage bill per round;
- how many rounds of wages are still to pay;
- the headroom left after those wages.

Headroom doesn't count income still to come, because that depends on results.

## Exactly once

Every payment and charge is a row in `club_ledger` with a unique settlement key, for example `payroll:<season>:<round>:<club>` or `result:<fixture>:<club>`. A single reconciler (`settleFinances`) writes whatever a season owes so far. It runs:

- on every scheduler tick;
- when a round is released, before its matches are prepared;
- after every official result;
- when the season completes.

Running it again, retrying a job, or running several workers at once never pays or charges twice. A club's balance is simply the sum of its ledger rows.

## Adoption boundary

Seasons created before this change have no finance rule (`seasons.finance_rule` is null) and are never settled. Past results, frozen match requests and verified replays are untouched. An existing league adopts club finances from the next season the rollover creates. At that point every club receives the same opening balance, so no club starts ahead because of past results.

## Rebalancing

`bun run finance:balance --seasons 4` plays several seasons through the normal lifecycle on a throwaway database and writes [finance-balance.md](finance-balance.md). The report covers earnings by source, wages, cash after each season, and titles. Edit the rules, bump the version, rerun the script and compare.
