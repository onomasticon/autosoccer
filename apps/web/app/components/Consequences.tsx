/**
 * Consequences of club decisions (#80): a club's recent deals, why it was taken over, and a player's
 * transfers. Every deal links both clubs, the player's career and the window it was done in.
 */
import { type DealView, playerHref, type TakeoverView } from "@autosoccer/contracts";
import { Link } from "react-router";
import { credits } from "./ClubFinances";
import { TeamBadge } from "./TeamBadge";

const windowHref = (d: DealView) => `/transfers?season=${d.season.slug}`;

/** The club's deals, in and out, with its own manager's reason for each. */
export function ClubDeals({ deals, teamId }: { deals: DealView[]; teamId: string }) {
  if (!deals.length)
    return (
      <p className="card-surface p-4 text-sm text-muted-text" data-testid="club-deals">
        No completed deals yet. Transfer windows open before each season.
      </p>
    );
  return (
    <ul className="card-surface divide-y divide-line" data-testid="club-deals">
      {deals.map((d) => {
        const signed = d.to.id === teamId;
        const other = signed ? d.from : d.to;
        const mine = signed ? d.buyer : d.seller;
        return (
          <li key={d.id} className="space-y-1 p-4 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${signed ? "bg-lavender text-violet-deep" : "bg-coral/20 text-ink"}`}
              >
                {signed ? "Signed" : "Sold"}
              </span>
              <Link to={playerHref(d.player)} className="font-semibold underline underline-offset-4">
                {d.player.name}
              </Link>
              <span className="text-muted-text">{d.player.position}</span>
              <span>{signed ? "from" : "to"}</span>
              <TeamBadge team={other} size="sm" decorative />
              <Link to={`/teams/${other.slug}`} className="underline underline-offset-4">
                {other.name}
              </Link>
              <span className="tabular ml-auto font-display text-lg font-extrabold">{credits(d.fee)}</span>
            </p>
            {mine.reason && (
              <p className="text-muted-text">
                <span className="font-semibold text-ink">{mine.manager ?? "The manager"}:</span> {mine.reason}{" "}
                <span className="text-xs">(AI manager's recorded reason)</span>
              </p>
            )}
            <p className="text-xs">
              <Link to={windowHref(d)} className="text-violet-deep underline-offset-4 hover:underline">
                {d.season.name} transfer window <span aria-hidden>→</span>
              </Link>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** Why the club was taken over: the withdrawal, the numbers, and what the new owners did. */
export function TakeoverCard({ takeovers }: { takeovers: TakeoverView[] }) {
  if (!takeovers.length) return null;
  return (
    <div className="space-y-3" data-testid="takeover-card">
      {takeovers.map((t) => (
        <div key={t.returned.slug} className="card-surface space-y-2 border-l-4 border-coral p-4 text-sm">
          <p className="font-display text-lg font-extrabold uppercase italic">
            {t.from} → {t.to}
          </p>
          <p>
            <strong>Why:</strong> {t.from} couldn't pay their players before round {t.withdrew.round} of{" "}
            <Link to={`/table?season=${t.withdrew.season.slug}`} className="underline underline-offset-4">
              {t.withdrew.season.name}
            </Link>
            {t.basis.wages != null && t.basis.available != null
              ? `: ${credits(t.basis.wages)} of wages due with ${credits(t.basis.available)} available.`
              : "."}{" "}
            The club was declared bankrupt and withdrew; its remaining fixtures became walkovers.
          </p>
          <p>
            <strong>The rescue:</strong> new owners put in {credits(t.capital)} and the club returned for{" "}
            {t.returned.name} as {t.to}, keeping its place, squad, manager and honours.
          </p>
        </div>
      ))}
    </div>
  );
}

/** A player's moves between clubs, newest first. */
export function PlayerTransfers({ transfers }: { transfers: DealView[] }) {
  if (!transfers.length) return null;
  return (
    <ul className="card-surface divide-y divide-line" data-testid="player-transfers">
      {transfers.map((d) => (
        <li key={d.id} className="space-y-1 p-4 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <TeamBadge team={d.from} size="sm" decorative />
            <Link to={`/teams/${d.from.slug}`} className="underline underline-offset-4">
              {d.from.name}
            </Link>
            <span aria-hidden>→</span>
            <span className="sr-only">to</span>
            <TeamBadge team={d.to} size="sm" decorative />
            <Link to={`/teams/${d.to.slug}`} className="underline underline-offset-4">
              {d.to.name}
            </Link>
            <span className="tabular ml-auto font-display text-lg font-extrabold">{credits(d.fee)}</span>
          </p>
          <p className="text-muted-text">
            <span className="font-semibold text-ink">{d.buyer.manager ?? "The buying manager"}:</span> {d.buyer.reason}
          </p>
          {d.seller.reason && (
            <p className="text-muted-text">
              <span className="font-semibold text-ink">{d.seller.manager ?? "The selling manager"}:</span>{" "}
              {d.seller.reason}
            </p>
          )}
          <p className="text-xs">
            <Link to={windowHref(d)} className="text-violet-deep underline-offset-4 hover:underline">
              {d.season.name} transfer window <span aria-hidden>→</span>
            </Link>{" "}
            <span className="text-muted-text">Managers' reasons are their own recorded words (AI-written).</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** "Season 2: earned Ȼ9.6m (distribution 6m, results 1.2m, prize 2.4m); spent Ȼ9.2m (wages 8.7m, transfers 500k)." */
export function moneyStory(s: {
  season: { name: string };
  bySource: Record<"distribution" | "results" | "prize" | "payroll" | "transfers" | "takeover", number> &
    Partial<Record<"operating" | "borrowing" | "auctions" | "recruitment", number>>;
  net: number;
}): string {
  const parts = Object.entries({
    "league distribution": s.bySource.distribution,
    results: s.bySource.results,
    "prize money": s.bySource.prize,
    "takeover capital": s.bySource.takeover,
    "transfer fees": s.bySource.transfers,
    "running costs": s.bySource.operating ?? 0,
    "forced auctions": s.bySource.auctions ?? 0,
    "safety-net fees": s.bySource.recruitment ?? 0,
  });
  const income = parts.filter(([, v]) => v > 0);
  const spend = [
    ["wages", -s.bySource.payroll] as const,
    ...parts.filter(([, v]) => v < 0).map(([k, v]) => [k, -v] as const),
  ].filter(([, v]) => v > 0);
  const sum = (xs: ReadonlyArray<readonly [string, number]>) => xs.reduce((a, [, v]) => a + v, 0);
  const list = (xs: ReadonlyArray<readonly [string, number]>) => xs.map(([k, v]) => `${k} ${credits(v)}`).join(", ");
  // Borrowing isn't earned or spent: it's said separately, so earned − spent ± borrowing = the net.
  const borrowed = s.bySource.borrowing ?? 0;
  const debt = borrowed
    ? `; ${borrowed > 0 ? `borrowed ${credits(borrowed)} more than it repaid` : `repaid ${credits(-borrowed)} of debt`}`
    : "";
  return `${s.season.name}: earned ${credits(sum(income))}${income.length ? ` (${list(income)})` : ""}; spent ${credits(sum(spend))}${spend.length ? ` (${list(spend)})` : ""}${debt}; ${s.net >= 0 ? "up" : "down"} ${credits(Math.abs(s.net))}.`;
}
