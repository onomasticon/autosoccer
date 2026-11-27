# Financial recovery instead of forfeits: `finance/3` and `insolvency/2` (#97, candidate)

**Status: candidate rules, calibrated but not adopted** (gates 6 and 8 are still open; see Results). No live season uses them. The original league keeps finance/2, transfer/1 and insolvency/1, and its walkovers and takeovers stay exactly as they were, pinned per season. These rules are for the Phase 2 league and only come into force once the harness gates pass and the operator approves them (#101).

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
| Wages | Rating-based, recomputed every season | **Contracted**: priced from the rating when signed or renewed, then fixed for the contract (3 seasons under 27, 2 to 30, 1 from 31) |
| Running costs | none | **1m cr a season** per club (staff, travel, ground), paid in equal shares each round |
| Market-priced wages | – | Available (`wageMarket`) but **off**: it stops inflation but concentrates money (Gini 0.49–0.56) |

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

20 clubs × 100 seasons, seeds 1–5, with held-out seeds 101–105. Reports: [baseline](economy-balance.md), [held-out](economy-balance-heldout.md). The candidate is shown before calibration (v0: no contracts, no running costs) and after it (contracts plus 1m cr of running costs).

| | legacy | candidate v0 | **candidate (calibrated)** |
| --- | --- | --- | --- |
| Hard-invariant failures (6 scenarios; baseline and held-out) | 0 | 0 | **0** |
| Financial forfeits, baseline / stress (held-out) | 51 / 130 (44 / 113) | 0 / 0 | **0 / 0 (0 / 0)** |
| Free rescue capital, baseline | 605m cr | 0 cr | **0 cr** |
| League cash after 100 seasons, baseline (held-out) | 869m cr (939m cr) | 2,725m cr | **955m cr (1,035m cr)** |
| Final Gini, baseline | 0.34 | 0.14 | 0.33 |
| Administrations, baseline / stress, per 10,000 club-seasons | – | 0 / 31 | 173 / 1,475, median 1 season to recover |
| Completed deals, baseline, 500 seasons (held-out) | 83 (82) | 11 | 230 (291) |
| Distinct champions per run / mobility | 19 / 0.39 | 19 / 0.43 | 18 / 0.50 |

**What it shows:**

- **The recovery mechanics work.** Every fixture is played. Distressed clubs borrow, sell, are administered and recover, usually within a season. Nobody gets free money, and the ledger reconciles throughout.
- **Calibration found a narrow working band.** Contracts plus a flat 1m cr of running costs bring league money back to legacy's level. Several alternatives were tried on the same seeds:
  - **Contracts alone, with no running costs,** still inflate (about 3bn cr). Flat costs between 0 and 1m cr weren't tested on their own.
  - **1.1–1.2m cr** breaks the debt bound under stress: clubs collapse into permanent debt (1.1m: 531 failures; 1.2m: Gini 0.78 under stress).
  - **1.5m cr** breaks it everywhere.
  - **Running costs as a share of income** (2–20%) and **market-priced wages** (alpha 0.5–1) are no better. Under stress the shares break the debt bound, and the market-priced wages concentrate money.
- **Acceptance gates for the calibrated candidate** ([economy-harness.md](economy-harness.md#initial-acceptance-gates-proposed-tune-with-evidence)):
  - **Pass:** 1 (invariants), 2 (no forfeits), 3 (no free money), 4 (Gini ≤ 0.45 and the richest quarter ≤ 60% in baseline), 5 (open competition) and 7 (recovery within a season).
  - **Borderline, gate 8 (no runaway inflation):** baseline is just inside the limit at 955m cr against 960m, held-out is 8% over, and the ageing-wave scenario is 16% over.
  - **Fail, gate 6 (liquidity):** 230–291 deals against roughly 2,500 needed. That's still 3× legacy, but it's a transfer-market design problem (bidding policies and reservation prices). Finance can't fix it.
- **The band is narrow.** That's because income and costs are both fixed amounts. A self-correcting money supply needs a working transfer market, where money moves between clubs. Liquidity is therefore the next lever, before finance/3 is adopted.
- **The harness found and fixed a real bug.** Forced sales could sell a club's second keeper, because the list of sellable players was computed once (`candidate-lean`, seed 3, season 35). Sales now re-check after each one, and the case is a regression test.

## Not yet (next increments)

- **Persistence.** Database tables for loans, liens, auctions and administration, settled exactly once at round and window boundaries.
- **Mid-season defaults.** Settlement must respect registration windows (a player sold at a mid-season auction joins at the next boundary) while fixtures stay playable.
- **Liquidity.** Bidding and reservation-price rules (with #96's market), until gates 6 and 8 pass on baseline and held-out seeds. Then adopt finance/3.
- **Fan-facing pages** for loans, defaults, auctions and recoveries (#100).
