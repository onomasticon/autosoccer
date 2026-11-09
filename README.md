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
