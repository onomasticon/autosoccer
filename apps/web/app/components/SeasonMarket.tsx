import { type MarketMove, playerHref, type SeasonMarketResponse } from "@autosoccer/contracts";
import { Link } from "react-router";
import { credits } from "./ClubFinances";
import { EmptyState } from "./States";
import { TeamBadge } from "./TeamBadge";

type Window = SeasonMarketResponse["windows"][number];

const WINDOW_TITLE = (w: Pick<Window, "kind" | "round">) =>
  w.kind === "recruitment"
    ? `Recruitment, round ${w.round}`
    : w.kind === "preseason"
      ? "Preseason window"
      : "Midseason window";

const WINDOW_NOTE = {
  recruitment:
    "Every club's offers for the shared talent pool were settled at once after the deadline: each player chose the offer that suited him best, so answering first gained nothing.",
  preseason: "Clubs renewed or released players whose contracts ended, then offered contracts to free agents.",
  midseason: "Free agents only. Signings play from the second half of the season.",
} as const;

const MOVE_LABEL: Record<MarketMove["type"], string> = {
  recruited: "Recruited",
  signed: "Signed",
  renewed: "Renewed",
  released: "Released",
  "safety-net": "Safety net",
};

const PHASE = { renewals: "Renewals open", free_agency: "Offers open", closed: "Settled" } as const;

const time = (iso: string) =>
  `${new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;

function Move({ m }: { m: MarketMove }) {
  return (
    <li className="flex flex-wrap items-start gap-3 py-2" data-testid="market-move">
      <TeamBadge team={m.team} size="sm" decorative />
      <div className="min-w-0 flex-1">
        <p>
          <span className="mr-2 rounded bg-lavender px-1.5 py-0.5 text-xs font-semibold">{MOVE_LABEL[m.type]}</span>
          <Link to={playerHref(m.player)} className="font-semibold underline-offset-4 hover:underline">
            {m.player.name}
          </Link>{" "}
          <span className="text-muted-text">
            {m.player.position} · {m.type === "released" ? "left" : "to"}{" "}
            <Link to={`/teams/${m.team.slug}`} className="underline underline-offset-4">
              {m.team.name}
            </Link>
          </span>
        </p>
        {m.reason && (
          <p className="mt-1 text-sm">
            <span className="text-xs font-semibold text-muted-text">Manager's stated reason: </span>
            {m.reason}
          </p>
        )}
        {m.source === "default" && (
          <p className="mt-1 text-xs text-muted-text">No decision by the deadline: the league's default applied.</p>
        )}
      </div>
      {m.wagePerSeason != null && (
        <p className="tabular text-right text-sm">
          <span className="block font-semibold">{credits(m.wagePerSeason)} a season</span>
          <span className="text-xs text-muted-text">
            {m.years} year{m.years === 1 ? "" : "s"}
            {m.fee ? ` · fee ${credits(m.fee)}` : ""}
          </span>
        </p>
      )}
    </li>
  );
}

/**
 * A season's player market (market/1): each window with its signings, renewals and releases, the
 * safety net, and the lender's forced auctions. Official outcomes only: offers that didn't sign and
 * sealed auction bids are never shown.
 */
export function SeasonMarket({ data }: { data: SeasonMarketResponse }) {
  const net = data.moves.filter((m) => m.type === "safety-net");
  if (!data.windows.length && !data.auctions.length)
    return (
      <EmptyState title="No player market this season">
        This season ran before contracts and free agency (transfer/2). Its deals are on the transfers page.
      </EmptyState>
    );
  return (
    <div className="space-y-6" data-testid="season-market">
      <ol className="grid gap-4">
        {data.windows.map((w) => {
          const moves = data.moves.filter((m) => m.window?.kind === w.kind && m.window.round === w.round);
          const signedCount = moves.filter((m) => m.type === "recruited" || m.type === "signed").length;
          return (
            <li key={`${w.kind}-${w.round}`} className="card-surface p-4">
              <section aria-labelledby={`w-${w.kind}-${w.round}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`w-${w.kind}-${w.round}`} className="font-semi text-xl font-bold">
                    {WINDOW_TITLE(w)}
                  </h2>
                  <p className="text-xs text-muted-text">
                    <span className="font-semibold">{PHASE[w.phase]}</span> · deadline{" "}
                    <time dateTime={w.deadline}>{time(w.deadline)}</time>
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted-text">{WINDOW_NOTE[w.kind]}</p>
                {w.phase !== "closed" ? (
                  <p className="mt-3 text-sm">
                    Offers are sealed until the deadline. Results appear here once it settles.
                  </p>
                ) : moves.length ? (
                  <>
                    <p className="mt-3 text-sm font-semibold">
                      {signedCount} signing{signedCount === 1 ? "" : "s"}
                      {moves.length > signedCount ? `, ${moves.length - signedCount} contract decisions` : ""}
                    </p>
                    <ul className="divide-y divide-line">
                      {moves.map((m) => (
                        <Move key={`${m.type}-${m.player.id}`} m={m} />
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-muted-text">Nobody moved in this window.</p>
                )}
              </section>
            </li>
          );
        })}
      </ol>
      {net.length > 0 && (
        <section className="card-surface p-4" aria-labelledby="safety-net">
          <h2 id="safety-net" className="font-semi text-xl font-bold">
            The safety net
          </h2>
          <p className="mt-1 text-sm text-muted-text">
            After the last recruitment round, a club still short of a playable squad was assigned the best remaining
            players at minimum terms, and paid the league's stated fee for each. Assigned, not chosen.
          </p>
          <ul className="divide-y divide-line">
            {net.map((m) => (
              <Move key={m.player.id} m={m} />
            ))}
          </ul>
        </section>
      )}
      {data.auctions.length > 0 && (
        <section className="card-surface p-4" aria-labelledby="auctions">
          <h2 id="auctions" className="font-semi text-xl font-bold">
            The lender's forced auctions
          </h2>
          <p className="mt-1 text-sm text-muted-text">
            A club that defaulted had players auctioned to pay its lender. Every other club could bid once, sealed; only
            the winning price is public.
          </p>
          <ul className="divide-y divide-line">
            {data.auctions.map((a) => (
              <li
                key={`${a.round}-${a.player.id}`}
                className="flex flex-wrap items-center gap-3 py-2"
                data-testid="market-auction"
              >
                <TeamBadge team={a.seller} size="sm" decorative />
                <p className="min-w-0 flex-1">
                  <Link to={playerHref(a.player)} className="font-semibold underline-offset-4 hover:underline">
                    {a.player.name}
                  </Link>{" "}
                  <span className="text-muted-text">
                    {a.player.position} · round {a.round} · from {a.seller.name}{" "}
                    {a.buyer ? `to ${a.buyer.name}` : "(no bid met the reserve)"} · {a.bidders} sealed bid
                    {a.bidders === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="tabular text-right font-semibold">{a.amount == null ? "Unsold" : credits(a.amount)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-muted-text">
        Official outcomes only ({data.rule ?? "transfer/2"}): signed contracts and their terms, renewals, releases and
        auction results. Offers that didn't sign, and what each club bid at auction, stay private. Reasons are the AI
        managers' own words, recorded with their decisions.
      </p>
    </div>
  );
}
