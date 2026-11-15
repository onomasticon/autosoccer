import type { ChapterRef, ManagerProfile } from "@autosoccer/contracts";
import { Link } from "react-router";

const NEXT_STATUS: Record<string, string> = {
  pending: "decision still to come before kick-off",
  new: "a new setup is ready",
  kept: "the same setup again",
  opening: "the club's pre-season plan",
  skipped_budget: "no decision: the season's compute budget is spent",
  failed: "the decision run failed; the last valid setup will play",
  rejected: "the proposal failed validation; the last valid setup will play",
};

/** "S5 R3 v Harbour City (L 0–2)", linking to the match. */
function MatchRef({ r }: { r: ChapterRef }) {
  const text = `${r.season.name.replace(/^Season /, "S")} R${r.round} ${r.venue === "home" ? "v" : "at"} ${r.opponent.name}${
    r.score ? ` (${r.outcome} ${r.score.for}–${r.score.against})` : ""
  }`;
  return r.matchId ? (
    <Link to={`/matches/${r.matchId}`} className="font-semibold text-violet-deep underline-offset-4 hover:underline">
      {text}
    </Link>
  ) : (
    <span>{text}</span>
  );
}

const Kind = ({ children }: { children: string }) => (
  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-text">{children}</span>
);

/**
 * A manager's story across seasons (manager-profile/1): patterns derived from their recorded
 * decisions (each with the matches that show it), notable decisions with what came before and after,
 * and where things stand now. Three kinds of information, kept visibly apart: the record, patterns
 * derived from it by a fixed rule, and the manager's own (AI-written, unverified) words.
 */
export function ManagerArc({ profile, compact = false }: { profile: ManagerProfile; compact?: boolean }) {
  const { counts, traits, notable, current, manager } = profile;
  const span =
    profile.seasons.length > 1
      ? `${profile.seasons[0]!.name} to ${profile.seasons.at(-1)!.name}`
      : (profile.seasons[0]?.name ?? "this season");
  const notDecided = [
    counts.opening && `${counts.opening} on the pre-season plan`,
    counts.skippedBudget && `${counts.skippedBudget} with no decision (budget spent)`,
    counts.failedOrRejected && `${counts.failedOrRejected} where the decision run failed`,
  ].filter(Boolean);
  return (
    <div className="card-surface space-y-4 p-4 sm:p-5" data-testid="manager-arc">
      <div>
        <p className="text-sm">
          <strong>{manager?.name ?? "No manager"}</strong> · {counts.decisions} decision
          {counts.decisions === 1 ? "" : "s"} in {counts.matches} match{counts.matches === 1 ? "" : "es"}, {span} ·
          record {counts.record.W}W {counts.record.D}D {counts.record.L}L
        </p>
        {notDecided.length > 0 && (
          <p className="text-xs text-muted-text">Not counted as decisions: {notDecided.join(", ")}.</p>
        )}
      </div>

      <div>
        <Kind>Patterns in the record</Kind>
        {profile.verdict === "too_early" ? (
          <p className="mt-1 text-sm text-muted-text" data-testid="too-early">
            Too early to say: {counts.decisions} decision{counts.decisions === 1 ? "" : "s"} on record so far. Patterns
            appear after three.
          </p>
        ) : traits.length ? (
          <ul className="mt-1 space-y-2">
            {traits.slice(0, compact ? 2 : traits.length).map((t) => (
              <li key={t.key} className="text-sm">
                <span className="mr-2 inline-block rounded-md bg-lavender px-2 py-0.5 font-display font-extrabold uppercase italic text-violet-deep">
                  {t.label}
                </span>
                {t.basis}
                {!compact && (
                  <span className="mt-0.5 block text-xs text-muted-text">
                    Shown in:{" "}
                    {t.evidence.map((e, i) => (
                      <span key={e.fixtureId}>
                        {i > 0 && ", "}
                        <MatchRef r={e} />
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-text">
            No strong pattern yet: changed the setup in {counts.changed} of {counts.decisions} decisions,{" "}
            {counts.afterDefeat.changed} of {counts.afterDefeat.decisions} after a defeat.
          </p>
        )}
      </div>

      {!compact && notable.length > 0 && (
        <div>
          <Kind>Notable decisions</Kind>
          <ol className="mt-1 space-y-3">
            {notable.map((d) => (
              <li key={d.at.fixtureId} className="text-sm">
                <p>
                  <MatchRef r={d.at} />: {d.summary}
                  {d.at.revisionVersion ? ` (revision v${d.at.revisionVersion})` : ""}.
                  {d.before && (
                    <span className="text-muted-text">
                      {" "}
                      Coming off <MatchRef r={d.before} />.
                    </span>
                  )}
                </p>
                {d.rationale && (
                  <p className="mt-1 rounded-lg bg-lavender/60 px-2 py-1 text-xs">
                    <span className="font-semibold">Manager's stated reason</span> (AI-written, unverified):{" "}
                    {d.rationale}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="text-sm">
          <Kind>Latest setup</Kind>
          <p className="mt-1">{current.summary}</p>
          {current.next && (
            <p className="mt-1 text-xs text-muted-text">
              Next: R{current.next.round} v {current.next.opponent.name} · {NEXT_STATUS[current.next.status]}
            </p>
          )}
        </div>
        <div className="text-sm">
          <Kind>Latest lesson</Kind>
          {current.lesson ? (
            <p className="mt-1 rounded-lg bg-lavender/60 px-2 py-1">
              {current.lesson}
              <span className="block text-xs text-muted-text">
                Manager's reflection after {current.lessonAt ? <MatchRef r={current.lessonAt} /> : "a match"}:
                AI-written, not fact-checked.
              </span>
            </p>
          ) : (
            <p className="mt-1 text-muted-text">No post-match review on record yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
