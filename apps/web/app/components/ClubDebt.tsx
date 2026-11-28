import { type ClubDebt as Debt, playerHref } from "@autosoccer/contracts";
import { Link } from "react-router";
import { credits } from "./ClubFinances";

const LOAN_LABEL = {
  secured: "Secured loan",
  emergency: "Emergency financing",
  support: "Lender support",
} as const;

const LOAN_NOTE = {
  secured: "Borrowed against pledged players, 8% a season.",
  emergency: "Lent automatically when the club couldn't meet a round, 15% a season.",
  support: "Lent after a default to cover what forced sales couldn't, 5% a season.",
} as const;

const where = (x: { season: { name: string }; round: number | null }) =>
  `${x.season.name}${x.round ? `, round ${x.round}` : ""}`;

/**
 * Debt and recovery under the league lender (insolvency/2): what the club owes and to whom, whether
 * it is in administration, the rounds it couldn't meet and the forced auctions it took part in. Every
 * line comes from the lender's official records; sealed bids stay private (only how many clubs bid).
 */
export function ClubDebt({ debt, club }: { debt: Debt; club: string }) {
  const active = debt.loans.filter((l) => l.status === "active");
  // One row per kind of loan: a club in trouble can hold dozens of round-by-round emergency loans.
  const groups = (["secured", "emergency", "support"] as const)
    .map((kind) => {
      const loans = debt.loans.filter((l) => l.kind === kind);
      return {
        kind,
        loans,
        active: loans.filter((l) => l.status === "active").length,
        lent: loans.reduce((a, l) => a + l.principal, 0),
        repaid: loans.reduce((a, l) => a + l.repaid, 0),
        owed: loans.reduce((a, l) => a + Math.max(0, l.balance), 0),
        pledged: loans.flatMap((l) => l.pledged),
      };
    })
    .filter((g) => g.loans.length);
  const calm = !debt.loans.length && !debt.events.length && !debt.auctions.length && !debt.administration;
  return (
    <div className="card-surface space-y-4 p-4 text-sm" data-testid="club-debt">
      {debt.administration && !debt.administration.exited && (
        <p className="rounded-lg border-2 border-coral-deep p-3" role="note">
          <span className="font-semibold">In administration</span> since {where(debt.administration.since)}, owing{" "}
          {credits(debt.administration.debtAtEntry)} at the time. {debt.administration.reason}. Spare cash goes to the
          lender at each season's end until the debt is down to half the club's cap and it holds three rounds of wages.
          The club keeps playing every match.
        </p>
      )}
      {debt.administration?.exited && (
        <p className="rounded-lg border border-line p-3">
          <span className="font-semibold">Recovered.</span> Entered administration in {where(debt.administration.since)}
          , and left it at the end of {debt.administration.exited.name}.
        </p>
      )}
      {calm ? (
        <p className="text-muted-text">
          {club} has never borrowed from the league lender or missed a round's obligations.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-text">Owed to the lender</dt>
              <dd className="tabular font-display text-xl font-extrabold">{credits(debt.total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-text">Loans outstanding</dt>
              <dd className="tabular font-display text-xl font-extrabold">{active.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-text">Rounds it couldn't meet</dt>
              <dd className="tabular font-display text-xl font-extrabold">{debt.events.length}</dd>
            </div>
          </dl>
          {debt.loans.length > 0 && (
            <table className="w-full text-xs">
              <caption className="mb-1 text-left text-xs font-bold uppercase tracking-wider text-muted-text">
                Loans
              </caption>
              <thead className="text-left text-muted-text">
                <tr>
                  <th scope="col" className="py-1 font-semibold">
                    Loan
                  </th>
                  <th scope="col" className="py-1 pl-3 text-right font-semibold">
                    Lent
                  </th>
                  <th scope="col" className="hidden py-1 pl-3 text-right font-semibold sm:table-cell">
                    Repaid
                  </th>
                  <th scope="col" className="py-1 pl-3 text-right font-semibold">
                    Owed
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {groups.map((g) => (
                  <tr key={g.kind} className="border-t border-line align-top">
                    <th scope="row" className="py-1 text-left font-medium">
                      {LOAN_LABEL[g.kind]}
                      {g.loans.length > 1 ? ` × ${g.loans.length}` : ""}
                      <span className="block font-normal text-muted-text">
                        {g.loans.length > 1 ? `from ${where(g.loans.at(-1)!.opened)}` : where(g.loans[0]!.opened)}
                        {g.active ? ` · ${g.active} outstanding` : " · repaid"}
                        {g.pledged.length > 0 && ` · pledged: ${g.pledged.join(", ")}`}
                      </span>
                    </th>
                    <td className="py-1 pl-3 text-right">{credits(g.lent)}</td>
                    <td className="hidden py-1 pl-3 text-right sm:table-cell">{credits(g.repaid)}</td>
                    <td className="py-1 pl-3 text-right font-semibold">{credits(g.owed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {debt.loans.length > groups.length && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-violet-deep">
                Every loan ({debt.loans.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {debt.loans.map((l, i) => (
                  <li key={`${l.kind}-${i}`} className="flex justify-between gap-3">
                    <span>
                      {LOAN_LABEL[l.kind]}, {where(l.opened)}
                      <span className="text-muted-text">
                        {" "}
                        · {l.status === "repaid" ? "repaid" : `due by season ${l.dueSeason}`}
                      </span>
                    </span>
                    <span className="tabular shrink-0">
                      {credits(l.principal)} lent · {credits(Math.max(0, l.balance))} owed
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {debt.loans.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-text">
              {[...new Set(debt.loans.map((l) => l.kind))].map((k) => (
                <li key={k}>
                  <span className="font-semibold">{LOAN_LABEL[k]}:</span> {LOAN_NOTE[k]}
                </li>
              ))}
            </ul>
          )}
          {debt.events.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-text">When the money ran short</h3>
              <ol className="mt-1 space-y-1">
                {debt.events.slice(0, 5).map((e) => (
                  <li key={`${e.season.slug}-${e.round}`}>
                    <span className="font-semibold">{where(e)}:</span>{" "}
                    {e.outcome === "emergency"
                      ? `short by ${credits(e.shortfall)}; the lender advanced emergency financing.`
                      : `short by ${credits(e.shortfall)} beyond its borrowing limit: a default.${
                          e.auctioned
                            ? ` The lender auctioned ${e.auctioned} player${e.auctioned === 1 ? "" : "s"}.`
                            : ""
                        }`}
                  </li>
                ))}
              </ol>
              {debt.events.length > 5 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-semibold text-violet-deep">
                    {debt.events.length - 5} earlier round{debt.events.length - 5 === 1 ? "" : "s"}
                  </summary>
                  <ol className="mt-1 space-y-1">
                    {debt.events.slice(5).map((e) => (
                      <li key={`${e.season.slug}-${e.round}`}>
                        <span className="font-semibold">{where(e)}:</span>{" "}
                        {e.outcome === "emergency"
                          ? `short by ${credits(e.shortfall)}; the lender advanced emergency financing.`
                          : `short by ${credits(e.shortfall)} beyond its borrowing limit: a default.${
                              e.auctioned
                                ? ` The lender auctioned ${e.auctioned} player${e.auctioned === 1 ? "" : "s"}.`
                                : ""
                            }`}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          )}
          {debt.auctions.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-text">Forced auctions</h3>
              <ul className="mt-1 space-y-1">
                {debt.auctions.map((a) => (
                  <li
                    key={`${a.season.slug}-${a.round}-${a.player.id}`}
                    className="flex flex-wrap justify-between gap-2"
                  >
                    <span>
                      <Link to={playerHref(a.player)} className="font-semibold underline underline-offset-4">
                        {a.player.name}
                      </Link>{" "}
                      {a.role === "sold"
                        ? `sold to ${a.counterparty?.name ?? "another club"}`
                        : a.role === "bought"
                          ? `bought from ${a.counterparty?.name ?? "another club"}`
                          : "offered, but no bid met the reserve"}{" "}
                      <span className="text-muted-text">
                        ({where(a)}, {a.bidders} sealed bid{a.bidders === 1 ? "" : "s"})
                      </span>
                    </span>
                    <span className="tabular font-semibold">{a.amount == null ? "–" : credits(a.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="text-xs text-muted-text">
        The league lender (insolvency/2): a club that can't meet a round's wages, running costs and repayments borrows
        within a cap of three quarters of a season's wages; past that, the lender auctions players (never below nine, or
        the last keeper) and the club may enter administration. Nobody forfeits a match. Bids are sealed and stay
        private; only the winning price is public. These rules apply only to seasons run under insolvency/2: earlier
        seasons used walkovers and takeovers (insolvency/1).
      </p>
    </div>
  );
}
