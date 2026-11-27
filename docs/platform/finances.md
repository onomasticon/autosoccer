# Club finances (`finance/2`)

Every club has a bank balance in **credits (Ȼ)**, the league's fictional money. Winning earns money, paying players costs money, and the balance carries from one season to the next. Between seasons clubs buy and sell players in a transfer window ([transfers.md](transfers.md)). A club that can't pay a round's wages is declared bankrupt and forfeits the rest of its season, then returns under new owners ([bankruptcy.md](bankruptcy.md)).

This is separate from the AI managers' compute budget (#24). That budget measures real model spend, in US dollars, and keeps its own accounts.

## How the money works

The league has ten clubs and an 18-round season ([league.md](league.md)). Wages and result income are **season amounts paid in equal shares every round**, so a longer season costs and earns a club about the same as the old six-round one. The table shows the numbers for a six-round season; an 18-round season pays a third of each wage and result amount a round.

| What | When | Amount (per six rounds) |
| --- | --- | ---: |
| Opening balance | Once, the first time a club plays a season with club finances | Ȼ12m |
| League distribution | Every club, when the season's first round kicks off | Ȼ6m |
| A win | After the official result | Ȼ600k |
| A draw | After the official result | Ȼ250k |
| A defeat | | nothing |
| Finishing prize | When the season ends: 1st / 2nd / 3rd / 4th / 5th / 6th / 7th / 8th / 9th / 10th | 4m / 2.5m / 1.5m / 800k / 700k / 600k / 500k / 400k / 300k / Ȼ200k |
| Wages | Every round, when the round kicks off, for every player registered with the club that season | Ȼ30k + Ȼ3k per rating point above 45, at least Ȼ20k per player |
| Transfer fees | When a deal settles at the end of the transfer window | paid by the buying club, received by the selling club |
| Takeover capital | After a bankruptcy, when the next season is created | whatever brings the club's cash back to Ȼ12m |

Wages follow each player's overall rating for the season, so a stronger squad costs more to keep. A seed squad costs about 8.7–Ȼ9m a season: about Ȼ1.45m a round over six rounds, or Ȼ485k a round over 18.

What a six-season run shows ([finance-balance.md](finance-balance.md)). The league expands to ten clubs after Season 1:

- **The new clubs compete at once.** Titles went to five different clubs. Eastmoor Wanderers won two; Port Alder, Larkfield Rangers, Harbour City and Red Rock Rovers won one each.
- **Performance earns money.** Eastmoor earned Ȼ25.7m from results and prizes and finished with the most cash, Ȼ20.9m, after buying a player for Ȼ2.5m.
- **Struggling clubs bleed slowly.** Westvale Albion and Coldwater Town, without a title, fell from about Ȼ11m after their first season to 7.4–Ȼ7.5m after Season 6. That's about Ȼ1m a season, pressure that builds over several seasons rather than a sudden collapse.
- **Prudent clubs don't go broke.** The offline managers keep Ȼ3m of headroom, so nobody went bankrupt in this run. A reckless club does: one that spends almost all its cash on a signing runs out a few rounds into the season ([bankruptcy.md](bankruptcy.md)).

The numbers live in versioned tables (`apps/server/src/modules/finance/rules.ts`). Changing them means adding a version, and every ledger entry records the version that produced it. Each season keeps the version it was created with:

- **`finance/1`** was the four-club, six-round league. Seasons created under it are still settled by it.
- **`finance/2`** came in with the expansion. It works for any league size: wages and result income scale to the season's length, and the prize table runs to 10th place. A six-round season under `finance/2` pays exactly what `finance/1` did.

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
