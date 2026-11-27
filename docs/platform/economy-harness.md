# The economy balancing harness (#98)

The harness answers one question before any rule reaches the live league: what does this economy do over many seasons, many seeds and hostile strategies? It has two modes:

| Mode | Command | What's real | What's surrogate | Speed |
| --- | --- | --- | --- | --- |
| **Fast** | `bun run economy:harness` | Production finance table (`rulesFor`), wages (`wageFor`), transfer guide fee, squad limits, player attributes and overall ratings, ageing deltas and retirements (`ageing/1`), the payroll check and forfeit/takeover (`insolvency/1`) | Match results (a Poisson model on the starting sevens' strength) and managers (deterministic policies) | about 50 seasons/s for 20 clubs |
| **Integrated** | `bun run economy:integrated` | Everything above, plus the scheduler, the pinned simulator through the adapter, offline managers, and the database on a throwaway copy | Managers (offline stand-ins, no model calls) | about 3 s per match |
| Lifecycle balance | `bun run finance:balance` | The full production lifecycle over several seasons, including rollover and transfer windows | Managers (offline) | minutes per season |

Nothing here touches production, makes model calls, renders anything or writes news. Every mode creates its own state: in memory, or a throwaway database that is dropped afterwards.

## Fast mode

```sh
bun run economy:harness                                   # 20 clubs × 100 seasons × seeds 1–5 × every scenario
bun run economy:harness --smoke                           # CI-sized: 5 seasons × 2 seeds, baseline
bun run economy:harness --clubs 20 --seasons 200 --seeds 1,2,3,4,5,6,7,8 --rulesets legacy --scenarios baseline,extreme-leverage
bun run economy:harness --replay 3 --rulesets legacy --scenarios ageing-wave   # one seed; prints every invariant failure
```

The outputs go to `--out` (default `out/economy/`, which git ignores):

- `runs.json`: every season of every run;
- `seasons.csv`: one row per run per season;
- `summary.json`: aggregates per ruleset × scenario;
- the markdown report, at `--report`.

The command exits non-zero if any hard invariant fails. Pass `--allow-failures` to produce a report anyway.

### Configuration

| Option | Meaning |
| --- | --- |
| `--clubs` | League size. The calendar is a double round robin of 2(n − 1) rounds, so 20 clubs play 38 rounds and 380 fixtures. |
| `--seasons`, `--seeds` | Run length, and the seeds to run (each seed is one independent league). |
| `--rulesets` | Named rulesets (`apps/server/src/modules/economy/rulesets.ts`). `legacy` is production today: finance/2, transfer/1, insolvency/1, ageing/1. Candidate rulesets from #97 are added beside it and compared on identical seeds. |
| `--scenarios` | Stress scenarios: `baseline`, `low-liquidity`, `extreme-leverage`, `ageing-wave`, `simultaneous-defaults`, `provider-downtime`, or `all`. |

### Policy managers (`policies.ts`)

They are deliberately simple and deterministic. Their job is to cover strategies the economy must survive, not to play well:

- **conservative.** One upgrade a window at up to the guide fee, keeping a season's wages in hand.
- **aggressive.** Two upgrades at up to 1.3× the guide fee, spending down to three rounds of wages.
- **trader.** Buys players aged 23 or under, and sells players aged 28 or over at 1.2× the guide fee.
- **adaptive.** Plays aggressive with two seasons of wages in hand, conservative otherwise.
- **opportunist.** Bids 0.7× the guide fee for the best players at clubs short of money.

Every seller keeps its two best players unless offered 2× the guide fee. A seller short of cash, with less than a third of a season's wages, sells at 0.8× the guide fee. Under `provider-downtime`, each decision fails 30% of the time: the club does nothing, and an offer it receives lapses, so the player stays. That matches the production rule that an unavailable manager has made no choice.

### What it measures

All amounts are whole credits (cr). Distributions across seeds are reported as the median, with the 10th–90th percentile range.

- **Concentration.** The Gini coefficient of cash, the richest quarter's share, and cash by final position.
- **Strategy and position.** Profitability by strategy and by final position.
- **Inflation.** Wage inflation (average wage per round, last season ÷ first) and fee levels.
- **Sources and sinks.** Totals by ledger kind: distribution, results, prizes, payroll, transfers, takeover capital and, under candidates, loans, interest and auctions.
- **Distress.** Withdrawals, takeovers and rescue capital; defaults, forced sales and club-seasons in distress (cash below three rounds of wages, or in administration).
- **Liquidity and talent supply.** Offer liquidity (bids, acceptances, deals, fell-through), retirements and new players, squad sizes, and average overall rating over time.
- **Competition.** Title concentration (the most titles by one club), distinct champions, the longest streak, and positional mobility (Spearman correlation of consecutive tables). Dynasties are allowed; the gates don't force equal outcomes.

### Hard invariants (`invariants.ts`, checked after every season of every run)

| Invariant | Rule |
| --- | --- |
| `ledger-reconciles` | Every club's cash is exactly the sum of its ledger entries |
| `unique-settlements` | No settlement key is used twice (no duplicate payment) |
| `one-registration` | A player is registered with at most one existing club; a retired player with none |
| `squad-limits` | No squad exceeds the maximum |
| `viable-squad` | Every club can field a side with a goalkeeper, and every fixture was playable |
| `no-forfeits` | For rulesets that promise it: no walkover or void fixture for financial reasons |
| `bounded-rescue` | At most one rescue (takeover capital or free support) per club per season, so no infinite bailout loop |
| `no-unaccounted-debt` | Loans exist only under a lender, with non-negative balances |
| `history-immutable` | Every completed season's results digest is unchanged at the end of the run |

To capture a failure as a regression: replay its seed (`--replay <seed> --rulesets R --scenarios S`), then add a test case to `economy.test.ts` with that config.

## Integrated mode and surrogate divergence

`bun run economy:integrated [--clubs 10] [--seasons 1]` plays real seasons on a throwaway database. It then fits the surrogate's three parameters (goals per side, home advantage, slope per rating point) by maximum likelihood, and compares goals per match, draws, home wins and favourites' wins between the real simulator and the surrogate. The latest run is in [economy-surrogate.md](economy-surrogate.md).

## Runbook: changing an economic rule

1. **Add a version.** Never edit a live version: add a ruleset (and, for production, a new `finance/N` / `insolvency/N`) next to the old one.
2. **Run the gates on the identical baseline seeds** (`--seeds 1,2,3,4,5`), then on **held-out seeds** (`--seeds 101,102,103,104,105`) that you didn't tune on.
3. **Compare** each metric with the legacy row on the same seeds, and put both reports in the PR.
4. **Check the surrogate.** If a change alters match strength or squads, rerun `economy:integrated` and compare the divergence table.
5. **Get approval.** Proposed adjustments go in a PR with the evidence. The harness never deploys rules to the live league.

## Initial acceptance gates (proposed; tune with evidence)

A candidate ruleset for the Phase 2 league must, at 20 clubs × 100 seasons on both baseline and held-out seeds:

1. **Invariants.** No hard invariant fails, in any scenario.
2. **No forfeits.** No financial forfeits in any scenario, including `simultaneous-defaults`.
3. **Bounded free money.** Rescue capital that isn't repaid is bounded and reported. Under legacy rules, takeovers inject it without limit.
4. **Concentration.** The median final Gini is ≤ 0.45 in baseline, and the richest quarter holds ≤ 60% of cash.
5. **Competition stays open.** At least 8 distinct champions per 100 seasons in baseline, and median mobility between 0.2 and 0.8. Dynasties are allowed.
6. **Liquidity.** At least one completed deal per four clubs per window in baseline. Legacy fails this by a wide margin, as the baseline report shows.
7. **Recovery.** A distressed club recovers, out of administration and with debt below its cap, within a median of three seasons.
8. **No runaway inflation.** League cash and wages don't grow or collapse without bound: the median end-of-run cash per club is within 0.25–4× the opening balance.

## Baseline findings (legacy, 20 clubs, 100 seasons, seeds 1–5; [economy-balance.md](economy-balance.md))

- **No invariants fail.** The forfeit mechanism doesn't violate legacy's own promises, because legacy makes none about forfeits.
- **Clubs forfeit regularly at 20 clubs.** In baseline, 49 forfeits and takeovers in 10,000 club-seasons (5 runs × 100 seasons × 20 clubs), with 582m cr of free rescue capital. With low opening cash this rises to 125. finance/2's prize table and result income were sized for ten clubs, and with twenty the bottom half bleeds slowly. This is the case for #97.
- **The market is almost illiquid.** Under transfer/1's guide fee and sellers' reservation prices, about 1.4% of bids are accepted: 74 deals in 500 seasons. That matches the lifecycle run, where 2 of 41 bids completed.
- **Talent drifts down.** The average overall rating falls from 66.6 to about 63 over 100 seasons. Academy graduates start 7 points below their baseline, and decline outpaces growth. Replacement supply (#96) needs calibrating.
- **Competition is open.** There are 18–19 distinct champions per run, the longest streak is 4–6 titles, and median mobility is 0.44.
