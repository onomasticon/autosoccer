# Bankruptcy and rescue takeovers (`insolvency/1`)

A club that can't pay its players goes bankrupt and leaves the season. The next season it comes back under new owners and a new name. Money is the league's fictional credits (cr, see [finances.md](finances.md)).

## When a club goes bankrupt

Before every round, before the previews, the managers' decisions and the matches, the league checks every club still in the season.

**A club must be able to pay that round's wages.** It can count its cash plus any money due as the round kicks off; in round 1 that includes the league distribution. A club that can't is declared bankrupt from that round.

Only spending moves cash down: wages every round, and transfer fees in the window. A club can bid up to all its cash in the window, so overspending there is the usual road to bankruptcy, a few rounds into the season.

**Between seasons.** Money that moves after a season's last result, the prizes and the transfer window, belongs to the next season. A club is never declared bankrupt between seasons. The first check that can catch it is the one before the next season's round 1.

## What happens to the season

- **The club withdraws immediately.** It plays no more matches that season. It is placed at the bottom of the table, marked withdrawn, and can't win the title or a finishing prize, whatever its points.
- **Everything already played stands.** Its results, goals, statistics and replays stay in the record.
- **Its remaining fixtures are walkovers.** Each opponent gets 3 points and a win, with no goals either way, so goal difference doesn't change. Nobody makes an appearance or scores. No match is simulated, so there is no replay, lineup or match report.
- **Two withdrawn clubs.** When both clubs in a fixture have withdrawn, it is void: no points for either.
- **Where you see it.** The table, the fixture list and Matchday all show the walkover or void, who withdrew, and why.
- **The managers.** A withdrawn club's manager makes no more decisions that season, and any of its transfer offers still open are closed.

## The money

| What | After bankruptcy |
| --- | --- |
| Wages | Stop from the round the club withdrew. |
| Result income | None for walkovers: no match was played. |
| Finishing prizes | Paid to the clubs still in, by their position among themselves. A withdrawn club gets nothing. |
| Distribution | Kept if already received. A club withdrawn before round 1 doesn't get one. |
| The club's cash | Stays as it was, short of a round's wages. |

## The takeover

When the next season is created, new owners take over every club that withdrew:

- **They put in fresh capital.** It brings the club's cash back up to the opening balance (12m cr), shown as "Takeover capital" in the club's finances.
- **The club gets a new name.** It is its city plus a new suffix, for example Northgate Comets → Northgate Phoenix. A name the league has used before is skipped. Colours and crest stay.
- **It keeps everything else:** its place in the league, its squad and manager, its honours, its web address, and its supporters' follows.
- **Old seasons keep the old name.** Tables, results, Matchday, match pages, transfer windows and careers from earlier seasons show the name the club had then. The club page lists every name it has had and why it changed.

## For operators

- **Rules.** The rule is versioned in `apps/server/src/modules/insolvency/rules.ts`; the check and walkovers are in `check.ts`, the takeover in `takeover.ts`.
- **Exactly once.**
  - A club is declared bankrupt at most once per season, and checks are serialised.
  - A round is checked only while none of its fixtures has been released.
  - A walkover resolves only from a scheduled fixture.
  - The takeover's identity and capital are written once, in one transaction.
  - Retries, repeated scheduler ticks and several workers change nothing.
- **Adoption.** Seasons created before this change have no `insolvency_rule`, so nothing is checked in them. A league adopts bankruptcy from the next season it creates. Past results, frozen match requests and verified replays are untouched.
- **Tuning.** The six-season balance run ([finance-balance.md](finance-balance.md)) has no bankruptcies. The offline managers keep 3m cr of headroom, so a prudent club never comes close.
  - `scripts/bankruptcy-demo.ts` shows what a reckless one does. Northgate spent 12.15m cr of their 12.33m cr on one signing and went bankrupt before round 5. They returned the next season as Northgate Phoenix with 12m cr.
  - We kept the rules as they are. A solvent club can make this bad decision, and the consequence comes during the season, while it still matters.
