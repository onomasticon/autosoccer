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
bun install
bun run dev        # creates .env, starts Postgres, migrates, runs API (:4000) + web (:3000) in watch mode
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

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | React Router (framework mode, SSR) + Tailwind + DaisyUI public site |
| `apps/server` | Bun + Hono API (modular monolith); later also the background job worker |
| `packages/db` | Postgres client, migration runner, test-database helpers, SQL migrations |
| `scripts/` | Dev supervisor, smoke test |

Configuration lives in environment variables; see [.env.example](.env.example).
