# Phase 2 launch gate and runbook (#101)

This is the final gate before the 20-model league replaces the original league as the site's default. **Nothing here has been executed against production, and no paid model call has been made.** Each step needs explicit operator approval at the time it runs. An earlier approval doesn't carry over.

## Status of the prerequisites

| Workstream | What exists | Still to do before the gate |
| --- | --- | --- |
| #93 Leagues and archive | League model, isolation, archive guards, dry-run lifecycle CLI, inventory and `verify` ([leagues.md](../platform/leagues.md)) | A backup and restore rehearsal on a copy of production |
| #94 Models | Registry of 20 documented candidates plus a reserve, gateway, qualification CLI with mocks, spend projection ([models.md](../platform/models.md)) | Operator decisions on the Meta, Mistral and OpenAI slots and on moving names. Then **live qualification** under a spend cap |
| #95 Founding | Charter, validation, deterministic renderer, simultaneous rounds, immutable charters, API and UI ([founding.md](../platform/founding.md)) | Founding with live models in the pilot |
| #96 Players and recruitment | Seeded talent pool, simultaneous offer rounds, safety net (`players/recruitment.ts`) | Persistence (effective-dated registrations, contracts), and windows after founding |
| #97 Finance and recovery | finance/3 and insolvency/2 as pure rules, compared against today's rules in the harness ([economy-balance.md](../platform/economy-balance.md)) | Database settlement for loans, auctions and administration, and fan-facing pages |
| #98 Balance harness | Fast and integrated modes, invariants, baseline and held-out reports, gates ([economy-harness.md](../platform/economy-harness.md)) | Rerun on every rule change, and a larger integrated sample |
| #99 Calendar | Exact-UTC season calendar and opportunity schedule ([calendar.md](../platform/calendar.md)) | Wiring into season creation and the scheduler, and a compressed full season with a real worker |
| #100 Archive and founding UI | `/leagues`, `/leagues/{slug}`, the club founding charter, honest archive labels | Founding-event, market and distressed-club stories, and a full walkthrough |

## Gate checklist (all must hold, with links to evidence)

1. **Balance.** A balance report on baseline and held-out seeds for the chosen ruleset, with zero hard-invariant failures and the [acceptance gates](../platform/economy-harness.md#initial-acceptance-gates-proposed-tune-with-evidence) met. The ruleset and its unresolved risks are documented.
2. **Models.** 20 models, or approved substitutes, qualified **live**. Each records its snapshot or version, prompt and tool schema, cost, tokens, latency, retries and failures. Cohere is compared with MiniMax.
3. **Private pilot.** A multi-season pilot on an isolated database with an accelerated calendar: founding, recruitment, matches, both windows, financial distress and recovery, development and rollover.
   - Offline results are kept distinct from live ones.
   - The pilot has a spend budget and a stop condition, for example stop if spend exceeds the cap or any invariant fails.
4. **No history mutation.** `bun run leagues verify --league original` passes after a rehearsal, and old season, match, replay, club, player and article URLs resolve.
5. **Backup and restore.** A backup-and-restore rehearsal succeeds, and the scheduler stays isolated: an archived league gets no jobs.
6. **Release checks.** Smoke, end-to-end and accessibility checks pass on the release build.
7. **Spend.** A monthly forecast for managers, the newsroom and hosting, separately, with caps written into configuration.
8. **Sign-off.** The operator signs off on the rules, the caps and the exact launch cadence. **No launch date is assumed.**

## Runbook (after every gate item is checked and signed off)

1. **Announce** the original league's final season (news), and mark it: `bun run leagues final-season --league original --season season-N --confirm original`.
2. **Let it finish.** When the season completes, the scheduler concludes the league instead of rolling over. Check that `bun run leagues list` shows `original concluded`.
3. **Back up.** Run `deploy/exe/backup.sh`, note the dump name, and capture `bun run leagues inventory --league original`.
4. **Create the new league** as a draft: `bun run leagues create --league <slug> --name "<name>" --confirm <slug>`.
5. **Found the clubs** with the qualified models. Run recruitment and verify 20 viable squads. Create the first season from `calendar/1`.
6. **Activate**, only after explicit sign-off: `activate`, then `set-default`, both with `--confirm`.
7. **Archive the original:** `archive --league original --backup <dump> --confirm original`, then `verify`.
8. **Monitor.**
   - `bun run ops status`, worker logs, and the compute ledger per model.
   - Alert on any invariant breach, a stalled round, a model outage or spend above its cap.

## Rollback

- **Before activation:** delete nothing. Leave the draft league invisible. The original league is unaffected until it concludes.
- **After activation:** `set-default --league original` restores the original as the default, and `unarchive` reverses an archive.
- **Anything deeper:** restore the dump from step 3 ([deploy doc](deploy-cloudflare-exe.md#backups-and-restore)).

## Deferred, by design

Additional divisions and cups, facility and commercial simulation, advanced takeovers, youth academies, and in-match LLM management.
