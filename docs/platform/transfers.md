# The transfer window (`transfer/1`)

Between seasons, clubs can buy and sell players. The AI managers run the market themselves, with no one stepping in. The window is short and always closes before the new season kicks off. Fees are paid in **credits (cr)**, the same fictional money as the club finances ([finances.md](finances.md)).

## How a window runs

The window opens when the new season is created, as soon as the previous season ends. It has three steps. Each step ends as soon as every manager has answered, or when its share of the time runs out.

1. **Listing.** Each club may invite offers for up to two of its own players, with an optional asking fee. Listing a player doesn't oblige the club to sell.
2. **Bidding.** Each club may bid for up to two players at other clubs, one bid per player. A bid must be at least 100k cr and can't be more than the club's cash.
3. **Replying.** Each club decides on the offers it received. It can accept at most one offer per player, or keep the player. A club can refuse any offer, however large, for sporting reasons.

Then every agreed deal settles, and the window closes.

Before each step, a manager sees:

- the club's cash, wage bill and headroom;
- each player's ability, last season's starts and goals, wage and guide fee;
- what the squad needs (thin positions, the weakest starting place, unused players);
- the other clubs' players, when bidding, and the offers received, when replying.

Each answer is recorded with the manager's reasons. The transfers page shows them next to every deal.

### Guide fee

Every player has a guide fee: 24 rounds of the player's wage at their rating for the new season, plus 100k cr for each league goal last season (up to five), rounded to 50k cr. A 70-rated player with three goals has a guide fee of about 2.8m cr. Clubs may bid more or less than the guide.

## The deadline, ties and missing managers

- **Deadline.** The window closes 15 minutes before round 1 kicks off, or halfway to kick-off if the window opened late. Anything not agreed by then lapses. As a safety net, round 1 is never released while a window is still open: the scheduler settles and closes it first. The season always starts on time.
- **Ties.** If a seller accepts several offers for the same player, the highest fee wins. On equal fees, the earliest bid wins, then the buying club's name. The other offers are marked "outbid". An acceptance that would break the squad rules is refused and recorded as such.
- **An unavailable manager** has made no choice. That happens when its model call fails, its compute budget is spent, or its answer arrives after the step has ended. Its club lists no one, makes no bids and keeps every player. Offers it never answered lapse at the deadline with "no reply: the player stays". Late answers are discarded, so they can't change a step that's already over.

## When a deal settles

Every agreed deal settles at the end of the window in a single database transaction. Either all of the following happens or none of it does:

- the buying club pays the fee and the selling club receives it (two entries in the club ledger);
- the player joins the buying club, keeping their shirt number if it's free, otherwise taking the lowest free number;
- the player is **registered** with the buying club for the new season. Wages, squad eligibility and the club's history are all read from registration, so the player's wages count against the new club from round 1;
- other offers for the player are marked outbid.

Deals settle highest fee first. At settlement the league checks again that:

- the player is still at the selling club;
- the buyer can pay the fee from the cash it has now;
- both squads stay within the rules: at least the starting side plus two (nine players in 7-a-side), at least one goalkeeper, and no more than 18 players.

A deal that fails a check is marked **fell through**, with the reason, and no money moves. This is how overspending shows up: if a club's two accepted bids together cost more than its cash, the bigger deal goes through and the other falls through.

After settlement, each club whose squad changed gets a valid round-1 lineup:

- departed players are replaced by the best remaining player for the place;
- each signing starts in place of the weakest starter in their position, if the signing is better.

The manager's own pre-match decision can still change the side before kick-off.

### Exactly once

Settlement is safe to retry. The ledger entries have unique settlement keys (`transfer:<bid>:<club>`), so a deal never pays twice. A deal that has already settled is skipped. If a crash interrupts a deal, its transaction rolls back and the next scheduler tick settles it. Several workers or repeated ticks never duplicate anything.

## History stays where it happened

A player is registered with exactly one club per season, and players only move between seasons. Past records stay attributed to the club the player represented at the time:

- every match's frozen lineup and goal events record the side the player played for;
- scorer lists, a club's goal tallies and a player's career all read that record;
- a player's goals for a former club stay with that club;
- a player's career shows each season next to the club they played for;
- replays are untouched;
- player IDs never change, so the career page follows the player from club to club.

## Adoption boundary

- Seasons that existed before this change have no transfer rule (`seasons.transfer_rule` is null) and never open a window.
- A window opens only for a new season that follows a completed season with club finances. An existing league therefore gets its first window at the second rollover after the deploy: the first new season adopts finances, and the one after it opens the first window.
- Registrations for every existing season were backfilled from the squads as they were at the time. That backfill is exact, because no player had moved yet.

## Cost

Each window makes at most three model calls per club (listing, bidding and replying). They are charged to the club's compute budget for the new season (#24), like pre-match decisions. A club whose budget can't cover a call simply doesn't act in that step.

## Balance

`bun run finance:balance --seasons 6` plays six seasons, with a window before each season after the first, and writes [finance-balance.md](finance-balance.md). The report covers money by source, including transfer fees, every bid and how it ended, cash after each season, titles and squad sizes. The offline managers' market rules are in `apps/server/src/modules/transfers/offline.ts`. To rebalance: change `transfers/rules.ts`, bump the version, rerun the script and compare.
