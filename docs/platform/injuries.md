# Injuries and emergency call-ups (`injury/1`)

Players can be hurt in matches and miss the following rounds. In the rare case a club can't field a full side, or has no fit goalkeeper, it calls up temporary emergency players.

## Injuries

After each official result, every starter has a small chance of having picked up an injury:

- **The chance:** 2% a match, plus 0.4% for each year a player is over 29.
- **The length:** 1 round (55% of injuries), 2 rounds (28%), 3 rounds (12%) or 4 rounds (5%).
- **When they count:** an injured player misses the rounds after the match. The break between seasons heals everyone.

A ten-club round has about 70 starts, so expect one or two injuries a round across the league.

The rolls are seeded by the fixture and the player, so the same league always produces the same injuries. Each match is rolled once.

## Who plays instead

When a match's lineup is built, each injured starter is replaced by the best fit player not already starting. A player of the same position comes first; a goalkeeper is only ever replaced by a goalkeeper.

The managers see who is injured before they pick their side. If one names an injured player anyway, the replacement rule applies.

## Emergency call-ups

If nobody fit is left for a place, or there's no fit goalkeeper, the club calls up an emergency player:

- **Weaker than the squad:** about 10 points below a typical player.
- **Temporary:** registered with the club for that season only, and paid wages like the rest of the squad.
- **Never part of the squad.** They don't appear in the squad list or the transfer market.
- **Reused:** later matches that season use the same player while one is still needed.
- **Numbered from 90.**

With squads of 16 this almost never happens on its own: it takes a club's both goalkeepers, or about ten players, being hurt at once. `scripts/injury-demo.ts` forces such a crisis to show it.

## Where you see it

- **The squad list:** an "Injured · back after round N" badge.
- **The player page:** an injury note. Emergency players are labelled as such.
- **The match page:** who missed the match and who started instead.
- **Match reports:** reporters may mention absences, emergency call-ups and new injuries, which are now in the official record.

## For operators

- **Code.** The rules are in `apps/server/src/modules/injuries/injuries.ts`.
- **When rolls happen.** After every result, and again before each round is released (catch-up). Both are idempotent.
- **Lineup changes** are recorded once per fixture and player (`lineup_changes`), when the match request is built and frozen.
- **Adoption.** Seasons created before this change have no `injury_rule` and never roll injuries. The live league adopts injuries from its next season.
