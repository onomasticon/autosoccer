# The Phase 2 calendar (#99, `calendar/1`)

`apps/server/src/modules/league/calendar.ts` builds a whole season cycle in exact UTC instants, and lists every decision opportunity a manager gets, each with a deadline. Every number below is a working default (`DEFAULT_CALENDAR`) that can be configured.

## Three clocks

| Clock | Drives | Never drives |
| --- | --- | --- |
| **Real time (UTC)** | The scheduler, windows, model deadlines and kickoffs | Ages or contracts |
| **Football year** (season N of a league) | Ages, contracts, records and rule pins | When jobs run |
| **Match time** (inside the simulator) | Events within a match | Anything outside it |

## Shape of a cycle (20 clubs)

```
founding (10 days, inaugural only) → preseason window (72h) → rounds 1–19 → midseason window (24h) → rounds 20–38
```

- **Rounds:** 38 rounds and 380 fixtures, as a double round robin with every club once a round.
- **Matchday slots:** two a day, at 08:00 and 20:00 UTC, 12 hours apart. Each round takes the next slot after the previous round's last match has ended and the next tactics lock has passed.
- **Within a round:** fixtures kick off in waves of five, 20 minutes apart. The final round kicks off all at once.
- **Tactics lock:** 30 minutes before a round's first kickoff. Every club commits before any result of that round exists, so no club gains information from a staggered kickoff.
- **Half-seasons of 19 rounds:** 19 rounds is an odd number of slots, so a half ends on the opposite slot to the one it started on. The 24-hour midseason window then pushes round 20 to the next slot after it closes. In practice the break is about 35 hours, not 24.

**The cycle's length is computed, not assumed.**

| Cycle | Opening time | Days |
| --- | --- | ---: |
| Inaugural (with founding) | 09:00 UTC | 32.97 |
| Later season | 09:00 UTC | 22.97 |
| Later season | 21:00 UTC | 22.97 |
| Later season | 07:00 UTC | 22.55 |

So a normal cycle is about **22.5–23 days**, a little under the epic's "~23–24 days" estimate. Lengthen the preseason window or add a rest slot to reach 24.

## Opportunities (per club per cycle)

| Kind | Count | Opens → deadline |
| --- | ---: | --- |
| `founding` | 1 (inaugural only) | The founding phase |
| `season-strategy` | 1 | The first 24 hours of the preseason window |
| `window` | 6 | Listing, bidding and replying, in each of the preseason and midseason windows |
| `pre-match` | 38 | After the previous round ends → the round's tactics lock |
| `post-match` | 38 | After the round ends → the next round's tactics lock |
| `management` | about 20 | Daily open-ended club management at 14:00 UTC, for 4 hours |

That is about **106 opportunities per club per cycle**.

- **Bounded.** Each opportunity is one call, plus at most one repair. A manager may always decline (no-op), and nothing forces an action.
- **Unanswered.** A missed deadline keeps the last valid decision, exactly as an unavailable model does today. No season stalls waiting for a model.
- **Cost.** At about 106 calls per 23 days (4.6 per day), the cost projection's default of 5 calls per club per day is conservative ([models.md](models.md)).

## Wired into the scheduler (`contracts/scheduler.ts`)

- **Creating a season.** `createPhase2Season` builds a Phase 2 season (finance/3, transfer/2) from calendar/1's exact timetable, including staggered kickoffs and the simultaneous final round. Both market windows are created up front: preseason before round 1, and midseason before the second half.
- **Each scheduler tick.** For each open window whose time has come, one decision job is queued per club for the current step: renewals, then free agency. A step settles when every club has answered, or at its deadline. A model that never answers gets the safe default, and nothing stalls.
- **Rounds wait for windows.** A round never kicks off while the window that feeds it is open.
- **Midseason.** The midseason window opens only once the first half is complete.
- **Late steps keep their full time.** A step that starts late (a delayed season, or a midseason window waiting on the first half) has its deadlines moved to start when it actually begins. Every manager gets its full time, and a late window never settles on defaults alone.

**Evidence.** `contracts/phase2-season.test.ts` plays a compressed full season of four clubs through the real scheduler and job worker, with offline managers:
- the preseason window queues decisions, settles renewals, then free agency;
- rounds 1–3 are played;
- the midseason window opens after round 3, and round 4 waits until it closes;
- the second half is played and the season completes.

Twelve manager decisions were made (3 steps × 4 clubs), no transfer/1 window was opened, and every fixture was played.

## Still to come

- **Founding:** founding and the inaugural recruitment market as the season's first phase (calendar/1's 10-day founding window).
- **Pause and resume midseason** for Phase 2 seasons, beyond what `bun run ops reschedule` already covers.

## Evidence

`calendar.test.ts`:

- 38 rounds and 380 fixtures, each club once a round, every pairing home and away;
- the window order and lengths;
- the 08:00 and 20:00 UTC slots, 12 hours apart, unaffected by a European DST date;
- tactics locked before every first kickoff, two waves in a normal round, and a simultaneous final round;
- the cycle length computed for several opening hours;
- slot rollover across a day or month boundary;
- the opportunity counts, with every deadline after its opening and no pre-match opportunity before the previous round ends.
