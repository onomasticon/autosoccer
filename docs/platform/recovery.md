# Financial recovery instead of forfeits: `finance/3` and `insolvency/2` (#97, candidate)

**Status: candidate rules, not adopted.** No live season uses them. The original league keeps finance/2, transfer/1 and insolvency/1, and its walkovers and takeovers stay exactly as they were, pinned per season. These rules are for the Phase 2 league and only come into force once the harness gates pass and the operator approves them (#101).

## The principle

Financial failure never forfeits a fixture. A club that can't pay borrows, sells or is administered, and it plays every scheduled match.

- **No financial walkovers.**
- **No automatic points deductions.**
- **No free bailouts.**
- **No automatic rebrands.**

The club's own manager keeps sporting control throughout.

## finance/3: sized for 20 clubs (`finance/rules.ts`)

| | finance/2 (10 clubs) | finance/3 candidate (20 clubs) |
| --- | --- | --- |
| Distribution per season | 6m cr | 4.5m cr |
| Results | 600k cr / 250k cr per win / draw, per six rounds | 4.8m cr / 1.9m cr season amounts (126k cr / 50k cr a match over 38 rounds) |
| Prizes | 10 places (4m cr down to 200k cr), the last one repeating | Every place: 4m cr down to 300k cr, along a curve |
| Wages | Rating-based, scaled to season length | Unchanged for now. Contracted wages come with #96 |

## insolvency/2: the league lender (`insolvency/recovery.ts`)

These are pure rule functions, shared by the harness and, once integrated, by settlement.

| Facility | When | Terms (candidate numbers) |
| --- | --- | --- |
| **Secured loan** | The club asks for it, against contracted players | Up to 50% LTV on a 60% haircut of each player's guide fee. No pledge beyond a contract's expiry, and no player pledged twice. 8% interest a season, repaid over 3 seasons in per-round instalments |
| **Emergency financing** | Cash can't cover a round's wages and the debt cap still has room | Covers the shortfall only. 15% interest, 2 seasons, senior. Discretionary signings are blocked while it's outstanding |
| **Support** | In administration, when wages still can't be paid | Repayable senior support at 5%. **Never a gift.** It keeps wages paid and fixtures played |

- **Debt cap.** 0.75 seasons of the club's wage bill.
- **Default.** Default happens when a shortfall can't be met under the cap, or when an instalment is missed. Then the lender:
  1. holds a **compulsory sealed-bid auction**, open to every eligible club (one bid each). The reserve is 40% of the guide fee, and ties go to a fixed club order, never to the fastest bidder. The minimum squad and the last keeper are never sold. A player nobody bids for stays.
  2. applies the proceeds through a **waterfall**: support first, then emergency, then secured. The surplus returns to the club, and repaid loans release their liens.
  3. puts the club into **administration** if its debt is still above half the cap. Administration brings a transfer embargo, the administrator selling surplus players until debt is under the cap, and every season's surplus cash swept to the lender.
- **Leaving administration.** A club exits when its debt is at most half the cap and it holds three rounds of wages in cash.

## Results in the harness

20 clubs × 100 seasons, seeds 1–5, with held-out seeds 101–105. Reports: [baseline](economy-balance.md), [held-out](economy-balance-heldout.md).

| | legacy | candidate |
| --- | --- | --- |
| Hard-invariant failures (all scenarios, baseline and held-out seeds) | 0 | 0 |
| Financial forfeits, baseline (held-out) | 51 (44) | **0 (0)** |
| Financial forfeits, simultaneous defaults (held-out) | 130 (113) | **0 (0)** |
| Free rescue capital, baseline | 605m cr | **0 cr** |
| Simultaneous defaults: emergency loans / forced sales / administrations / recoveries | – | 30 / 36 / 31 / 31, median 1 season to recover |
| Final Gini, baseline | 0.34 | 0.14 |
| League cash after 100 seasons, baseline | 869m cr | **2,725m cr** |
| Completed deals, baseline (500 seasons) | 83 | 11 |

**What it shows:**

- **The recovery mechanics work.** Every fixture is played. Distressed clubs borrow, sell, are administered and recover, usually within a season. Nobody gets free money, and the ledger reconciles throughout.
- **finance/3 isn't calibrated yet: it inflates.** League cash ends at about 2.7bn cr, around 136m cr a club, so it fails gate 8 (end cash per club within 0.25–4× the opening balance). With 14-player squads the wage bill is lower than the income finance/3 pays.
  - Cutting the distribution to 4.0m cr (`candidate-lean`) still inflates (84m cr a club) and starts pushing clubs into distress.
  - Raising it, or flattening the prize curve, inflates more.
  - The missing piece is a sink that grows with ambition: negotiated, market-priced contract wages (#96) and operating costs. Lowering the league's income isn't enough.
- **The harness found and fixed a real bug.** Forced sales could sell a club's second keeper, because the list of sellable players was computed once (`candidate-lean`, seed 3, season 35). Sales now re-check after each one, and the case is a regression test.
- **Liquidity is still poor** under every ruleset. The market's reservation prices need work alongside #96.

## Not yet (next increments)

- **Persistence.** Database tables for loans, liens, auctions and administration, settled exactly once at round and window boundaries.
- **Mid-season defaults.** Settlement must respect registration windows (a player sold at a mid-season auction joins at the next boundary) while fixtures stay playable.
- **Calibration.** finance/3 against #96's contract wages and operating costs, until every acceptance gate passes on baseline and held-out seeds.
- **Fan-facing pages** for loans, defaults, auctions and recoveries (#100).
