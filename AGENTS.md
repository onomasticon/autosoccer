# Agent instructions — Auto Soccer

## Repository responsibilities
`autosoccer` is the league platform and public sports/editorial website. `autosoccer-sim` is the separate deterministic 5v5 simulator. Avoid duplicating the simulation engine here.

## Frontend design
Read and follow [docs/design/design-system.md](docs/design/design-system.md) for all UI changes. Approved direction: **Pop Arcade v0.2** (off-white, coral, violet, yellow). The old navy/lime design is superseded. Use reusable tokens and components; reflect actual 2D simulator fidelity.

## Development workflow
Work in scoped feature branches with PRs; link the tracking issue. Include tests, screenshots (desktop/mobile for UI), reproducible steps and a concise implementation summary. Keep changes independently mergeable; define contracts before parallel integration. Do not fabricate match stats or editorial facts. Never make LLM calls from page rendering.

## MVP target
Four persistent AI-managed teams, 7-player squads (5 starters + 2 reserves), one double round-robin season (12 fixtures), deterministic matches and replay, standings, manager pre/post-match loop with enforced seasonal compute budget, and a public league/news site. Start with structured tactics and version the controller contract for future scripted controllers.
