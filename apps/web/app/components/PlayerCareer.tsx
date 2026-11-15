import type { PlayerCareer as Career } from "@autosoccer/contracts";
import { Link } from "react-router";
import { ATTRIBUTE_LABELS } from "./PlayerRatings";

const label = (a: string) => ATTRIBUTE_LABELS.find(([n]) => n === a)?.[1] ?? a;

/**
 * One player's career (player-careers/1): the record (starts and goals per season, and recent
 * form) and the derived ratings (overall per season, and what the development rule changed).
 */
export function PlayerCareer({ career }: { career: Career }) {
  const latest = career.seasons.at(-1);
  const changed = latest?.source === "snapshot" ? latest.changes : [];
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm" data-testid="player-career">
      {career.form.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-text">
            {career.form.length === 1 ? "Last match" : `Last ${career.form.length} matches`}
          </p>
          <ol className="mt-1 flex flex-wrap gap-1.5" aria-label="Recent matches, oldest first">
            {career.form.map((m) => (
              <li key={m.matchId}>
                <Link
                  to={`/matches/${m.matchId}`}
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold ${m.started ? "bg-violet text-white" : "border border-line text-muted-text"}`}
                >
                  R{m.round} {m.started ? "started" : "didn't start"}
                  {m.goals > 0 && ` · ${m.goals} goal${m.goals === 1 ? "" : "s"}`}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
      <table className="w-full text-xs">
        <caption className="sr-only">{career.name}: season by season</caption>
        <thead className="text-left text-muted-text">
          <tr>
            <th scope="col" className="py-1 font-semibold">
              Season
            </th>
            <th scope="col" className="py-1 text-right font-semibold">
              Overall
            </th>
            <th scope="col" className="py-1 text-right font-semibold">
              Starts
            </th>
            <th scope="col" className="py-1 text-right font-semibold">
              Goals
            </th>
          </tr>
        </thead>
        <tbody className="tabular">
          {career.seasons.map((s) => (
            <tr key={s.season.slug} className="border-t border-line">
              <th scope="row" className="py-1 text-left font-medium">
                {s.season.name}
                {s.source === "baseline" && <span className="ml-1 text-muted-text">(baseline)</span>}
              </th>
              <td className="py-1 text-right font-semibold">{s.overall}</td>
              <td className="py-1 text-right">
                {s.starts}/{s.teamMatches}
              </td>
              <td className="py-1 text-right">{s.goals}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {changed.length > 0 && (
        <p className="text-xs">
          <span className="font-semibold">Since last season:</span>{" "}
          {changed
            .map((c) => `${label(c.attribute)} ${c.delta > 0 ? "+" : ""}${c.delta} (${c.reasons.join(", ")})`)
            .join("; ")}
          .
        </p>
      )}
      <p className="text-xs text-muted-text">
        Starts and goals are from the official record. Ratings are derived: a fixed baseline, then one small, rule-based
        step a season from playing time and goals.
      </p>
    </div>
  );
}
