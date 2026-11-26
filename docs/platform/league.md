# The league: ten clubs

The league began with four founding clubs. It grows to ten at the first season rollover after this change: the six clubs below join, and the season becomes a double round robin of 18 rounds. Every club plays every other club home and away, once a round.

| Club | City | Manager | Style |
| --- | --- | --- | --- |
| Harbour City | Harbour City | Marta Sol | Control the ball and the tempo |
| Red Rock Rovers | Red Rock | Dex Okoro | Win it back high and go straight for goal |
| Northgate Comets | Northgate | Ines Varga | Stay compact, then break fast |
| Saltmarsh Athletic | Saltmarsh | Theo Lambert | Defend first |
| **Ironbridge United** | Ironbridge | Hal Brenner | Out-work them, win the second balls |
| **Coldwater Town** | Coldwater | Anouk Meyer | Stretch the pitch, move the ball |
| **Eastmoor Wanderers** | Eastmoor | Ruben Osei | Take players on, shoot on sight |
| **Larkfield Rangers** | Larkfield | Greta Lindholm | Find their weakness and play there |
| **Port Alder** | Port Alder | João Pereira | Press together, attack together |
| **Westvale Albion** | Westvale | Carys Whitfield | Nothing through the middle |

## What a new club starts with

- **A squad of 16 players.** Each squad was picked to be as evenly matched as the founders' under the same deterministic ratings: first sevens average 64.7–65.4 overall, full squads 64.9–65.3.
- **Player registrations and ratings** for the season.
- **An AI manager** with a persona and an opening plan.
- **The same 12m cr opening balance** every founder received ([finances.md](finances.md)).

New clubs join the transfer window before the season like everyone else.

## What changes for the season

- **Length.** There are 18 rounds instead of 6. On the daily pace (4 hours between rounds), a season takes three days.
- **Money.** Under `finance/2`, wages and result income are season amounts spread across the rounds, so a season costs a club about what it did before. Prizes run to 10th place.
- **Budgets.** Each season's spending caps grow with its length, so the managers and journalists keep the same budget per round and per match:
  - a manager's compute budget triples, for three times the rounds;
  - the newsroom's budget grows 7.5 times, for 7.5 times the matches.

  Real model spend per season grows by the same factors. Once the newsroom's budget runs out, the free offline template writer takes over.
- **News.** The league correspondent announces the expansion: the new clubs and their managers, the longer season and the new money rules ([newsroom.md](newsroom.md)).

## For operators

- **Size.** `LEAGUE_CLUBS` in `apps/server/src/modules/league/rollover.ts` sets the size. Rollover adds clubs from `ALL_TEAMS`, in the seed's order, until the league has that many.
- **Idempotent.** Clubs are seeded by slug, so repeating a rollover adds nobody twice. A season that has already been created keeps its clubs.
- **Past seasons.** Seasons created before the expansion keep four clubs and `finance/1`.
