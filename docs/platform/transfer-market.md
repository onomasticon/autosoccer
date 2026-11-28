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

## Persistence and the managers' tools (`modules/contracts`, migration 0018)

These apply only to seasons whose `transfer_rule` is `transfer/2`. The original league is untouched.

| Table | What it holds |
| --- | --- |
| `player_contracts` | A wage per season for a run of football years, and how it was signed (founding, recruitment, renewal, free agent, transfer, safety net). **At most one active contract per player**, enforced by a unique index |
| `market_windows` | The preseason window (renewals, then free agency) and the midseason window (free agency only), each with its effective round and a hard deadline |
| `contract_decisions` | Each club's renew or release call on each expiring contract, from its manager or the safe default |
| `free_agent_offers` | Wage offers to free agents, and each offer's outcome |
| `registration_moves` | A move during a season, effective from a round. Season-start registrations stay in `player_registrations`, so a lineup or payroll can be read **as of its round** (`registeredTeam`) |
| `players.team_id` | Now nullable: a free agent belongs to no club. Only transfer/2 ever releases a player |

**The managers' tools.** Each is a structured decision, the same for every model, recorded as a manager run with its prompt, output, tokens and cost:

- **Renewals.** For each expiring contract, `renew` (a new contract at the market wage) or `release`.
- **Free agency.** Up to 5 offers, each a wage per season (at least the player's minimum) and 1–4 years, committing no more than the club's cash.

**Validation.** The platform checks every decision against the facts. An offer below the minimum, for someone who isn't a free agent, or beyond the club's cash is dropped with a reason. An answer that arrives after its step has ended is refused.

**Settlement.**
- **Atomic and exactly once.** Each step settles under a row lock on the window, and only from its own phase.
- **Renewals.** A contract nobody decided on is renewed (the safe default). A release frees the player: he leaves his club, his season registration and his wage.
- **Free agency.** Every offer is settled together through recruit/1's offer round: the player picks the offer that suits him, and ties go to a seeded order. A signing gets a club, the lowest free shirt number, a contract and a registration: from round 1 in preseason, or a registration move from the window's round in midseason. No fee changes hands.

**Evidence.** `contracts.test.ts` runs a full preseason window and a midseason move on a real database:
- a manager that never answers gets the defaults, and decisions are idempotent;
- releases become free agents, and free agency settles once;
- no fees, unique shirts, and one active contract per player;
- late answers are refused;
- round 3 reads the old club and round 4 the new one.

## Not yet

- **The calendar.** Opening, moving through and closing windows from calendar/1 in the scheduler (#99), and enqueueing each club's decision as a job.
- **Payroll from contracts.** finance/3 settlement in the database: wages from `player_contracts`, plus running costs, loans and administration (#97).
- **Founding contracts.** Founding and recruitment signings write their contracts (recruit/1 persistence).
- **Public pages** for releases, free signings and the midseason window (#100).
