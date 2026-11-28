# Backup, restore and cutover rehearsal (#101, gates 4 and 5)

**Run on 2026-11-28 against today's nightly production dump. No production data was changed.** The only writes on the VM were the image cleanup and the deploys, which aren't part of this rehearsal.

## The procedure

1. **Nightly backups.** `backup.log` shows a successful dump every night at 03:15 UTC. The one for 2026-11-28 is 3.3 MB, at `autosoccer-backups/db/20261128T031501Z.dump`.
2. **Fetch.** The dump was streamed from R2 to the operator's machine with the documented aws-cli image (`s3 cp … -`), so nothing was written on the VM. It is a valid `PGDMP` archive of 3.4 MB.
3. **Restore.** `pg_restore --no-owner --exit-on-error` into a fresh database, `autosoccer_restore`. It took about a second, with no errors.
4. **Migrate.** The dump was at `0019`. `0020`–`0022` applied cleanly on top, as `deploy.sh` would apply them after a restore.
5. **Faithfulness.** `scripts/url-sweep.ts` lists every historical API URL from the database: seasons, standings, fixtures, scorers, budgets, dugouts, matches, match stories, clubs, players, published articles, records, transfer windows and leagues. It fetches each one and hashes the body. The same URLs were swept on the restored copy and on live production, through an SSH tunnel to the API container (read-only).
6. **The cutover, rehearsed on the copy** (`scripts/cutover-rehearsal.ts`):
   - season 17 is announced as the original league's final season and played out by the real scheduler, with the legacy rollover on and offline managers;
   - the copy is dumped;
   - the new league is created, founded and recruited with the offline stand-ins, then activated and made the default;
   - the original league is archived against the copy's dump and verified;
   - 20 more scheduler ticks run, 12 hours apart, while the new league plays;
   - the URL sweep runs again.

## Results

**Restore vs production** (1,003 URLs, all 200):

| URLs | Identical |
| --- | --- |
| Articles (432), matches (192), match stories (192) | all |
| Season pages: standings, fixtures, scorers, budget, dugout (80) | all |
| Transfer windows (16), records | all |
| Players (64), clubs (20), league overview, season list, all-time scorers | changed: production played on after the 03:15 dump |

All 192 completed matches have their replay artifacts. The three article URLs that return 404 belong to articles the editorial checks rejected, which are never public; the sweep now lists only published articles.

**Cutover rehearsal:**

| Check | Result |
| --- | --- |
| The final season plays out, and the league concludes instead of rolling over | ✓ 17 seasons, none open, no season 18 |
| Archive refused while the original is the default | ✓ the guard holds (runbook order: set the new default first) |
| The new league is founded, recruited, activated and made the default | ✓ |
| Archive inventory | 17 seasons, 10 clubs, 282 fixtures, all 282 completed, 282 matches, 282 replays (all verified), 441 published articles, 1,184 registrations, a results checksum |
| `leagues verify --league original`, after archiving and again after 20 more ticks | ✓ unchanged since archival, both times |
| Scheduler isolation | ✓ 0 new jobs for the archived league, while the new league played 70 fixtures |
| History after the cutover (1,003 pre-existing URLs) | ✓ all 200, none removed. Every page from seasons 1–16 is byte-identical: 432 articles, 192 matches and stories, 80 season pages, 16 transfer windows |

**What did change after the cutover (90 URLs), all as designed:**
- player, club, records and all-time scorer pages, which now include season 17;
- the league listings, which now show the original as archived;
- `/seasons`, which follows the new default league (see [leagues.md](../platform/leagues.md#the-default-league)).

## Not covered

- **Replay bodies.** They live in R2, not in the database dump. Replay records and checksums were verified, but replay files weren't re-downloaded.
- **Restoring over the live database.** The documented in-place restore (`pg_restore --clean` into the running stack) wasn't run against production. The restore itself was exercised on a separate database.
- **Disk headroom.** This rehearsal found the VM's disk full, and #126 fixed that. Restoring needs room for the dump plus Postgres's own growth, which is under 1 GB at today's size.

## Rerunning it

```sh
# 1. Stream the nightly dump from R2 (read-only on the VM)
ssh autosoccer.exe.xyz 'cd ~/autosoccer && set -a && . ./.env && set +a && docker run --rm -e AWS_DEFAULT_REGION=auto \
  -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" amazon/aws-cli:2.22.35 \
  s3 cp "s3://$R2_BACKUP_BUCKET/db/<time>.dump" - --endpoint-url "$R2_ENDPOINT" --only-show-errors' > nightly.dump
# 2. Restore into a local copy and migrate
docker exec autosoccer-db-1 psql -U autosoccer -c 'create database autosoccer_restore'
docker exec -i autosoccer-db-1 pg_restore -U autosoccer -d autosoccer_restore --no-owner --exit-on-error < nightly.dump
# 3. Run an API on the copy, sweep, rehearse the cutover, sweep again
DATABASE_URL=…/autosoccer_restore API_PORT=4300 LLM_PROVIDER=offline bun apps/server/src/api.ts &
DATABASE_URL=…/autosoccer_restore bun scripts/url-sweep.ts http://localhost:4300 before.json
DATABASE_URL=…/autosoccer_restore bun scripts/cutover-rehearsal.ts <dump ref>
DATABASE_URL=…/autosoccer_restore bun scripts/url-sweep.ts http://localhost:4300 after.json --compare before.json
```
