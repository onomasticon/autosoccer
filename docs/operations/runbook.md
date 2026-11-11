# Operations runbook

## Topology
| Process | Command | Scale | Notes |
| --- | --- | --- | --- |
| Postgres 16 | — | 1 | All state: league, jobs, ledger, articles. Back it up. |
| `migrate` | `bun packages/db/src/migrate-cli.ts` | one-shot | Advisory-locked and checksummed; safe to run on every deploy. |
| `api` | `bun apps/server/src/api.ts` | ≥1 | Stateless. `/health` for probes, `/api/v1/ops/status` for operators. |
| `worker` | `bun apps/server/src/worker.ts` | ≥2 | Runs jobs (matches, managers, articles) **and** the scheduler. One scheduler leader per tick (advisory lock). |
| `web` | `node …/react-router-serve ./build/server/index.js` | ≥1 | SSR on Node. Reads the API only and never calls an LLM. |

Replays are written by workers and served by the API. With `REPLAY_STORE=file` they live in `REPLAY_DIR`
(a shared volume in `docker-compose.prod.yml`), so both must mount it. With `REPLAY_STORE=r2` they live in
Cloudflare R2 (or any S3-compatible store) and no shared disk is needed.

## Deploy
For production on an exe.dev VM behind Cloudflare (Tunnel, R2 replays and backups), see
[deploy-cloudflare-exe.md](deploy-cloudflare-exe.md). The self-contained stack below
(Postgres in a container, replays on a volume) is for single-host trials:
```sh
git submodule update --init                 # pinned autosoccer-sim
cp .env.example .env                        # set POSTGRES_PASSWORD, OPS_TOKEN, ANTHROPIC_API_KEY (or LLM_PROVIDER=offline)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api bun scripts/league.ts seed --budget 1.00 --editorial-budget 3.00 --interval 60
```
`--interval` is the number of minutes between rounds (the **demo** cadence). Round 1 kicks off at seed time and later
rounds follow on that schedule.

For a reader-friendly season, use a calendar cadence instead (all times UTC, shown with "UTC" on the site):

| `--cadence` | Rounds |
| --- | --- |
| `demo` (default) | every `--interval` minutes from `--start` (default: now) |
| `weekly` | Saturdays 15:00 UTC |
| `twice-weekly` | Wednesdays and Saturdays 19:00 UTC |

To move a running season onto a cadence without touching anything already played:

```sh
bun run ops reschedule --cadence weekly --dry-run   # preview
bun run ops reschedule --cadence weekly             # apply
```

Only rounds where no fixture is playing, completed or failed are moved. Started rounds keep their recorded kickoff times, and no open round is placed before the last started round. It is idempotent.

Key settings (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `anthropic` if `ANTHROPIC_API_KEY` set, else `offline` | Managers and journalists. `offline` is the labelled deterministic stand-in. |
| `MANAGER_MODEL`, `EDITORIAL_MODEL` | `claude-opus-5-5` | Priced in `modules/agents/pricing.ts`. |
| `SCHEDULER_ENABLED` | `true` | Set `false` on workers that should only run jobs. |
| `SCHEDULE_RESPECT_KICKOFF` | `true` | `false` plays rounds back to back (demos). |
| `SCHEDULER_INTERVAL_MS` | `5000` | Scheduler tick. |
| `WORKER_LEASE_MS` | `300000` | A running job not finished within the lease is reclaimed by another worker. Must exceed the longest job (an LLM call with retries). |
| `OPS_TOKEN` | unset | Bearer token for `/api/v1/ops/*`. Set it in production. |

## What runs unattended
For each round, at its kickoff time, the scheduler:
1. Enqueues every manager's **pre-match decision** (budget-gated) and waits until all of them have
   finished. A failed or unaffordable decision falls back to the last valid tactics.
2. Releases the round's **match jobs**. Each fixture is played exactly once from a frozen request,
   and the replay is verified before the result is stored.
3. After each result, the match job enqueues **post-match reviews** (manager memory) and a
   **match report**. When the whole round is done, it also enqueues a **round piece**
   (analysis or column).
4. Completes the season after the last result.

## Monitoring
- `bun run ops status` (or `GET /api/v1/ops/status`, which returns 503 when unhealthy):
  - season progress and next kickoff
  - job counts by kind/status, retries in flight, permanently failed jobs with their last error
  - worker and scheduler heartbeats (alive if seen within 60 s)
  - agent runs and spend
  - the current season's budgets: per team (managers) and the editorial budget (journalists)
- Logs are JSON lines on stdout/stderr with `svc`, `worker`, `job`, `kind`, `key` and `attempt`. Alert on:
  - `"season blocked"` (error): a match failed permanently.
  - `"job attempt failed"` with `next: "failed"`: a job exhausted its retries.
  - `"pre-match skipped: budget"` (info): expected once a team's budget runs out.
  - `"editorial budget exhausted; template writer used"` (info): expected once the season's journalist budget runs out.

## Failure handling
| Symptom | Cause | Action |
| --- | --- | --- |
| Job retried, then succeeded | Transient error (LLM overload, DB blip) | None. Exponential backoff, 3 attempts. |
| Worker crashed / killed mid-job | Process death | None. The job is reclaimed after `WORKER_LEASE_MS`; the stale worker can't complete it. |
| `ops status` shows a failed `match.play`; season **blocked** | Permanent error (e.g. replay storage down, sim pin mismatch) | Fix the cause, then `bun run ops requeue --kind match.play`. The same match row and frozen request are reused, so the result is still recorded exactly once. |
| Failed `manager.*` jobs | LLM unavailable after retries | Nothing blocks: the team plays its last valid tactics. Optionally `ops requeue --kind manager.pre_match` before kickoff. |
| Article `rejected` | Draft failed the fact checker twice | Stored for audit and never published. Review via `agent_runs.error`. |
| Budget exhausted | Team spent its season allowance | Expected. The manager is skipped and keeps its last valid tactics. |
| Articles written by `provider = offline` mid-season | The season's editorial budget is spent | Expected. Reports keep publishing from templates at no cost. Seed the next season with a larger `--editorial-budget` if wanted. |
| `"fixture pinned to sim X, worker runs Y"` | Simulator upgraded mid-season | Roll the workers back to the season's sim, or finish the season before upgrading. |

## Upgrading the simulator
1. Bump the `vendor/autosoccer-sim` submodule and `SIM_COMMIT` in `packages/sim-adapter/src/version.ts`.
   The test suite enforces that they match.
2. Run `bun run test` and `bun run sim:check`.
3. Only seasons created after the upgrade use the new version, because seasons pin `sim_version`.

## Verify a release
```sh
bun run test && bun run smoke
bun run season:e2e            # fresh DB, 2 real workers (one killed mid-season), full verification → docs/operations/e2e-report.md
```
