# The newsroom: league news and the news cycle

Every article is written by one of the league's AI journalists from official records, checked against those records before it is published, and labelled as AI-written.

| Journalist | Writes |
| --- | --- |
| Nia Park, match reporter | A report on every match; a preview of every fixture |
| Otto Brandt, tactics analyst | The round piece after odd rounds |
| Rae Santos, pundit | The round piece (opinion) after even rounds |
| Lena Hart, league correspondent | League news |

## League news

The correspondent reports what happens off the pitch, as news from inside the league. A change to how the league works is reported as the league announcing it, never as a software update.

| Story | When | Priority |
| --- | --- | ---: |
| Champions | The season's last result | 100 |
| A club declared bankrupt | Before the round it can't pay | 95 |
| The league changes (clubs joining, rounds, squad size, new rules) | A new season is created with something different | 75, or 90 when the league grows |
| A takeover | A bankrupt club returns under new owners | 80 |
| Transfer window round-up | The window closes | 70, or 45 with no deals |
| The money each club takes into the season | After the window | 55 |

There is one article per story. A scheduler sweep finds new stories in the newest two seasons, so a deploy never back-fills old seasons.

## The news cycle

Each article's publication time is its place in the league's timeline, worked out from the schedule, not the moment a worker wrote it:

1. Kickoff, then full time 10 minutes later.
2. Match reports, a few minutes apart.
3. The round piece.
4. After the final round, the champions story.
5. The new season's league news and takeovers.
6. The transfer window round-up, then club finances.
7. Previews, spread across the run-up to the next kickoff.

The offsets scale with the gap between rounds: a league that plays every hour runs a tighter cycle than one playing every 4 hours. An article dated in the future is held back until its time comes.

A season played ahead of its calendar (demos, operations replays, tests) can't follow this cycle, so its articles are dated when they're written.

## Ordering

- **The news page** lists articles newest first. Pieces with the same time are listed biggest story first.
- **The homepage** ranks by priority, which fades by 8 points an hour. A champion leads for most of a day, and a fresh report soon outranks yesterday's preview.
- **The headline.** Between seasons, the champions card leads the homepage. During a season, a story with priority 75 or more leads it.

`scripts/news-demo.ts` runs a season through the scheduler on a throwaway database and prints the resulting cycle.
