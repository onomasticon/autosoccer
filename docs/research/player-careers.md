# Player careers: development rule and balance (issue #70)

## Sources of truth
| What | Where | Kind |
| --- | --- | --- |
| Identity (name, shirt, position) | `players` | record |
| Baseline ratings | `league/attributes.ts`: deterministic from name, shirt and position | derived |
| Season ratings | `player_ratings` (one row per player per season), written at rollover | derived (`develop/1` or `baseline`) |
| Starts | each match's frozen `request.{home,away}.starters` | record |
| Goals | official `goal` events (own goals don't count for the scorer) | record |
| Recent form | the club's last 3 (managers) or 5 (site) matches this season: starts and goals | derived from the record |

- **Seasons from before snapshots** (production seasons 1–4) have no rows, and render with the baseline, labelled as such.
- **The first snapshot:** the first season created after this ships is developed from its predecessor's record, starting from the baseline.

## `develop/1`
Applied once per player when a season is created, from the previous season's ratings and record:
1. **Regular starter** (≥ half the club's matches): +1 to the position's two key ratings:
   - goalkeepers: goalkeeping and agility;
   - defenders: tackling and stamina;
   - midfielders: passing and control;
   - forwards: shooting and control.
2. **No starts** while the club played: −1 stamina and −1 to the main key rating.
3. **Outfield scorer** (≥ 2 goals and ≥ 0.4 a start): +1 shooting.
4. **Ceilings:** growth stops at 85, and ratings at 88 or above fall back by 1.
5. **Seasonal variation:** one seeded ±1 on one rating, from the player id and season slug (not the club or the name).

Each rating moves at most 2 points a season and stays within 25–95. A snapshot's `basis` records the season, the record and every change with its reasons, which the team page shows.

## Guarantees (tested)
- **Deterministic and idempotent:** the same inputs give the same snapshot. Snapshots are written `on conflict do nothing`, so retries or repeated rollovers never develop anyone twice.
- **Forward-only:** a played match's frozen request, and its hash, is unchanged after development. New fixtures, and managers' pre-match facts, use the fixture's season snapshot.
- **No invented data:** no ages, injuries, moods, assists or xG.

## Balance
- **The study:** `bun scripts/career-balance.ts --seasons 10` applies the rule with the same representative record for every club: the first seven start every match, the forward scores 4 a season, a midfielder 1, and reserves don't play.

```
season  0  first seven 65.0 / 64.7 / 65.0 / 65.0  (spread 0.29)  squads 65.4 / 66.2 / 65.8 / 65.9  top rating 85
season  1  first seven 65.4 / 65.1 / 65.6 / 65.9  (spread 0.71)  squads 65.4 / 66.0 / 65.9 / 66.2  top rating 85
season  5  first seven 68.0 / 66.9 / 67.3 / 68.1  (spread 1.29)  squads 65.6 / 65.8 / 65.6 / 66.2  top rating 86
season 10  first seven 70.4 / 69.0 / 69.6 / 70.4  (spread 1.43)  squads 65.4 / 65.6 / 65.5 / 66.0  top rating 87
```

- **Clubs stay balanced:** after 10 seasons the clubs' first sevens are within 1.5 overall of each other. The spread comes from the seeded ±1s, not from club names.
- **Squads stay flat:** squad averages hold steady, because reserves lose a little.
- **Bounded growth:** regular starters gain about 0.5 overall a season. That's bounded by the per-rating ceiling, and the top rating stays at 85–87.
- **Real seasons spread playing time more:** managers rotate and lineups change, so real development is slower than this worst case.
- **The test:** the integration test checks a real played season and its rollover. No club's first seven moves more than 1.5 relative to the others.

## Not in scope
Transfers, contracts, ages and injuries. If richer per-player match telemetry is wanted (minutes, touches, shots), it should come from the simulator's replay log as a companion `autosoccer-sim` issue, not be inferred here.
