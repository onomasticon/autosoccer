# Auto Soccer

The league platform and public sports/editorial site for a fictional, AI-managed 5v5 soccer league.
Matches are played by the separate deterministic simulator,
[autosoccer-sim](https://github.com/onomasticon/autosoccer-sim), through a pinned adapter.

- Product plan: [docs/platform/mvp-plan.md](docs/platform/mvp-plan.md)
- Design system (Pop Arcade v0.2): [docs/design/design-system.md](docs/design/design-system.md)
- Agent/contributor rules: [AGENTS.md](AGENTS.md)

## Quick start

Requires **Bun 1.2.19**, **Node ≥ 20** and **Docker** (for Postgres).

```sh
git clone --recurse-submodules https://github.com/onomasticon/autosoccer.git   # or: git submodule update --init
bun install
bun run dev        # creates .env, starts Postgres, migrates, runs API (:4000), worker + web (:3000) in watch mode
```

Open http://localhost:3000. `bun run start` does the same with a production web build.
Already have Postgres? Set `DATABASE_URL` in `.env` and run `bun run dev -- --no-db`.

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` / `bun run start` | Full local stack (watch / production build) |
| `bun run db:up` / `db:down` | Start / stop the dev Postgres container (host port 54329) |
| `bun run db:migrate` | Apply pending SQL migrations (`packages/db/migrations`) |
| `bun run lint` / `format` | Biome lint + format check / autofix |
| `bun run typecheck` | TypeScript (server, packages, scripts, web with route typegen) |
| `bun run test` | Vitest suites; each DB test file gets its own migrated database |
| `bun run build` | Production build of the web app |
| `bun run smoke` | Boots API + built web against the DB and checks the homepage renders |
| `bun run worker` | Background job worker (plays matches) |
| `bun run sim:check [--seed N]` | Full-length match through the pinned simulator, twice, checking determinism |
| `bun run league seed` / `run` / `table` | Seed the four clubs + Season 1 calendar; play remaining rounds (no AI); print the table |
| `bun run ui:check --base URL [--out DIR] /path …` | Chromium screenshots (desktop + mobile), axe WCAG 2.1 AA scan, keyboard and overflow checks |
| `bun run season:e2e` | Unattended season on a fresh DB with real workers (one killed mid-season) + full verification report |
| `bun run ops status` / `requeue` / `tick` | Operator view: progress, queue, failures, heartbeats, spend; retry failed jobs; manual scheduler tick |
| `bun run contracts:gen` | Regenerate `docs/api` (OpenAPI + examples) from the zod contracts |

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | React Router (framework mode, SSR) + Tailwind + DaisyUI public site |
| `apps/server` | Bun + Hono API (modular monolith) and the durable job worker (`src/worker.ts`) |
| `packages/contracts` | Zod contracts: domain, MatchRequest/MatchResult, EditorialFacts, jobs, v1 API ([docs/api](docs/api)) |
| `packages/db` | Postgres client, migration runner, test-database helpers, SQL migrations |
| `packages/sim-adapter` | Pinned simulator adapter: MatchRequest → sandboxed match → MatchResult + verified replay |
| `vendor/autosoccer-sim` | Git submodule pinned to the simulator commit in `packages/sim-adapter/src/version.ts` |
| `scripts/` | Dev supervisor, smoke test |

Configuration lives in environment variables; see [.env.example](.env.example).

## Simulator integration

The simulator is consumed, never copied: `vendor/autosoccer-sim` is a submodule whose packages
are Bun workspaces, and `@autosoccer/sim-adapter` is the only code that imports them. Each match
runs two sandboxed controllers rendered from the team's tactical deployment. Every tick is
checked against the simulator's invariants, and the replay is re-simulated and hash-verified
before the result is stored. Upgrading the simulator means bumping the submodule and `SIM_COMMIT`
together (a test enforces this). Seasons pin the sim version, so existing fixtures keep their
version.

Matches are played by durable `match.play` jobs:
- One job per fixture, keyed by idempotency key.
- Claimed with `FOR UPDATE SKIP LOCKED`.
- Retried with exponential backoff, and reclaimed if a worker dies.
- The request is frozen on the first attempt, and completion is guarded by a row lock plus a
  unique `matches.fixture_id`, so a fixture's result is recorded exactly once.

## League and season lifecycle

- **Clubs:** four fictional clubs with seven-player squads: five starters (GK, DF, DF, MF, FW)
  and two reserves (`apps/server/src/modules/league/seed-data.ts`).
- **Calendar:** a double round robin (4 teams → 6 rounds, 12 fixtures).
  - The season seed fixes the team order, so it alone decides the calendar.
  - Each team plays once per round, with three home games, and never three home or away games in a row.
  - Fixture seeds are derived from the season seed, so a season is reproducible from its seed.
- **Round scheduler:** `advanceSeason` is idempotent and safe to call on a timer. It activates the
  season, releases the earliest unfinished round to the match queue (optionally waiting for its
  scheduled time and for pre-round hooks), reports a round as `blocked` if a match job failed
  permanently, and completes the season after the last result.
- **Standings:** 3/1/0 points, ranked by points → goal difference → goals for → head-to-head
  (points, GD, GF among the tied teams) → name.

## Frontend

Pop Arcade v0.2 lives in `apps/web/app/app.css` as the DaisyUI `autosoccer-pop` theme plus Tailwind
tokens (`bg-canvas`, `text-ink`, `text-violet`, `font-display`…). Components never hard-code
colours. Shared components are in `apps/web/app/components`, and `/styleguide` renders each one
and its loading, empty and error states on mock data.

One addition to the spec: `muted-text` (#66647A). Spec `muted` (#77758C) is only 3.9:1 on canvas,
so `muted-text` is used for secondary text to meet WCAG AA. Coral and yellow always carry ink
text, never white.

## AI managers

Each club has a persistent AI manager (`apps/server/src/modules/agents`) with a stable persona,
philosophy and memory.
- **Before each round**, the scheduler's `beforeRound` hook enqueues one `manager.pre_match` job
  per team. The manager gets grounded facts only (its memory, the table, both teams' official
  recent results and stats, its squad and current setup) and returns a `tactics/1` config, five
  starters by shirt number and a rationale (structured output). That's validated into a new
  tactical revision, with one repair attempt if it's invalid. The round is released once every
  decision has finished.
- **After each match**, a `manager.post_match` job feeds the official result back. The manager
  rewrites its memory (summary, up to six notes, one lesson).
- **No model runs during a simulation.** Decisions happen in separate jobs before the round and
  reviews after the result.
- **Audit trail:** every run stores its prompt, output, provider, model, tokens and cost
  (`GET /api/v1/teams/{team}/agent-runs`), and every revision stores its rationale.
- **Fallback:** if a proposal is rejected, a run fails, or the compute gate refuses, the team
  plays its last valid tactics.

Provider: `LLM_PROVIDER=anthropic` (default when `ANTHROPIC_API_KEY` is set) calls
`MANAGER_MODEL` (default `claude-opus-5-5`) via the official SDK with structured outputs.
`LLM_PROVIDER=offline` uses a deterministic rule-based stand-in for tests, CI and keyless demos;
its runs are recorded as provider `offline`, with token usage estimated and priced at the
configured model.

## Compute budget

Each team's AI manager has a fixed USD-equivalent budget per season (`--budget` on
`league seed`, default $1.00). It's kept as an append-only ledger of integer micro-USD
(`compute_transactions`):
- **grant**: created lazily, once per team per season.
- **reserve**: the worst case of each model call (`max_tokens` is capped to match), taken
  before the call. One attempt can hold several reservations (call + repair).
- **release / charge**: the hold is returned and the actual cost (tokens × price) charged, at
  most once per attempt. A retried attempt first releases holds left by a crashed one.

Reservations run under a per-team advisory lock, so concurrent runs can't overspend. When a
team can't cover a worst-case call, its manager runs are `skipped_budget` (no model call) and
the team plays its last valid tactics. A new season gets a fresh grant.
`GET /api/v1/seasons/{season}/budget` and `bun run league budget` show granted, spent,
reserved and remaining per team; team pages show a budget meter.

## AI newsroom

Three persistent AI journalists (reporter, analyst, pundit; `modules/editorial`) write
asynchronously after results, never at page render:
- **A match report for every result.**
- **A round piece once a round is complete**: analysis after odd rounds, an opinion column
  after even rounds.

They write only from the **EditorialFacts projection**: the official score, goals with
platform scorer names and simulator clock, key stats, deployed tactics, lineups and the table.
Each fact has a stable citable id (`match:<id>:score`, `match:<id>:goal:2`,
`standing:<season>:r3:<team>`…). The manager's free-text rationale is deliberately not a fact.

Every draft goes through the fact checker (`grounding.ts`):
- citations must exist, and match reports must cite the official score
- no quotation marks (nobody is interviewed)
- every scoreline must be an official final or running score (formations like `2-1-1` are recognised)
- no invented football minutes

A failing draft gets one repair attempt; if it still fails, it's stored as `rejected` and
never served. Published articles carry an AI disclosure and a Sources list linking each claim
to its official record. Routes: `/news`, `/news/:slug`, `/journalists`, `/journalists/:slug`;
API `/api/v1/articles`, `/api/v1/journalists`. `EDITORIAL_MODEL` defaults to `claude-opus-5-5`
(the offline provider writes from templates). Editorial spend is recorded per run in
`agent_runs`; the team budgets apply to managers only.

## Running a season unattended

Workers run the round scheduler (leader-elected). Seed a season and the platform does the rest:
pre-match decisions at each kickoff, matches, reviews, articles and completion.
Deployment (`Dockerfile`, `docker-compose.prod.yml`), monitoring and failure handling are in
[docs/operations/runbook.md](docs/operations/runbook.md). The latest end-to-end verification is
in [docs/operations/e2e-report.md](docs/operations/e2e-report.md).
