# Phase 2 season rollover (`rollover/1`, #101)

When a new league's season completes, the scheduler creates the next one, so a Phase 2 league runs on without an operator. The original league keeps its own rollover (`league/rollover.ts`). This one (`founding/rollover.ts`) only touches **active** leagues that came out of an inaugural phase.

## Between seasons, in order

1. **The final season.** If the season that ended was announced as the league's final one, the league concludes and nothing rolls over.
2. **Ageing (ageing/1).** Club players are a year older. Those who retire leave, and an academy graduate of the same position takes each one's place. A retiree's contract ends.
3. **The next season.** finance/3, transfer/2 and insolvency/2, from calendar/1's timetable. The same clubs, the same compute and editorial budgets, and a seed derived from the last season's. The preseason window opens at once.
4. **Development.** Ratings develop from last season's record and each player's age. This covers club players **and the league's free agents**, who now develop with age too: pool players get a hidden development rate the first time they need one.
5. **Graduates sign.** Each graduate signs an academy contract (`via = 'academy'`) at the market wage for his rating, for a term set by his age.
6. **Opening setups.** Every club gets an opening setup for the new season. The manager sets its own before round 1.

The preseason window then runs as in any season: renewals of every contract that ended (the manager's call, or the safe default of keeping the player), then free agency.

**Carried over unchanged:** cash (there is never a second opening balance), debt, administration, honours, each club's manager and the model it runs on. The lender's season end (interest, the administration sweep) has already run when the season completed.

## Idempotent and on record

The rollover is a league phase: `league_phases` with kind `rollover` and round = the new season's number.
- Each step is idempotent.
- An interrupted rollover finishes on the next scheduler tick.
- The settled phase keeps a summary: `{ rule, from, retired, graduates, developed }`.

## Evidence

`founding/rollover.test.ts` runs a four-club league through the real scheduler and job worker with offline managers. It goes from founding, through season 1 and the rollover, to the end of season 2, which was announced as the final season.
- **Season 2:** the same clubs and Phase 2 rules, with the rollover phase settled. A second call does nothing.
- **Retirement:** a 36-year-old retires and his contract ends. An academy graduate signs for his club from season 2, at a nonzero wage.
- **Development:** every club player and free agent has a season 2 rating, developed rather than reset to baseline.
- **Windows:** the preseason window settles renewals, then free agency, and the midseason window follows. No contract that ended with season 1 is still active.
- **Carry-over:** still only one opening balance per club, and every club keeps its model.
- **Season 2** is played in full, and the league concludes instead of rolling over again.

## Not yet

- **Free agents don't retire.** Only club players do.
- **Fresh supply.** The pool gets no new players between seasons. Replacement comes from academy graduates alone, which is the harness's chosen ruleset (`replacement: "academy"`).
