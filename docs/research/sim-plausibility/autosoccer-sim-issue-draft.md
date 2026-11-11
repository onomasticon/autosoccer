Found while investigating onomasticon/autosoccer#42 (statistical plausibility of the launch season). Over **1,200 seeded headless matches** at `38b8c6f`, through the league's pinned adapter with the production match config, two stats are implausible by a wide margin. Both look like **classification/attribution** problems in the stats and events, not physics.

| Metric (1,200 matches, seeds 1–1200) | Simulator | Rough real-world reference |
| --- | --- | --- |
| Shots on target / shots | **97.2%** | ~33% (11v11); futsal ~40–50% |
| Matches where *every* shot was on target | **1,093 of 1,114** with a shot | rare |
| Own goals / goals | **31.2%** (632 of 2,023) | ~3% |
| Matches with at least one own goal | **38.5%** | ~5–10% |

Other distributions look reasonable for a small-sided game: goals per match 1.69, 0–0 in 18%, draws 28%, no home bias, and possession 49.9% ± 5.3 pts.

## 1. Shots on target is ~100% by construction
`packages/match-runner/src/stats.ts` (the `kick` case) counts a kick as a **shot** only if its line crosses the goal line within `goalWidth/2 + 1.5` m of the centre. It counts it as **on target** within `goalWidth/2`. A shot aimed more than 1.5 m wide of a post isn't a shot at all: it falls through to the pass branch. So off-target attempts are mostly invisible, and the on-target share is near 100%.

**Expected:** a shot is classified by intent and range, for example by the kicking controller's shoot action (if exposed) or by a wider aim cone, independent of accuracy. On-target is then the subset whose line would cross between the posts (or that the keeper saves). Missed shots should appear as shots and not inflate pass counts.

**Repro:** seed 6 (Red Rock preset 7 shots / 7 on target), seed 22 (0/0 vs 7/7), seed 13 (6/6 vs 4/4). Counter-example where a miss *is* counted: seed 1 (3 shots, 1 on target).

## 2. Own goals are a third of all goals
`packages/sim-core/src/match.ts` (open play, `ball.inGoal`) sets `scorer = ball.lastTouch` and `ownGoal = teamOf(scorer) === conceding`. Any defender or keeper contact before the ball crosses the line becomes an own goal. That includes a keeper's failed catch or parry of an on-target shot, and a tackle touch that doesn't change the ball's path much.

**Expected (football convention):** credit the attacker whose shot was on target when a defender or keeper only deflects it. Record an own goal only when the defending touch puts an off-target ball into the net, or redirects a non-shot. That needs the last *attacking kick* (and whether it was on target) alongside `lastTouch`.

**Repro:** seed 3 (5 goals, 2 own), seed 4 (3 goals, 2 own), seed 9 (2–0, both own goals), seed 14 (3–0, all three own goals).

## 3. Context: preset balance (for awareness, not a bug)
At the league's opening presets, the high-line/high-press/direct/early-shooting setup (`1-1-2` high/wide/high press/direct/risky/early/often/long) wins **69%** of its matches and concedes 0.14 goals per match. The next best wins 39%. This may be intended, but it makes the league's tactical choices lopsided.

## Reproduction
From `onomasticon/autosoccer` (branch `research/42-sim-plausibility`):
```sh
bun scripts/sim-stats.ts play --matches 1200 --shard 0/1 --out out/sim-stats
bun scripts/sim-stats.ts report --out out/sim-stats
```
Each seed `n` uses `sampleRequest({ seed: n })` (default production match config). The home/away tactical presets cycle through the 25 ordered pairs of {harbour-city, red-rock-rovers, northgate-comets, saltmarsh-athletic, baseline} opening tactics, with `pair = (n − 1) mod 25`.

## Scope
No tuning has been done in `autosoccer`. Official results already played are not changed. A fix here would change stats and attribution for new matches. Please bump the engine version so the league can pin it deliberately.
