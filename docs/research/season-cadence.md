# Season cadence for a public audience (issue #69)

How often should rounds kick off once people follow the league? Production runs the demo pace:
`SEASON_ROUND_MINUTES=240`, a round every four hours and a new season every day. This compares it
with the calendar cadences `cadence.ts` already supports. Nothing is switched automatically; the
operator plan is at the end.

## Options

| | Daily (current) | Twice-weekly | Weekly |
| --- | --- | --- | --- |
| Rounds | every 4 h, round the clock | Wed + Sat, 19:00 UTC | Sat, 15:00 UTC |
| Season (6 rounds) | 1 day, then a 4 h break | 3 weeks | 6 weeks |
| Seasons per month | ~30 | ~1.4 | ~0.7 |
| Time for previews, reactions and a return visit between rounds | 4 h (most rounds land overnight somewhere) | 3–4 days | 7 days |
| Model spend per month (see below) | ~$110 | ~$5 | ~$2.50 |
| What a visitor sees on return a day later | a whole season they missed | the next round's build-up | the next round's build-up |

## Cost per season
Taken from production's own ledger (`ops status`, seasons 1–4):
- **Managers:** $4.66 over 188 runs, about $0.025 a run. 48 runs a season (pre- and post-match for 12 matches × 2 clubs) comes to **about $1.20**.
- **Newsroom:** $5.63 over 69 runs, about $0.08 an article. With previews (#66) a season has 30 articles (12 previews, 12 reports, 6 round pieces), so **about $2.40**. That's capped by the season's editorial budget ($3.00); past the cap the free template writer takes over.
- **Total:** **about $3.60 a season**, so monthly spend is roughly seasons per month × $3.60. Simulation itself is free (it runs in the worker).

## Narrative pacing
- **The matchday loop** (#65): a preview the moment the previous round ends, manager decisions at kick-off, the recorded replay, then reactions. It needs readers to come back between rounds.
- **At the daily pace:** a follower who checks once a day misses five or six rounds and a whole title race. "Since you last checked" turns into a season summary.
- **Twice a week:** a fixed evening slot that's easy to remember. 19:00 UTC is evening in Europe and afternoon in the Americas. Each round has days for its preview and reactions to be read, and a season lasts long enough for title races and manager arcs (#67) to build.
- **Weekly:** halves the spend again, but six weeks a season is slow for a league whose matches last four minutes. It also leaves the "Matchday" page stale most of the week.

## Recommendation
- **Production:** twice-weekly, once the owner approves. Rollover then starts each new season on the next Wednesday or Saturday slot at least a day after the last one ends.
- **The demo pace stays available:** `SEASON_CADENCE=interval` with `SEASON_ROUND_MINUTES`, the default, unchanged. Use it for local runs, demos and load testing.

## Operator plan (dry run first; never touches played rounds)
1. **Preview the current season:**
   ```sh
   bun run ops reschedule --season season-N --cadence twice-weekly --dry-run
   ```
   This lists only rounds that haven't started; any round with a playing, completed or failed fixture is listed as untouched. Example from a seeded local league after round 5:
   ```
   would move 1 round(s); untouched (started): 1, 2, 3, 4, 5
     R6: 2026-11-16T14:00:00.000Z → 2026-11-18T19:00:00.000Z
   ```
   Kick-offs never move into the past or before the last started round.
2. **Choose one:**
   - **(a) Move the rest of the current season:** run the same command without `--dry-run`.
   - **(b) Leave the current season alone:** set `SEASON_CADENCE=twice-weekly` on the worker and redeploy. Only the *next* rolled-over season uses it.
3. **Roll back:**
   - unset `SEASON_CADENCE` (back to `interval`);
   - for a season already on the calendar, `bun run ops reschedule --season season-N --cadence demo --interval 240` moves its unstarted rounds back to the 4-hourly pace.
   - Played rounds, results and published articles are never changed by either direction.
4. **Spend:** model spend falls from about $110 to about $5 a month. The per-season manager and editorial budgets are unchanged, so no budget change is needed.

## Measuring engagement (pilot, no new tracking)
- **No analytics in place:** the site has no analytics, and following a club is stored only in the browser. This change adds no trackers, cookies or identifiers.
- **Pilot:** use aggregate, cookieless request counts at the edge (Cloudflare analytics on the existing tunnel, by path). Compare four weeks of the daily pace with four weeks of twice-weekly:
  - `/matchday/*` views per fixture, before and after kick-off (anticipation versus catch-up);
  - the share of `/` visits followed by a `/matchday/*` view (the Featured Matchday link and Your Club's "See the build-up");
  - views of `/news/*` previews against reports.
- **What it can't measure:** individual return visits, by design.

## Times and time zones
- **Stored and served in UTC:** every kick-off is stored in UTC and served with `timezone: "UTC"` (fixture-story/1).
- **Display:** pages render "Mon 16 Nov, 14:00 UTC" identically on the server and in the browser. The reader's local time and a countdown ("in 3 h 20 min") are added in the browser after hydration, so the edge cache and hydration agree.
