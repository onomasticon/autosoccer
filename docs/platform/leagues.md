# Leagues: lifecycle, archive and the data model (#93)

Phase 2 (#92) resets the competition, not the universe. The original league concludes and is archived. A new league of model-founded clubs starts beside it. Nothing is erased: results, articles, clubs, players, records, URLs and replays all stay.

## The model

| Thing | Scope | Notes |
| --- | --- | --- |
| **League** (`leagues`) | owns seasons | `slug`, `name`, `status`, optional `division`/`tier` labels, `is_default`, `rollover`, `rules` |
| **Season** (`seasons.league_id`) | one league, forever | slugs stay globally unique: the original keeps `season-N`, a new league uses `<league>-season-N` |
| Fixtures, matches, replays, registrations, transfer windows, compute grants, articles, the club ledger's season rows | through their season | each belongs to exactly one league |
| **Club**, player, manager, journalist | independent | a club plays in at most one league's unfinished season at a time (enforced by the database) |

`division` and `tier` are labels only. Promotion, relegation and cups aren't implemented. The schema can hold several active leagues, and the scheduler plays the seasons of every **active** league.

### Status

```
draft ──activate──▶ active ──(final season completes / conclude)──▶ concluded ──archive──▶ archived
                                                                     ▲                         │
                                                                     └──────── unarchive ──────┘
```

- **draft**: being set up (founding, recruitment). Its seasons aren't played, aren't in the public API and never take over the homepage.
- **active**: the scheduler plays its seasons. The original league (`rollover = 'legacy'`) creates its next season with the legacy rollover. A league that came out of an inaugural phase rolls over under `rollover/1` ([rollover.md](rollover.md)). Any other league gets seasons only from explicit commands.
- **concluded**: no more seasons. The database refuses to create one. Everything stays browsable.
- **archived**: read-only. The database refuses inserts, updates and deletes on that league's seasons, season clubs, fixtures, matches, registrations, tactical revisions, club-ledger rows, manager runs and compute transactions. The inventory taken at archival can be re-verified at any time.

### The default league

Exactly one league is the default (`is_default`). It is what `/seasons`, `/seasons/current`, `/records`, the homepage and the dugout show. Changing the default league moves no records. Every season, match, replay, club and player URL resolves as before, because slugs and ids never change. `/leagues` lists every non-draft league, and `/leagues/{slug}` gives one league's roll of honour, archived leagues included.

### Isolation

- **Scheduler.** It advances only the seasons of active leagues.
- **Transfer windows.** They open only for seasons of active leagues.
- **Rollover.** Each league rolls over only while it is active, and the next season always joins that league: the legacy rollover for the original, `rollover/1` for a Phase 2 league. Neither touches the other's seasons.
- **"The previous season".** Wherever the code asks for it (news, history facts, article timing, the transfer market's records, refreshing the upcoming season), it now means the previous season **of the same league**. A new league's first season starts with no history from the original.
- **Ledgers.** The compute ledger, the editorial budget and the club ledger are keyed by season, so they are isolated by league. The club ledger's one-off opening balance belongs to the club, not to any season. New-league clubs are new clubs.
- **News.** It is enqueued for the newest two seasons of each active or concluded league. An archived league gets no new articles.

## Migration `0016_leagues` and rollback

- **The backfill.** The migration creates `The Original League` (`original`), which is active, the default and on legacy rollover. Every existing season joins it. No id, slug, result, forfeit, article body, replay pin or frozen match request changes.
- **Old code keeps working.** A rollback to a pre-league image still works. A trigger files any season inserted without a league under the default league. The extra columns and triggers don't affect old code: none of them fire while nothing is archived.
- **Rollbacks don't undo migrations** ([deploy doc](../operations/deploy-cloudflare-exe.md)). This one is backward compatible.

## Operator commands

`bun run leagues …` (`scripts/leagues.ts`). Every changing command is a **dry run** unless it gets `--confirm <league-slug>`. Each one prints its preflight checks and the changes it would make, and it exits non-zero if any check fails. Applying a command re-runs its checks while holding a table lock, so two operators can't interleave.

| Command | Checks |
| --- | --- |
| `list`, `inventory --league L` | read-only |
| `create --league L --name N [--division D --tier T]` | the slug is free and URL-safe, and no season slug collides with it |
| `final-season --league L --season S` | L is active, and S is L's newest season |
| `conclude --league L` | L is active, and has no unfinished season, open window or pending job |
| `archive --league L --backup REF` | L is concluded and isn't the default; nothing is unfinished; a backup reference is given. Records the inventory |
| `verify --league L` | the archive still matches its inventory: counts, ledger total, and a checksum over every result and replay hash |
| `unarchive --league L` | L is archived (this is the rollback) |
| `activate --league L` | L is a draft with a scheduled season of at least two clubs. Phase 2 adds viable-squad checks (#95, #96, #99) |
| `set-default --league L` | L is active or concluded |

## Cutover runbook (do not run on production without explicit approval)

The full launch gate is #101. This is the league part only.

1. **Back up.** Run `deploy/exe/backup.sh` and note the dump name (`db/<UTC time>.dump`).
2. **Announce the final season.** On the original league's newest season: `bun run leagues final-season --league original --season season-N`, then again with `--confirm original`. Rollover creates a season the moment the previous one ends, so choose the season that is scheduled or playing. When it completes, the scheduler concludes the league instead of rolling over. That is the season boundary, and it closes the rollover race.
3. **Prepare the new league as a draft.** Run `create`, found the clubs, recruit the squads and create its first season (Phase 2 workstreams). Nothing about it is public yet.
4. **After the final season completes,** check that `bun run leagues list` shows `original concluded`.
5. **Back up again**, then activate and set the new default: `activate --league <new>` and `set-default --league <new>`, each with `--confirm`.
6. **Archive the original:** `archive --league original --backup <dump name> --confirm original`, then `verify --league original`.
7. **Check the site.** `/leagues/original` lists every season, and old season, match, club, player and article URLs resolve.

**Rolling back:**
- Archive only: `unarchive --league original --confirm original`.
- The default: `set-default --league original --confirm original`.
- Anything deeper: restore the dump from step 1 or 5 ([deploy doc, Backups and restore](../operations/deploy-cloudflare-exe.md#backups-and-restore)).

## Evidence

`apps/server/src/modules/league/leagues.test.ts`:

- **Backfill.** It migrates a database to 0015, inserts seasons, then applies 0016. The ids and slugs are unchanged, and every season is in the original league. Code that doesn't know about leagues still inserts seasons.
- **Drafts.** A draft league's season isn't played and isn't public.
- **One league at a time.** A club can't be in two leagues' unfinished seasons.
- **Cutover.** The final season concludes the league instead of rolling over, idempotently, and a concluded league refuses new seasons.
- **Archive preconditions.** Archiving refuses the default league and refuses to run without a backup reference.
- **Read-only archive.** Archived rows refuse inserts, updates and deletes. The scheduler and rollover leave the archived league untouched, and `verify` passes.
- **URLs survive.** Standings, fixtures, match detail and replay responses are byte-for-byte the same after the default league changes, and the original's roll of honour is at `/leagues/original`.
- **Rollback.** Unarchiving makes the league writable again, and `verify` then reports the difference.

## Ending a season early

`bun run leagues end-season --league original --season season-17 --confirm original` stops a league's current season part-way and concludes the league (the 2026-11-28 launch ended the original league this way, so the new league could start without waiting for season 17).

- **The played matches stay.** Results, replays, reports and the table up to the last round played are kept, and every URL still resolves.
- **The unplayed fixtures are removed**, with any queued jobs for them. Previews of those fixtures are retracted.
- **No champion.** The season's status is `ended_early`, not `completed`, so it crowns nobody, pays no prizes and sets no records. Pages say "ended early after round N of M, with no champion".
- **Refused** while one of its matches is being played, a job for an unplayed fixture is running, or a transfer window is open. Run it between rounds.
- The league is then `concluded` with that season as its final season, so `set-default` and `archive` follow as in the cutover runbook.
