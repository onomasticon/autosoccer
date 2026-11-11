# Editorial validation: what the fact checker guarantees

Every AI-written article passes through `checkGrounding` (`apps/server/src/modules/editorial/grounding.ts`) before it can be published. Since iteration 2 (#42) that includes a **cross-fact claim checker** (`claims.ts`). It rebuilds a small structured ledger from the official facts: results, team stats and a table snapshot. It then evaluates the claims journalists make against all of those facts together, not one at a time.

## Pipeline

```
official record ─► EditorialFacts (facts.ts) ─► model draft ─► checkGrounding
                                                   │ fail
                                                   ▼
                                     one repair attempt (metered) ─► checkGrounding
                                                   │ still failing
                                                   ▼
                       template writer (same facts, no model, no cost) ─► checkGrounding
                                                   │ pass            │ fail
                                                   ▼                 ▼
                                               published     stored as rejected (never served)
```

- The model's rejected draft and the checker's errors are kept in the run audit (`agent_runs.prompt.rejected`).
- The template writer is never metered, so a rejection never costs more than the two model calls already reserved against the season's editorial budget.
- AI disclosure, citations and links to the authoritative match records are the same on every path.

## What is guaranteed

An article is published only if all of the following hold.

| Check | Example rejected |
| --- | --- |
| Cites at least one fact. Every citation id exists. A match report cites the official score. | `unknown fact id "match:…:invented"` |
| Every scoreline is an official final or running score. A three-part shape (`2-1-1`, `2–1–1`) or a hyphenated pair labelled *formation/shape/system/setup* counts as a formation. A two-part en-dash pair is always read as a score. | `Saltmarsh won 2-1.` |
| No quotation marks, because nobody is interviewed. No football minutes, because the sim has its own clock. | `the coach said “…”` |
| **Results:** "A beat / lost to / drew with B", "A won / lost", "A opened the scoring" match the official result. | `Harbour City beat Red Rock Rovers.` |
| **Team stats:** "A had 55% possession", "A had more/less of the ball", "A took 5 shots", including chained clauses ("…but took 7 shots"). | `Red Rock Rovers had more of the ball.` |
| **Aggregates across fixtures:** "the side with less possession / more shots / the home side / the visitors won (or lost, or drew) both / all / every / neither match" hold for every match in scope. "Both" requires exactly two matches. | `the side with less of the ball won both matches` |
| **Comparisons spanning matches:** "both winners / each beaten side had more/less possession or shots" hold in every decided match. | `Both winners had less of the ball.` |
| **The table:** position words (top, first…fourth, bottom), "lead the table", "on N points", and records (unbeaten, perfect record, winless…) match the snapshot. | `Saltmarsh Athletic are top of the table.` |
| **Chronology:** a past-tense mention of a round later than the snapshot is rejected. So is "after N rounds" when the snapshot is a different round. | `After two rounds, Red Rock Rovers are first.` |
| **Historical snapshots:** the standings facts for round N are built only from results up to round N, even when the article is regenerated later. | (fixed in `facts.ts` / `seasonStandings`) |
| **Citation text** is checked by the same claim rules, not only the body. | citation text "Red Rock Rovers had 55% possession" |
| **Unverifiable:** when a recognised claim can't be resolved against the record (no such fixture, team not in the snapshot), the article is rejected, not published. | `Harbour City beat Northgate Comets.` (no such fixture) |

All checks are deterministic (regular expressions over sentences plus a ledger). No model is asked to check itself.

## What is *not* guaranteed

The checker recognises specific claim shapes. It does not understand prose in general. In particular:

- **Unrecognised phrasings pass unjudged.** Vague framing ("possession share did not decide the result") and paraphrases outside the patterns ("the visitors, despite seeing less of the ball, prevailed twice") are not evaluated. The prompt tells journalists that generalisations are verified, and the one-sentence rule set is in `editorial/prompts.ts`.
- **Pronoun subjects are skipped.** "They lost 0–4" is not attributed to a team. The scoreline itself is still checked.
- **Appositives break attribution.** In "Northgate, sitting deep in a 2-1-1, put 3 shots on target", the number isn't attributed to Northgate, so it isn't checked.
- **Tactical interpretation is opinion.** "Patient circulation didn't turn recoveries into attempts" is not a checkable fact. Journalists may argue it if the cited numbers are right.
- **Stats outside the ledger** (average team height, pass accuracy, player-level numbers) are covered only by citation existence, not by comparison checks.
- **Player roles** ("Comets keeper Pia Laine") are not checked against lineup positions.

A missed claim errs toward publishing. A false rejection errs toward the template writer, which is safe but duller. Extend `claims.ts` with a new pattern and an adversarial fixture in `claims.test.ts` whenever a new failure shape is found.

## Reproduction and audit of published content (11 Nov 2026)

**Reproduced.** The round-1 analysis [`/news/red-rock-rovers-turn-a-279-metre-average-height-into-five-sh-2f7e20`](https://auto.soccer/news/red-rock-rovers-turn-a-279-metre-average-height-into-five-sh-2f7e20) states in its standfirst that "the side with less of the ball won both matches". The official record shows Saltmarsh Athletic had 55.3% possession and beat Northgate Comets 1–0. Every one of its 28 citations exists, so the old checks published it. The piece is reproduced verbatim in `claims.test.ts` ("the reviewed round-1 analysis"). The new checker rejects it with exactly one error that cites `match:acb2b79d:stat:possession`, and accepts the corrected standfirst.

**Audit of all published articles.** I rebuilt facts from the four public match pages and the round snapshots, then ran the new checks over all 5 published articles (4 match reports, 1 analysis):

| Article | Result |
| --- | --- |
| Red Rock Rovers turn a 27.9-metre average height… (analysis, round 1) | ✗ false possession aggregate (above) |
| Red Rock Rovers rout Harbour City 4-0 to top the table… (report) | ✓ |
| Pia Laine own goal hands Saltmarsh Athletic narrow win… (report) | ✓ |
| Viktor Hale strike gives Northgate Comets 1–0 win… (report) | ✓ |
| Max Ruiz strikes early as Red Rock Rovers edge Saltmarsh… (report) | ✓ |

On the production host, run the same audit against the database (read-only):

```sh
bun run ops editorial:audit          # human-readable
bun run ops editorial:audit --json   # for a ticket
```

## Proposed correction path (not applied automatically)

Published articles are part of the public record. The validators **never** rewrite or unpublish them silently. For a confirmed finding:

1. **Leave the article live, and add a visible correction note** above the body that names the false claim and links the contradicting official record. This needs an `articles.correction` field and a banner on the article page. It is proposed as a follow-up, not shipped here.
2. **Optionally publish a corrected piece** as a new article for the same round. Clear that round's `article.round:<season>:<round>` run so the job is regenerated through the full pipeline with the new checks. Link the two pieces both ways.
3. **Record the decision** in the ops log. The original text stays in `articles` and in the run audit.

For the one finding above, the recommended action is a correction note. The rest of the analysis (shots, tactics, table) is accurate.
