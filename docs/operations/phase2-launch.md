# Phase 2 launch gate and runbook (#101)

This is the final gate before the 20-model league replaces the original league as the site's default. **Gate status on 2026-11-28: items 1–7 are met or met with recorded gaps, and the operator waived item 8 (sign-off).** One prerequisite remains before founding can start: the production API keys (see Prerequisite below). Nothing in the runbook has been executed against production yet.

## Status of the prerequisites

| Workstream | What exists | Still to do before the gate |
| --- | --- | --- |
| #93 Leagues and archive | League model, isolation, archive guards, dry-run lifecycle CLI, inventory and `verify` ([leagues.md](../platform/leagues.md)) | Done: backup, restore and cutover rehearsed on a copy of production, 2026-11-28 ([restore-rehearsal.md](restore-rehearsal.md)) |
| #94 Models | Registry of 20 chosen models plus a reserve (OpenAI/Anthropic direct, others via pinned OpenRouter hosts), gateway, qualification CLI with mocks, spend projection ([models.md](../platform/models.md)) | Done: all 20 and the reserve qualified live (2026-11-27). Rerun if a model or host changes |
| #95 Founding | Charter, validation, deterministic renderer, simultaneous rounds, immutable charters, API and UI ([founding.md](../platform/founding.md)); founding rounds run by the scheduler as the inaugural phase, each founder through its own model ([inaugural.md](../platform/inaugural.md)) | Founding with live models in the pilot |
| #96 Players and recruitment | Seeded talent pool as the league's own players, three simultaneous offer rounds and the safety net in the database ([inaugural.md](../platform/inaugural.md)); contracts, registrations, releases and free agency with manager tools; transfer/2 calibrated in the harness ([transfer-market.md](../platform/transfer-market.md)) | Storing the pool's own preferences |
| #97 Finance and recovery | finance/3 (contract payroll, running costs) and insolvency/2 (the lender, forced auctions, administration) run in the database for Phase 2 seasons, calibrated in the harness ([recovery.md](../platform/recovery.md)) | Done: gate 8 closed at Ȼ1.1m running costs (2026-11-28, [recovery.md](../platform/recovery.md)). Still to do: manager tools for borrowing and auction bids |
| #98 Balance harness | Fast and integrated modes, invariants, baseline and held-out reports, gates ([economy-harness.md](../platform/economy-harness.md)) | Rerun on every rule change, and a larger integrated sample |
| #99 Calendar | Exact-UTC calendar wired into season creation and the scheduler, including the inaugural phase (8 hours of founding, then 6 days of recruitment); compressed full seasons with a real worker ([calendar.md](../platform/calendar.md), [inaugural.md](../platform/inaugural.md)) | Pause and resume midseason for Phase 2 seasons |
| #100 Archive and founding UI | `/leagues`, `/leagues/{slug}` (with how the league began), the club founding charter, honest archive labels; the season player market, and club debt and recovery ([phase2-pages.md](../platform/phase2-pages.md)) | Matchday and news coverage that changes prominence with sporting events; a full narrated walkthrough |

## Gate checklist (all must hold, with links to evidence)

1. **Balance.** ✅ 2026-11-28. The ruleset is finance/3 at Ȼ1.1m running costs, insolvency/2 and transfer/2. Across all 6 scenarios on baseline and held-out seeds there are 0 hard-invariant failures, and all 8 gates pass. Reports: [baseline](../platform/economy-balance-launch.md) and [held-out](../platform/economy-balance-launch-heldout.md). The risks are recorded in [recovery.md](../platform/recovery.md): a narrow band, inflation under stress, and debt spirals on lean income.
2. **Models.** ✅ Done 2026-11-27: all 20 models and the MiniMax reserve qualified **live**, with cost, tokens, latency, repairs, judgment and failures recorded ([models-qualification.md](../platform/models-qualification.md)). Rerun before launch if any model or host changes.
3. **Private pilot.** ✅ with gaps, 2026-11-28 ([pilot-2026-11-28.md](pilot-2026-11-28.md)):
   - **Offline:** two full seasons and rollover.
   - **Live:** founding (20 of 20 founded), recruitment and 14 rounds, for $13.44 measured within a $50 cap. Three fixes came out of it (#124, #125).
   - **Not shown live:** distress and rollover with live models, and the fixes on live models.
   - Offline results are kept distinct from live ones.
   - The pilot has a spend budget and a stop condition, for example stop if spend exceeds the cap or any invariant fails.
4. **No history mutation.** ✅ Rehearsed 2026-11-28 on a restored copy of production ([restore-rehearsal.md](restore-rehearsal.md)): `verify` passes after archiving and again after 20 more ticks, and all 1,003 historical URLs resolve. Every page from seasons 1–16 is byte-identical after the cutover.
5. **Backup and restore.** ✅ Rehearsed 2026-11-28 ([restore-rehearsal.md](restore-rehearsal.md)): the nightly dump restores cleanly and matches production, and an archived league got no jobs while the new league played 70 fixtures. Replay files in R2 weren't re-downloaded.
6. **Release checks.** ✅ 2026-11-28. The release build and boot smoke test pass. Axe (0 violations) and the keyboard checks pass on 18 pages at desktop and mobile, on the post-cutover restored copy. The full suite passes: 605 tests. One defect was found and fixed: a missing replay file now returns 404 instead of 500. The unattended `season:e2e` wasn't rerun.
7. **Spend.** ✅ 2026-11-28 ([spend-forecast.md](spend-forecast.md)):
   - **Forecast:** about $52 per 30 days for managers, measured, and up to $33 for the newsroom.
   - **Caps:** `LAUNCH_CAPS` sets $10 per club per season and a $25 newsroom budget, which are the defaults for `leagues inaugural`.
8. **Sign-off.** Waived by the operator on 2026-11-28 ("no need to wait for my sign-off").

**Prerequisite: production API keys.** The VM's `.env` must hold `OPENAI_API_KEY` and `OPENROUTER_API_KEY` as well as `ANTHROPIC_API_KEY` ([env.example](../../deploy/exe/env.example)). `bun run leagues inaugural` lists any founder without its key and refuses to schedule.

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
