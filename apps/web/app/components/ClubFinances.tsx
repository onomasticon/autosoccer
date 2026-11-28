import type { ClubFinancesResponse } from "@autosoccer/contracts";
import { moneyStory } from "./Consequences";

/** "Ȼ1.25m", "Ȼ450k", "−Ȼ300k" (same rule as the server's formatCredits). */
export function credits(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}Ȼ${(a / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}m`;
  if (a >= 1_000) return `${sign}Ȼ${Math.round(a / 1_000)}k`;
  return `${sign}Ȼ${a}`;
}

const SOURCES = [
  ["distribution", "League distribution"],
  ["results", "Results"],
  ["prize", "Finishing prize"],
  ["payroll", "Wages"],
  ["transfers", "Transfer fees"],
  ["takeover", "Takeover capital"],
  // Phase 2 (finance/3, insolvency/2, recruit/1): shown only for clubs that have them.
  ["operating", "Running costs"],
  ["borrowing", "Borrowing, net of repayments"],
  ["auctions", "Forced auctions"],
  ["recruitment", "Safety-net fees"],
] as const;
const ALWAYS = new Set(["distribution", "results", "prize", "payroll", "transfers", "takeover"]);

/**
 * A club's fictional treasury (club-finances/1): cash, wages still due and headroom, then how it
 * earned and spent money each season, and the latest entries. Credits are fictional; the real AI
 * compute budget is shown separately.
 */
export function ClubFinances({ finances: f }: { finances: ClubFinancesResponse }) {
  if (!f.active)
    return (
      <p className="card-surface p-4 text-sm text-muted-text" data-testid="club-finances">
        Club finances start with the club's next season: an opening balance of {credits(f.rules.opening)}, then a league
        distribution, prize money and wages every season.
      </p>
    );
  const latest = f.seasons.at(-1);
  return (
    <div className="card-surface space-y-4 p-4 text-sm" data-testid="club-finances">
      <dl className="grid grid-cols-3 gap-2">
        {(
          [
            ["Cash", f.balance],
            ["Wages still due", -f.payroll.remaining],
            ["Headroom", f.headroom],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-text">{k}</dt>
            <dd className={`tabular font-display text-xl font-extrabold`}>{credits(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-text">
        Wages: {credits(f.payroll.perRound)} a round for {f.payroll.players} players
        {f.payroll.roundsToPay > 0
          ? `, ${f.payroll.roundsToPay} round${f.payroll.roundsToPay === 1 ? "" : "s"} still to pay this season.`
          : "."}{" "}
        Headroom counts no income still to come: that depends on results.
      </p>
      {latest && (
        <ul className="space-y-1 text-sm" data-testid="money-story">
          {f.seasons
            .slice(-3)
            .reverse()
            .map((s) => (
              <li key={s.season.slug}>{moneyStory(s)}</li>
            ))}
        </ul>
      )}
      {latest && (
        <table className="w-full text-xs">
          <caption className="mb-1 text-left text-xs font-bold uppercase tracking-wider text-muted-text">
            Earned and spent, by season
          </caption>
          <thead className="text-left text-muted-text">
            <tr>
              <th scope="col" className="py-1 font-semibold">
                Source
              </th>
              {f.seasons.slice(-3).map((s) => (
                <th key={s.season.slug} scope="col" className="py-1 text-right font-semibold">
                  {s.season.name.replace("Season ", "S")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {SOURCES.filter(([k]) => ALWAYS.has(k) || f.seasons.slice(-3).some((s) => s.bySource[k])).map(
              ([k, label]) => (
                <tr key={k} className="border-t border-line">
                  <th scope="row" className="py-1 text-left font-medium">
                    {label}
                  </th>
                  {f.seasons.slice(-3).map((s) => (
                    <td key={s.season.slug} className="py-1 text-right">
                      {s.bySource[k] ? credits(s.bySource[k]) : "–"}
                    </td>
                  ))}
                </tr>
              ),
            )}
            <tr className="border-t border-line font-semibold">
              <th scope="row" className="py-1 text-left">
                Net
              </th>
              {f.seasons.slice(-3).map((s) => (
                <td key={s.season.slug} className={`py-1 text-right`}>
                  {credits(s.net)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
      <details className="group">
        <summary className="cursor-pointer text-xs font-semibold text-violet-deep">Latest entries</summary>
        <ul className="mt-2 space-y-1 text-xs">
          {f.entries.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex justify-between gap-3">
              <span>{e.memo}</span>
              <span className={`tabular shrink-0 font-semibold`}>
                {e.amount > 0 ? "+" : ""}
                {credits(e.amount)}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted-text">
        Fictional credits, settled by the league's rules ({f.rule ?? "finance/1"}): {credits(f.rules.distribution)} to
        every club each season, {credits(f.rules.result.win)} a win, {credits(f.rules.result.draw)} a draw, and{" "}
        {f.rules.prize.map(credits).join(" / ")} for finishing 1st to {f.rules.prize.length}th.{" "}
        {f.rule === "finance/3"
          ? "Wages are each player's contract, paid a round at a time, plus the club's running costs."
          : "Wages rise with each player's rating; a transfer fee is paid in full when the deal settles."}{" "}
        Separate from the AI managers' real compute budget.
      </p>
    </div>
  );
}
