import { type BidStatus, playerHref, type TransferBid, type TransferWindowResponse } from "@autosoccer/contracts";
import { Link } from "react-router";
import { credits } from "./ClubFinances";
import { TeamBadge } from "./TeamBadge";

export const STATUS_LABEL: Record<BidStatus, string> = {
  completed: "Deal done",
  accepted: "Agreed, settles at the deadline",
  pending: "Awaiting a reply",
  rejected: "Refused",
  outbid: "Outbid",
  failed: "Fell through",
  lapsed: "No reply: player stays",
};

const PHASE_LABEL = {
  listing: "Clubs are listing players",
  bidding: "Clubs are bidding",
  replying: "Sellers are deciding",
  closed: "Closed",
} as const;

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

function Deal({ b }: { b: TransferBid }) {
  return (
    <li className="card-surface space-y-3 p-4" data-testid="transfer-deal">
      <div className="flex flex-wrap items-center gap-3">
        <TeamBadge team={b.seller} size="sm" decorative />
        <span aria-hidden className="text-muted-text">
          →
        </span>
        <TeamBadge team={b.buyer} size="sm" decorative />
        <p className="min-w-0 flex-1">
          <Link
            to={playerHref(b.player)}
            className="font-display text-xl font-bold uppercase italic hover:text-violet-deep"
          >
            {b.player.name}
          </Link>
          <span className="block text-sm text-muted-text">
            {b.player.position} · overall {b.player.overall} · from{" "}
            <Link to={`/teams/${b.seller.slug}`} className="underline underline-offset-4">
              {b.seller.name}
            </Link>{" "}
            to{" "}
            <Link to={`/teams/${b.buyer.slug}`} className="underline underline-offset-4">
              {b.buyer.name}
            </Link>
          </span>
        </p>
        <p className="tabular text-right">
          <span className="block font-display text-2xl font-extrabold">{credits(b.fee)}</span>
          <span className="text-xs text-muted-text">wage {credits(b.wage)} a round</span>
        </p>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Why {b.buyer.name} bid</dt>
          <dd>{b.buyerReason}</dd>
        </div>
        <div>
          <dt className="font-semibold">Why {b.seller.name} sold</dt>
          <dd>{b.sellerReason ?? "–"}</dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * The transfer window (transfer-window/1): phase and deadline, completed deals with both managers'
 * reasons, every other bid and how it ended, and the players clubs invited offers for.
 */
export function TransferWindow({ data }: { data: TransferWindowResponse }) {
  const w = data.window;
  if (!w)
    return (
      <p className="card-surface p-4 text-sm text-muted-text" data-testid="transfer-window">
        No transfer window yet. The first one opens between seasons once clubs have played a season with club finances.
      </p>
    );
  const deals = data.bids.filter((b) => b.status === "completed");
  const others = data.bids.filter((b) => b.status !== "completed");
  return (
    <div className="space-y-6" data-testid="transfer-window">
      <p className="card-surface p-4 text-sm">
        <span className="font-semibold">
          Before {w.season.name}: {PHASE_LABEL[w.phase]}.
        </span>{" "}
        {w.phase === "closed" && w.closedAt
          ? `Closed ${time(w.closedAt)}.`
          : `Deadline ${time(w.deadline)}; whatever isn't agreed by then lapses, and the season starts on time.`}
      </p>
      <section aria-labelledby="deals" className="space-y-3">
        <h2 id="deals" className="font-display text-2xl font-extrabold uppercase italic">
          Deals
        </h2>
        {deals.length ? (
          <ul className="space-y-3">
            {deals.map((b) => (
              <Deal key={b.id} b={b} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-text">
            {w.phase === "closed" ? "No player changed clubs." : "No deals yet."}
          </p>
        )}
      </section>
      {others.length > 0 && (
        <section aria-labelledby="bids" className="space-y-3">
          <h2 id="bids" className="font-display text-2xl font-extrabold uppercase italic">
            Other bids
          </h2>
          <ul className="card-surface divide-y divide-line">
            {others.map((b) => (
              <li key={b.id} className="grid gap-1 p-4 text-sm sm:grid-cols-[1fr_auto]" data-testid="transfer-bid">
                <p>
                  <span className="font-semibold">{b.buyer.name}</span> bid {credits(b.fee)} for{" "}
                  <Link to={playerHref(b.player)} className="font-semibold underline underline-offset-4">
                    {b.player.name}
                  </Link>{" "}
                  ({b.seller.name}, {b.player.position}, overall {b.player.overall})
                  <span className="block text-muted-text">
                    {b.sellerReason ?? b.buyerReason}
                    {b.outcome ? ` (${b.outcome})` : ""}
                  </span>
                </p>
                <p className="font-semibold sm:text-right">{STATUS_LABEL[b.status]}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.listings.length > 0 && (
        <section aria-labelledby="listed" className="space-y-3">
          <h2 id="listed" className="font-display text-2xl font-extrabold uppercase italic">
            Invited offers
          </h2>
          <ul className="card-surface divide-y divide-line">
            {data.listings.map((l) => (
              <li key={l.player.id} className="p-4 text-sm">
                <span className="font-semibold">{l.team.name}</span> listed{" "}
                <Link to={playerHref(l.player)} className="font-semibold underline underline-offset-4">
                  {l.player.name}
                </Link>
                {l.askingFee ? ` at ${credits(l.askingFee)}` : ""}: {l.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-muted-text">
        How the window works ({w.rule}): clubs list players they would sell, then bid (up to {data.rules.maxBids} each,
        never more than their cash), then each seller accepts at most one offer per player, or keeps the player. A
        seller can refuse any offer. Deals settle together at the deadline: the fee moves between the clubs, the player
        is registered with the new club for the season and paid from its wage bill. Every squad keeps at least{" "}
        {data.rules.minSquad} players and a goalkeeper, and at most {data.rules.maxSquad}. A club whose manager doesn't
        answer keeps its players. Fees are fictional credits.
      </p>
    </div>
  );
}
