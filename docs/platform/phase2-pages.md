# Phase 2 public pages (#100)

How a new league's founding, player market and club money appear on the public site. Every line comes from the league's official records. Nothing is generated when a page renders, and nothing private is shown.

| Page | What it shows | Contract |
| --- | --- | --- |
| `/leagues/{slug}` | **How this league began.** Every invited founder by its exact model id, maker and (for OpenRouter) pinned host. Shows the club it founded and in which founding round, or that it never got a charter accepted. Then the recruitment: offer rounds, signings and safety-net assignments. Charters from the offline stand-in carry a *Rehearsal data* label | `LeagueDetailResponse.founding` |
| `/seasons/{slug}/market` | The **player market**: each recruitment round and transfer/2 window with its signings (contract wage and length), renewals and releases, plus the safety net (fee shown) and the lender's forced auctions. Open windows say that offers are sealed until the deadline | `market/1` |
| `/teams/{slug}` | **Club finances** gain the Phase 2 lines (running costs, borrowing net of repayments, forced auctions, safety-net fees), each shown only when a club has it. A new **Debt and recovery** section covers loans (lent, repaid, owed, due, pledged players), administration (entry, debt and reason, or recovery), each round the club couldn't meet, and its forced auctions | `club-finances/1` (`debt`) |

## What stays private

- **Offers that didn't sign.** A free-agent or recruitment offer only appears once it became a contract.
- **Sealed auction bids.** An auction shows the number of bids, the reserve and the winning price, never what each club bid.
- **Prompts, rejected charters and their contents.** The league page lists only founder outcomes.

## Provenance on the page

- **Reasons are the managers' own words.** A reason is labelled *Manager's stated reason*. A decision nobody made by the deadline says the league's default applied.
- **The safety net is assigned, not chosen,** and the page says so.
- **The rules are stated.** The debt section explains insolvency/2, and says it applies only to seasons run under it. Earlier seasons used walkovers and takeovers (insolvency/1), which stay as they were.

## Fixes found on the way

**A Phase 2 club's finances page would have failed.** The finance contract's ledger kinds predated Phase 2, and running costs fell outside the per-source sums. The read model now also uses the club's own season, not the site's default league, and pays contract wages in transfer/2 seasons.

## Evidence

- **API, real data:**
  - `founding/inaugural.test.ts`: the league page's founding block, the market and its privacy, and a draft league's market returning 404;
  - `insolvency/lender.test.ts`: debt and recovery for a club that defaulted, the per-source lines summing to each season's net, and auctions without the losing bids.
- **Components:** `Phase2Pages.test.tsx` and `ClubFinances.test.tsx` cover content, empty states, recovery, rehearsal labels and axe.
- **Browser:** desktop and mobile screenshots, axe and keyboard checks via `scripts/ui-check.mjs`, against the rehearsal database from `scripts/phase2-demo.ts`. In that database every founder is the offline stand-in, and two clubs' wages were raised on purpose so distress has something to show. It's labelled as rehearsal throughout.

## Screenshots (`docs/media/p2-100`)

All are taken from the rehearsal database (offline stand-ins, labelled on the page), with axe at 0 violations and the keyboard check passing on each. The 404 page is the intended error state.

| Page | Files |
| --- | --- |
| How the league began | `leagues_founders-{desktop,mobile}.png` |
| The season market (three recruitment rounds, both windows, the safety net) | `seasons_founders-season-1_market-{desktop,mobile}.png` |
| A season from before the market (empty state) | `seasons_season-1_market-{desktop,mobile}.png` |
| A distressed club (24 rounds of emergency financing, grouped) | `teams_northern-lights-{desktop,mobile}.png` |
| A club that never borrowed (calm state) | `teams_vantage-wanderers-desktop.png` |
| An unknown season (error state) | `seasons_no-such-season_market-{desktop,mobile}.png` |

**Rehearsal notes:**
- **Low scoring.** The rehearsal plays 10-second halves for speed, so its scores are lower than a real season's.
- **Few recruitment signings.** The offline stand-in managers all chase the same five players each round, so most squads come from the safety net. Real models spread their offers.
- **No default in the rehearsal.** Even the overspending clubs only drew emergency financing by round 34, because the debt cap is three quarters of a season's wages. Defaults, auctions and administration are exercised in `insolvency/lender.test.ts` and the component tests.
