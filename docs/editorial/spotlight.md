# Homepage spotlight (`spotlight/1`)

The homepage opens with one named player before it asks a visitor to choose a club. It shows what that player did, one verified detail that makes it matter, and one specific action, such as "Watch Nyberg's three goals". Everything comes from official match events and frozen lineups. No sentence is written by an LLM, and nothing is computed while the page renders.

- API: `GET /api/v1/spotlight` (`SpotlightResponse`) returns `lead` plus each club's latest moment (`clubs`).
- Code: `apps/server/src/modules/spotlight/rule.ts` (the rule) and `read.ts` (the data it reads).
- Tests: `rule.test.ts` uses fixture data shaped like the live examples, and `spotlight.test.ts` runs against simulated rounds.

## Which round

The lead comes from the **latest completed round**: the highest round of the current season in which every fixture is completed. Before the new season's first round finishes (season rollover), it is the last completed round of the most recent earlier season. A round that is only partly played does not replace the previous lead.

## Which player

The candidates are every player who scored in that round (own goals are excluded). They are ranked by:

1. **Goals in the match.** A hat-trick beats two goals, and two goals beat one.
2. **A decisive goal.** The *winner* beats the *equaliser*, which beats neither. The winner is the goal that took the scorer's side to the loser's final total plus one, the point after which they led for good. The equaliser is the goal that produced a drawn final score.
3. **The side's result.** A win ranks above a draw, and a draw above a defeat.
4. **The later key goal.** This is the decisive goal, or else the player's last goal, because a late winner is the bigger moment.
5. **Name, then player id.** This makes the choice independent of query order. The tests check that reversing the match order gives the same lead.

## The detail

The detail is the first of these that applies:

1. Two of the player's goals came within **60 match seconds** of each other in the same half: "Two of them came 26 match seconds apart."
2. The player is the league's all-time top scorer (or joint top): "… 53 goals in 61 starts."
3. The player tops the season's scoring chart with at least 2 goals.
4. The goal was the winner: "It was the only goal of the match." or "The winner came at 2H 1:50."
5. The goal was the equaliser: "The equaliser came at …".
6. Otherwise, the player's career total: "It took Moon to 53 league goals in 61 starts."

"Starts" means matches the player started, taken from the frozen lineups. The tables label this column *MP*.

## Edge states

| State | Lead | Primary action |
| --- | --- | --- |
| Goals in the round, replay stored | The top-ranked scorer | The match centre with `?clip=<player>#replay`, which plays their goals with 7 s of build-up, picks the player out on the pitch and offers their career at the end |
| Goals in the round, no replay | The top-ranked scorer | "Read the record of X's match" (the match centre's timeline) |
| Scoreless round | The season's leading scorer (else the all-time leader), kind `quiet` | Their club's next Matchday, else their career |
| Season rollover, nothing scheduled yet | Taken from the previous season's last round | The clip; `next` is null, so there is no next-match link |
| No goals ever | `lead: null` | The homepage falls back to the lead article and the latest replay |

## Club moments and reasons to choose a side

`clubs[]` applies the same rule to each club's latest completed match, counting that club's scorers only. Under **Your Club** it shows as "Latest moment". When the latest match had no goals for the club, the moment is null and the module shows only the last result.

New visitors pick from four club cards. Each card gives one short reason (`apps/web/app/lib/spotlight.ts`, `clubReasons`), drawn from three angles:

- honours: defending champions, title count, or still chasing a first title;
- players: the spotlight player, the all-time top scorer, or the club's leading scorer;
- form: top of the table, a winning or unbeaten run, or table position.

Each angle is used once before any repeats, so the four cards read differently. Manager opinions never appear in these lines. They stay attributed on the Dugout and Matchday views.

## Player pages

`/players/<id>/<name-slug>` reads `GET /api/v1/players/:id` (`player-profile/1`). The id alone is the address: the name part is only for people, and a refresh or a renamed slug still opens the same player. The page shows:

- the record's distinctions: all-time rank, seasons as top scorer, the player's share of the club's goals in a completed season (for example, 5 of Harbour's 7 in Season 14), and the club's titles;
- the latest scoring moment, with its clip;
- the club's next fixture and what's at stake (record lines from the fixture story);
- the follow button, the career table and the ratings.

Pages that link to it:

- the spotlight;
- the replay clip's end card and the player picker;
- the match centre lineups;
- the current and all-time scorer tables;
- the team squad;
- search, where an exact name ranks first.
