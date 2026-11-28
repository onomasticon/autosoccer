import type { LeagueFounding as Founding } from "@autosoccer/contracts";
import { Link } from "react-router";
import { TeamBadge } from "./TeamBadge";

const STATUS = {
  founded: "Founded a club",
  awaiting: "No accepted charter after three rounds",
  invited: "Still founding",
} as const;

/**
 * How a league began (inaugural/1): every founder model by its exact identity, the club it founded,
 * and the recruitment that built the squads. Declared identities live on each club's page (its
 * charter); this lists only recorded facts, never prompts or rejected charters.
 */
export function LeagueFounding({ founding: f, marketHref }: { founding: Founding; marketHref: string | null }) {
  const founded = f.founders.filter((x) => x.status === "founded");
  const rehearsal = f.founders.some((x) => x.live === false);
  return (
    <section className="card-surface space-y-4 p-4" aria-labelledby="founding" data-testid="league-founding">
      <div>
        <h2 id="founding" className="font-semi text-xl font-bold">
          How this league began
        </h2>
        <p className="mt-1 text-sm text-muted-text">
          {f.founders.length} AI models were invited to found a club each, from the same rules and the same money, on{" "}
          <time dateTime={f.opensAt}>
            {new Date(f.opensAt).toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" })}
          </time>
          . Each chose its club's name, town, colours, culture and way of playing, and now runs it as owner and manager.{" "}
          {founded.length} club{founded.length === 1 ? " was" : "s were"} founded.
        </p>
        {rehearsal && (
          <p className="mt-2 text-sm" role="note">
            <span className="font-semibold">Rehearsal data.</span> Some charters here came from the league's offline
            stand-in, not the named model.
          </p>
        )}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {f.founders.map((x) => (
          <li key={x.model.slug} className="flex items-start gap-3 rounded-lg border border-line p-3">
            {x.team ? <TeamBadge team={x.team} size="sm" decorative /> : <span aria-hidden className="size-8" />}
            <div className="min-w-0 text-sm">
              {x.team ? (
                <Link to={`/teams/${x.team.slug}`} className="font-semibold underline-offset-4 hover:underline">
                  {x.team.name}
                </Link>
              ) : (
                <span className="font-semibold">{STATUS[x.status]}</span>
              )}
              <p className="break-words text-muted-text">
                Founded and managed by <code className="text-xs">{x.model.apiModelId}</code> ({x.model.provider})
                {x.model.route === "openrouter" && x.model.host ? `, served by ${x.model.host}` : ""}
              </p>
              <p className="text-xs text-muted-text">
                {x.team
                  ? `Charter accepted in round ${x.rounds} of 3${x.live === false ? " · offline stand-in" : ""}`
                  : `${x.rounds} round${x.rounds === 1 ? "" : "s"} tried`}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {f.recruitment && (
        <p className="text-sm">
          <span className="font-semibold">Recruitment:</span> {f.recruitment.rounds} simultaneous offer round
          {f.recruitment.rounds === 1 ? "" : "s"} for a shared pool of new players, {f.recruitment.recruited} signings
          {f.recruitment.safetyNet
            ? `, then ${f.recruitment.safetyNet} player${f.recruitment.safetyNet === 1 ? "" : "s"} assigned by the safety net`
            : ""}
          .{" "}
          {marketHref && (
            <Link to={marketHref} className="font-semibold underline underline-offset-4 hover:text-violet-deep">
              Every signing
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
