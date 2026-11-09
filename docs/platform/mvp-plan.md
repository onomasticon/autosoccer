# Auto Soccer — end-to-end MVP delivery plan

## Product goal
An unattended, reproducible 4-team, 12-fixture double round-robin season with persistent AI managers, a public sports/news site, match replays and official standings.

## Boundaries
- Main repository: public web, API, persistence, scheduling, agents, editorial, orchestration.
- `autosoccer-sim`: deterministic 5v5 match execution and replay. Integrate by pinned versioned adapter, not by copying the engine.
- Initial squads: seven per team (five starters, two reserves). In-match substitutions deferred unless sim supports them.
- Manager initially emits validated structured tactical config; preserve union contract `{kind:'tactical',config}` / `{kind:'scripted',sdkVersion,artifactId}` for later LLM-authored controllers.
- Four teams, one season, fixed USD-equivalent LLM compute allowance per team. Record tokens, cost and decisions. On exhaustion, reuse last valid tactics.

## Architecture
React Router framework mode + Tailwind/DaisyUI frontend; TypeScript/Bun modular backend; Postgres; background job worker with durable idempotent jobs. Data entities: Team, Player, ManagerAgent, Season, Fixture, Match, TacticalRevision, AgentRun, ComputeTransaction, ReplayArtifact, Article, EditorialAgent.

## Delivery sequence
**Phase 0 — contracts/foundation:** repo workspace, CI, DB migrations, API schemas, sim adapter contract, design tokens and route shell. Can parallelize design tokens and schemas after contracts are agreed.

**Phase 1 — playable league without LLM:** seeded teams/squads, double-round-robin fixture generation, deterministic runner, result persistence, replay artifacts, standings, basic pages. Use deterministic scripted/fixed tactics for integration.

**Phase 2 — managers and economics:** pre-match decision, tactical validation/deployment, post-match feedback and durable memory, token/cost ledger, budget enforcement, retries and idempotency. No LLM during sim ticks.

**Phase 3 — media site:** match facts service, AI journalists with persistent identities, fact-grounded articles generated asynchronously, attribution, article/team/match routes and public homepage.

**Phase 4 — unattended season:** schedule jobs, resumability, failure handling, observability, e2e test season, performance/security review, deployed demo.

## Integration contracts to freeze early
- `MatchRequest`: seed, simVersion, teams/players, 5-starter assignments, validated controller deployments and match config.
- `MatchResult`: official final score, events, stats, replay URI, hashes, diagnostics, sim/controller version metadata.
- `TacticalRevision`: versioned JSON schema with validation + deterministic mapping into simulator controller actions.
- `EditorialFacts`: only persisted official events, standings, rosters, revisions and verified outcomes; never invented quotes/results.
- Job state: queued/running/succeeded/failed, idempotency key, attempt metadata and artifact links.

## Definition of done
Single command for local setup; migrations/seed; unattended 12-match season with deterministic result verification and no duplicated fixtures; standings correct; manager decisions and cost auditable; replays accessible; AI articles cite official data and carry disclosure; responsive Pop Arcade pages; tests, screenshots and walkthrough in PRs.

## Parallel agent workstreams
1. Foundation/data/API contracts (lead, owns migrations and schema).
2. Sim adapter/match jobs (depends on contract; owns integration and replay artifacts).
3. Public frontend/design system (can start with fixtures and mocked API data; no invented simulator visuals).
4. Manager agents/budget (depends on tactical schema and persistence).
5. Editorial agents/content (depends on official facts schema and match events).
6. E2E/deployment (starts CI immediately; integration after previous workstreams).

Avoid agents editing shared migrations, API schemas or package manifests concurrently; assign ownership and merge contract PR first.
