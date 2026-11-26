# Ageing, retirement and the academy (`ageing/1`)

Players get a year older every season. Young players improve, players in their late twenties hold steady, and from 30 their physical ratings fall, faster each year, until they retire. Each retiree's place goes to an academy graduate.

## How a season of age changes a player

| Age that season | Change before the player's rate |
| --- | --- |
| 20 and under | +2 to the position's two key ratings, +1 stamina |
| 21–23 | +1 to the two key ratings |
| 24–29 | no change |
| 30–31 | −1 pace, −1 acceleration |
| 32–33 | −1 pace, acceleration, stamina and agility |
| 34 and over | −2 pace, acceleration and stamina; −1 agility and the main key rating |

This sits on top of the record-driven development: regular starters still improve, players who never start still slip ([player careers](mvp-plan.md)). Together it's the `develop/2` rule. No rating moves more than 2 points a season, and growth stops at 85.

**The hidden development rate.** Every player has a development rate between 0.6 and 1.4; graduates' rates can reach 1.6. It scales the age effect: a fast developer grows quicker when young and declines quicker when old.

The rate is never shown on the site, never served by the API and never given to the managers. Its effect shows only in the ratings over time.

## Retirement

Before each new season:

- **Under 33:** nobody retires.
- **From 33:** a player may retire. The chance is 25% at 33, 50% at 34 and 75% at 35, plus 25% for a player rated under 60.
- **At 36:** every player retires.

A retired player leaves the squad but keeps their record. Their career page still shows every season, goal and replay, marked "Retired after Season N".

## The academy

Each retiree is replaced at the same club by an academy graduate of the same position, who takes the retiree's shirt number. A graduate:

- is aged 17–19;
- starts about 7 points below a typical player's ratings;
- often has a high development rate, so they can grow quickly.

Squads therefore keep their size.

## Ages

When ageing first applies, every existing player gets a starting age between 18 and 33, worked out from who they are. Ages, rates, retirements and graduates' names and ratings are all deterministic: the same league produces the same careers.

## News

The league correspondent reports each season's retirements: who, at what age, after how many seasons and goals. The story also names the graduates replacing them ([newsroom.md](newsroom.md)).

## Balance

`bun scripts/ageing-balance.ts --seasons 14` rolls a ten-club league over 14 seasons. No matches are played, so only age moves the ratings.

| | Result |
| --- | --- |
| Average age | Steady at about 25.5 (range 17–35) |
| Players under 22 | About 40 of 160 |
| Players 30 and over | About 40 of 160 |
| Retirements | 6–14 a season |
| Average overall | 65.2 → 64.4 over 13 seasons |

Regular starters also gain from playing time, which offsets the small drift in average overall.

## For operators

- **Code.** The rules are in `apps/server/src/modules/league/ageing.ts`, and the development step in `careers.ts` (`develop/2`).
- **When it runs.** Rollover retires players and promotes graduates before the new season registers its squads.
- **Once only.** It runs once per season, under an advisory lock, and the graduates are keyed to the season.
- **Shirt numbers** are unique among a club's active players only. Old match records keep the number a player wore then.
- **Turning it off.** Pass `ageing: false` to `rolloverSeason`; the older tests do this to keep their squads fixed.
