# Club finances (`finance/1`)

Every club has a bank balance in **credits (cr)**, the league's fictional money. Winning earns money, paying players costs money, and the balance carries from one season to the next. Between seasons clubs buy and sell players in a transfer window ([transfers.md](transfers.md)). A club that can't pay a round's wages is declared bankrupt and forfeits the rest of its season, then returns under new owners ([bankruptcy.md](bankruptcy.md)).

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
| Wages | Every round, when the round kicks off, for every player registered with the club that season | 30k cr + 3k cr per rating point above 45, at least 20k cr per player |
| Transfer fees | When a deal settles at the end of the transfer window | paid by the buying club, received by the selling club |
| Takeover capital | After a bankruptcy, when the next season is created | whatever brings the club's cash back to 12m cr |

Wages follow each player's overall rating for the season, so a stronger squad costs more to keep. The seed squads cost about 1.45–1.5m cr a round each, roughly 8.8–9m cr over a six-round season.

What a six-season run with transfer windows shows ([finance-balance.md](finance-balance.md)):

- **Performance earns money.** Red Rock won three titles and earned the most from results and prizes (29.9m cr). Northgate, without a title, earned 19m cr.
- **Spending decides what's kept.** Red Rock also spent the most: 5.9m cr net on transfers, and the biggest wage bill (18 players). They finished with the least cash, 14.3m cr. A solvent club can make a costly choice, and here it bought titles.
- **A struggling club can recover.** Saltmarsh finished Season 1 last, on 10.6m cr. They sold a bench player for 2.9m cr, won Season 2, and ended with the most cash, 21.1m cr, and two titles.
- **Prudent clubs don't go broke.** The offline managers keep 3m cr of headroom, so in this run nobody comes near bankruptcy. A reckless club does: one that spends almost all its cash on a signing runs out a few rounds into the season ([bankruptcy.md](bankruptcy.md)).

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
