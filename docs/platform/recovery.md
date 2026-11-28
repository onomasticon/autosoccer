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
| Distribution per season | Ȼ6m | Ȼ4.5m |
| Results | Ȼ600k / Ȼ250k per win / draw, per six rounds | Ȼ4.8m / Ȼ1.9m season amounts (Ȼ126k / Ȼ50k a match over 38 rounds) |
| Prizes | 10 places (Ȼ4m down to Ȼ200k), the last one repeating | Every place: Ȼ4m down to Ȼ300k, along a curve |
| Wages | Rating-based, recomputed every season | **Contracted**: priced from the rating when signed or renewed, then fixed for the contract (3 seasons under 27, 2 to 30, 1 from 31) |
| Running costs | none | **Ȼ1m a season** per club (staff, travel, ground), paid in equal shares each round |
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

20 clubs × 100 seasons, seeds 1–5, with held-out seeds 101–105. Reports: [baseline](economy-balance.md), [held-out](economy-balance-heldout.md). The candidate is shown before calibration (v0: no contracts, no running costs) and after it (contracts plus Ȼ1m of running costs).

| | legacy | candidate v0 | **candidate (calibrated)** |
| --- | --- | --- | --- |
| Hard-invariant failures (6 scenarios; baseline and held-out) | 0 | 0 | **0** |
| Financial forfeits, baseline / stress (held-out) | 51 / 130 (44 / 113) | 0 / 0 | **0 / 0 (0 / 0)** |
| Free rescue capital, baseline | Ȼ605m | Ȼ0 | **Ȼ0** |
| League cash after 100 seasons, baseline (held-out) | Ȼ869m (Ȼ939m) | Ȼ2,725m | **Ȼ955m (Ȼ1,035m)** |
| Final Gini, baseline | 0.34 | 0.14 | 0.33 |
| Administrations, baseline / stress, per 10,000 club-seasons | – | 0 / 31 | 173 / 1,475, median 1 season to recover |
| Completed deals, baseline, 500 seasons (held-out) | 83 (82) | 11 | 230 (291) |
| Distinct champions per run / mobility | 19 / 0.39 | 19 / 0.43 | 18 / 0.50 |

**What it shows:**

- **The recovery mechanics work.** Every fixture is played. Distressed clubs borrow, sell, are administered and recover, usually within a season. Nobody gets free money, and the ledger reconciles throughout.
- **Calibration found a narrow working band.** Contracts plus a flat Ȼ1m of running costs bring league money back to legacy's level. Several alternatives were tried on the same seeds:
  - **Contracts alone, with no running costs,** still inflate (about Ȼ3bn). Flat costs between 0 and Ȼ1m weren't tested on their own.
  - **1.1–Ȼ1.2m** breaks the debt bound under stress: clubs collapse into permanent debt (1.1m: 531 failures; 1.2m: Gini 0.78 under stress).
  - **Ȼ1.5m** breaks it everywhere.
  - **Running costs as a share of income** (2–20%) and **market-priced wages** (alpha 0.5–1) are no better. Under stress the shares break the debt bound, and the market-priced wages concentrate money.
- **Acceptance gates for the calibrated candidate** ([economy-harness.md](economy-harness.md#initial-acceptance-gates-proposed-tune-with-evidence)):
  - **Pass:** 1 (invariants), 2 (no forfeits), 3 (no free money), 4 (Gini ≤ 0.45 and the richest quarter ≤ 60% in baseline), 5 (open competition) and 7 (recovery within a season).
  - **Borderline, gate 8 (no runaway inflation):** baseline is just inside the limit at Ȼ955m against 960m, held-out is 8% over, and the ageing-wave scenario is 16% over.
  - **Gate 6 (liquidity):** this failed with transfer/1, at 230–291 deals. **[transfer/2](transfer-market.md) fixes it:** free agency and a midseason window lift it to 0.69 deals per club per window, against a gate of 0.25, while concentration stays inside its gate. With transfer/2, seven of eight gates pass on both seed sets.
- **The band is narrow.** That's because income and costs are both fixed amounts. A self-correcting money supply needs a working transfer market, where money moves between clubs. Liquidity is therefore the next lever, before finance/3 is adopted.
- **The harness found and fixed a real bug.** Forced sales could sell a club's second keeper, because the list of sellable players was computed once (`candidate-lean`, seed 3, season 35). Sales now re-check after each one, and the case is a regression test.

## In the database (`insolvency/lender.ts`, migration 0020)

Phase 2 seasons (`insolvency_rule = 'insolvency/2'`) run the lender for real, using the same rule functions the harness calibrated. insolvency/1 seasons are untouched: the old check now runs only for them.

| Table | What it holds |
| --- | --- |
| `club_loans` + `loan_entries` | Each loan, and its debt ledger: disbursement, interest and repayments. A balance is the sum of its entries, one row per obligation |
| `loan_liens` | Players pledged as collateral. At most one active pledge per player (unique index) |
| `lender_checks` | The lender's check of each club before each round: solvent, emergency or default, with the numbers. One per club per round, which is what makes it exactly once |
| `administrations` | When a club entered administration, with what debt, and when it left |
| `collateral_auctions` | Every forced auction: each eligible club's sealed bid, the reserve, and the winner or failure |

Club treasury entries use the new ledger kinds `loan`, `repayment` and `auction`.

**Before each round** (advanceSeason, before release), each club's obligations are counted: contract wages, running costs and loan instalments. A club that can't meet them:
1. **borrows emergency financing** if it fits under the debt cap;
2. **otherwise defaults:**
   - auctions players one at a time until its debt is under the cap and the round is covered. The minimum squad and the last keeper are never sold. A sold player moves with his contract and registration from that round, and his liens are released;
   - applies the proceeds senior-first;
   - enters **administration** if its debt is still above half the cap;
   - takes **repayable support** for what's still short.

Instalments are then taken. Every fixture is played.

**At season end** interest accrues. An administered club's surplus over three rounds of wages is swept to the lender, and it leaves administration once its debt is at most half its cap and it has three rounds of wages in hand.

**Secured loans** (`borrowSecured`) lend at most 50% LTV of the pledged players' haircut value, within the debt cap. They're refused for a player already pledged, one whose contract ends before the loan does, or one from another club, and refused outright in administration or while emergency financing is outstanding.

**Interim auction bids.** Until managers get an auction tool, a club bids by a fixed league rule: it bids when the player would play for it and it can pay with three rounds of wages in hand.

**Evidence.** `insolvency/lender.test.ts` plays a full distressed season through the real scheduler and worker. Three clubs pay Ȼ6m a player, against about Ȼ23m of money a season, and the fourth is cheap.
- **Every fixture is played:** no withdrawals, walkovers or void matches.
- **The lender uses every tool:** emergency loans, defaults, forced auctions with real sales, administration and support.
- **Sold players move cleanly:** each is registered with his new club from the auction's round, and his contract moves with him.
- **Squads stay viable** (9 or more, with a keeper), and every club ends with cash of zero or more.
- **The books balance:**
  - every loan equals the sum of its entries;
  - cash lent equals disbursements, and cash repaid equals repayments;
  - auctions net to zero between clubs;
  - no takeover money;
  - interest accrues.
- **Checks run exactly once.**

The secured-loan limits are tested on a separate solvent league.

## Not yet (next increments)

- **Manager tools.** Secured borrowing requests and auction bids as structured manager decisions; today they're operator and league-rule driven.
- **Fan-facing pages** for loans, defaults, auctions and recoveries (#100).
- **Inflation on held-out seeds** (gate 8, about 10% over with transfer/2). Take one careful step on running costs or the distribution, or accept a looser gate. Then adopt finance/3, insolvency/2 and transfer/2 together.
