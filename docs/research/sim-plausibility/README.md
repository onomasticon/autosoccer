# Simulator statistical plausibility (#42 companion investigation)

**Question.** The launch season's two opening matches had 9 of 9 shots on target and 2 own goals among 5 goals. Is that a fluke of a tiny sample, or a property of the simulator?

**Answer.** It's a property of the simulator, and it comes from **stat classification and goal attribution**, not physics. Over 1,200 seeded matches, **97.2%** of shots are on target and **31.2%** of goals are own goals. Other distributions look reasonable for a 5v5 game. **No tuning has been done in this repository, and no official result is changed.**

## Method
- **Simulator:** `autosoccer-sim` at `38b8c6f` (the pinned submodule; `SIM_VERSION`), driven through `@autosoccer/sim-adapter`'s `runMatch`. This is the same path as official league matches, with the production default match config (`sampleRequest({ seed })`, no config overrides).
- **Seeds:** 1–1200, one match each.
- **Tactics:** for seed `n`, the home and away presets are the ordered pair `(n − 1) mod 25` of five presets: the four clubs' opening tactics (`managers-seed.ts`) plus `DEFAULT_TACTICS`. Every preset appears 480 times.
- **Harness:** [`scripts/sim-stats.ts`](../../../scripts/sim-stats.ts), run as 6 shards in parallel. It is read-only and touches no database. The per-match rows are in [`matches.jsonl`](matches.jsonl), and the aggregates in [`summary.json`](summary.json).

```sh
bun scripts/sim-stats.ts play --matches 1200 --shard 0/1 --out out/sim-stats   # or shard i/6 ×6 in parallel
bun scripts/sim-stats.ts report --out out/sim-stats
```

## Distributions (1,200 matches)
| Metric | Value | Reading |
| --- | --- | --- |
| Goals per match | 1.69 (sd 1.31) | plausible for 2×2-minute 5v5 |
| Goals histogram (0,1,2,3,4,5,6,7) | 216, 389, 311, 178, 68, 23, 13, 2 | unimodal, sensible tail |
| 0–0 / draws | 18.0% / 28.3% | plausible |
| Home / away wins | 36.6% / 35.1% | no home bias (none modelled) |
| Shots per match | 3.34 | low (see below) |
| **Shots on target / shots** | **97.2%** | **implausible** (real 11v11 ≈ 33%; futsal ≈ 40–50%) |
| **Matches where every shot was on target** | **1,093 / 1,114** with a shot | **implausible** |
| Goals per shot on target | 0.52 | high, partly because off-target attempts are missing |
| **Own goals / goals** | **31.2%** (632 / 2,023) | **implausible** (real ≈ 3%) |
| Matches with an own goal | 38.5% | implausible |
| Home possession | 49.9% ± 5.3 pts | narrow: possession rarely leaves 40–60% |
| Side with more of the ball wins (decided matches) | 45.8% | possession weakly *anti*-correlated with winning |
| Fouls per match | 6.2 | |

### By tactical preset (as either side)
| Preset | Win | Draw | GF | GA | Shots | Poss |
| --- | --- | --- | --- | --- | --- | --- |
| harbour-city (2-1-1 mid, patient, safe) | 24.2% | 29.2% | 0.63 | 1.11 | 1.15 | 51.5% |
| **red-rock-rovers** (1-1-2 high line, high press, direct, early) | **69.4%** | 23.5% | 1.45 | **0.14** | 3.42 | 49.9% |
| northgate-comets (2-2 deep, direct) | 39.4% | 25.8% | 1.00 | 0.99 | 1.91 | 45.5% |
| saltmarsh-athletic (3-1, selective, safe) | 16.9% | 32.7% | 0.41 | 0.95 | 0.53 | 52.4% |
| baseline (`DEFAULT_TACTICS`) | 29.4% | 30.4% | 0.72 | 1.02 | 1.33 | 50.7% |

Tactics clearly matter, which is good for an AI-manager league. One preset dominates, though: it concedes 0.14 goals per match. That is a balance question for the simulator, not a bug.

## Likely causes (read from the pinned simulator source)
1. **Shots.** `packages/match-runner/src/stats.ts` counts a kick as a shot only if its line crosses the goal line within `goalWidth/2 + 1.5` m. Wider attempts are counted as passes, so "on target" is nearly guaranteed by construction. It also undercounts shots and inflates passes.
2. **Own goals.** `packages/sim-core/src/match.ts` attributes every goal to `ball.lastTouch`. A keeper's failed save or a defender's brush on an on-target shot becomes an own goal.

These explain the launch-season sample. In the live data, all 4 played matches had shots equal to shots on target (14 of 14), and 2 of the first 5 goals were own goals.

## Follow-up
**The issue in `onomasticon/autosoccer-sim` is drafted but not yet filed:** [`autosoccer-sim-issue-draft.md`](autosoccer-sim-issue-draft.md). It contains reproduction seeds (3, 4, 9, 14 for own goals; 6, 13, 22 for all-on-target; 1 as a counter-example) and the expected behaviour. Filing it needs someone with access to that repository.

Until the engine changes, editorial copy should avoid making much of "shots on target" and own goals. The match stats themselves remain the official record.
