# Phase 2 launch gate and runbook (#101)

This is the final gate before the 20-model league replaces the original league as the site's default. **Nothing here has been executed against production, and no paid model call has been made.** Each step needs explicit operator approval at the time it runs. An earlier approval doesn't carry over.

## Status of the prerequisites

| Workstream | What exists | Still to do before the gate |
| --- | --- | --- |
| #93 Leagues and archive | League model, isolation, archive guards, dry-run lifecycle CLI, inventory and `verify` ([leagues.md](../platform/leagues.md)) | A backup and restore rehearsal on a copy of production |
| #94 Models | Registry of 20 chosen models plus a reserve (OpenAI/Anthropic direct, others via pinned OpenRouter hosts), gateway, qualification CLI with mocks, spend projection ([models.md](../platform/models.md)) | Done: all 20 and the reserve qualified live (2026-11-27). Rerun if a model or host changes |
| #95 Founding | Charter, validation, deterministic renderer, simultaneous rounds, immutable charters, API and UI ([founding.md](../platform/founding.md)); founding rounds run by the scheduler as the inaugural phase, each founder through its own model ([inaugural.md](../platform/inaugural.md)) | Founding with live models in the pilot |
| #96 Players and recruitment | Seeded talent pool as the league's own players, three simultaneous offer rounds and the safety net in the database ([inaugural.md](../platform/inaugural.md)); contracts, registrations, releases and free agency with manager tools; transfer/2 calibrated in the harness ([transfer-market.md](../platform/transfer-market.md)) | Storing the pool's own preferences |
| #97 Finance and recovery | finance/3 (contract payroll, running costs) and insolvency/2 (the lender, forced auctions, administration) run in the database for Phase 2 seasons, calibrated in the harness ([recovery.md](../platform/recovery.md)) | Manager tools for borrowing and auction bids, fan-facing pages, and held-out inflation (gate 8) |
| #98 Balance harness | Fast and integrated modes, invariants, baseline and held-out reports, gates ([economy-harness.md](../platform/economy-harness.md)) | Rerun on every rule change, and a larger integrated sample |
| #99 Calendar | Exact-UTC calendar wired into season creation and the scheduler, including the inaugural phase (8 hours of founding, then 6 days of recruitment); compressed full seasons with a real worker ([calendar.md](../platform/calendar.md), [inaugural.md](../platform/inaugural.md)) | Pause and resume midseason for Phase 2 seasons |
| #100 Archive and founding UI | `/leagues`, `/leagues/{slug}`, the club founding charter, honest archive labels | Founding-event, market and distressed-club stories, and a full walkthrough |

## Gate checklist (all must hold, with links to evidence)

1. **Balance.** A balance report on baseline and held-out seeds for the chosen ruleset, with zero hard-invariant failures and the [acceptance gates](../platform/economy-harness.md#initial-acceptance-gates-proposed-tune-with-evidence) met. The ruleset and its unresolved risks are documented.
2. **Models.** ✅ Done 2026-11-27: all 20 models and the MiniMax reserve qualified **live**, with cost, tokens, latency, repairs, judgment and failures recorded ([models-qualification.md](../platform/models-qualification.md)). Rerun before launch if any model or host changes.
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
