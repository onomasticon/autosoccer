# A market that moves: `transfer/2` (#96, candidate)

**Status: candidate, calibrated in the economy harness.** It's not used by any live season. The original league keeps `transfer/1`: a preseason window where sellers can refuse any offer. This page covers the Phase 2 rules and why they were chosen. Rule numbers: `TRANSFER_2` in `apps/server/src/modules/transfers/rules.ts`.

## Why the market needed changing

Under `transfer/1`, with finance/3, almost nobody moved: 230 deals in 500 simulated seasons of 20 clubs, or 0.02 deals per club per window. Gate 6 asks for at least 0.25. The cause isn't money. It's that every move needed a buyer and a seller to agree a fee, with nothing pushing players to move. In real football most movement is structural: contracts end, players move on, and squads turn over.

## The rules

| Mechanism | Rule | Default |
| --- | --- | --- |
| **Contracts** (finance/3) | A wage is fixed for 1–4 seasons: 3 under 27, 2 from 27, 1 from 31 | on |
| **Free agency** | When a contract ends, the club renews or releases the player. A released player is a free agent, and any club can sign him for **wages alone** (no fee). He chooses the best wage offer; ties go to a fixed order, never the fastest club | **on** |
| **Two windows** | Preseason and midseason (calendar/1's 24h break). Contracts are priced when they're signed | **on** |
| **Listings** | A club lists players at an asking fee. Listing doesn't oblige it to sell | on (non-binding) |
| **Binding listings** | A bid at or above the asking fee completes the sale with no veto | available, **off** |

**Hard rules still hold:** squad limits, keepers, budget, one club per player, no fees for unattached players. Every free signing is a ledger-free move (no fee). Every fee is paid by one club and received by another.

## Calibration (economy harness, 20 clubs × 100 seasons)

Every mechanism was switched off in turn, on seeds 1–5 across baseline, stress and leverage scenarios, then confirmed on all six scenarios and on held-out seeds 101–105. 0 invariant failures throughout.

| Ruleset | Deals per club per window (gate ≥ 0.25) | Gini, baseline (≤ 0.45) | Richest quarter (≤ 60%) | League cash, baseline (≤ Ȼ960m) | Administrations, baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| finance/3 only (`candidate`) | 0.02 | 0.33 | 43% | Ȼ955m | 173 |
| **transfer/2 (`candidate-t2`)** | **0.69** | **0.41** | **49%** | **Ȼ927m** | 776 |
| … with binding listings | 0.75 | 0.47 | 54% | Ȼ896m | 982 |
| … without free agency | 0.10 | 0.69 | 82% | Ȼ977m | 1,122 |
| … without the midseason window | 1.34 (fewer windows) | 0.38 | 46% | Ȼ1,024m | 491 |

On held-out seeds, `candidate-t2` gives 0.67 deals per club per window, a Gini of 0.40 and Ȼ1,055m in league cash.

**What it shows:**

- **Free agency is the engine of liquidity.** About 12,000 free signings per 500 seasons, plus about 10× as many fee-paying transfers as before. Without it, the market stays stuck.
- **Binding listings concentrate money.** Rich clubs pick up listed players cheaply. They add little liquidity and push the Gini over the limit, so they're off.
- **The midseason window.** Without it there are fewer windows. Each window is busier, money inflates (Ȼ1,024m) and title concentration rises (one club took 45% of titles in one run), so the window stays on.
- **Distress rises,** with 776 administrations per 10,000 club-seasons in baseline against 173. Clubs now compete for released players' wages, and the poorer ones lose players to wage offers. Every club recovers, with a median of one season, and every fixture is played.
- **Competition stays open but less even.** 17–18 distinct champions per run (gate ≥ 8), mobility 0.57, and the most titles by one club 24–35%. Dynasties are possible, which the gates allow.

## Acceptance gates for the full Phase 2 candidate (finance/3 + insolvency/2 + transfer/2)

| Gate | Baseline seeds | Held-out seeds |
| --- | --- | --- |
| 1 Invariants | ✅ 0 failures, all 6 scenarios | ✅ |
| 2 No forfeits | ✅ | ✅ |
| 3 No free money | ✅ | ✅ |
| 4 Concentration | ✅ Gini 0.41, richest quarter 49% | ✅ 0.40, 48% |
| 5 Open competition | ✅ 17–18 champions, mobility 0.57 | ✅ |
| 6 Liquidity | ✅ 0.69 | ✅ 0.67 |
| 7 Recovery | ✅ median 1 season | ✅ |
| 8 No runaway inflation | ✅ Ȼ927m | ⚠️ Ȼ1,055m (10% over) |

**Seven of eight gates pass on both seed sets.** Inflation is inside on baseline seeds and about 10% over on held-out seeds. The next lever is the size of running costs or the distribution. Last time, though, 1.1m of running costs broke the debt bound under stress, so this needs a small, careful step, or acceptance of slightly looser gate 8.

## Not yet

- **Persistence.** Contracts, effective-dated registrations, releases, free-agent rounds and the midseason window, in the database with exactly-once settlement. This builds on recruit/1's offer rounds.
- **Manager tools.** LLM managers get renewal, release and free-agent decisions as structured tools, alongside listings and bids.
- **Public pages** for releases, free signings and the midseason window (#100).
