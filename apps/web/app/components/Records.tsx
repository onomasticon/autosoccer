import type { RecordsResponse } from "@autosoccer/contracts";
import { Link } from "react-router";

const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join("; ")}; and ${xs.at(-1)}` : (xs[0] ?? ""));

/** League records across completed seasons, one line each; ties are listed together. */
export function Records({ records }: { records: RecordsResponse }) {
  const items: Array<{ label: string; value: React.ReactNode }> = [];
  if (records.mostPoints.length)
    items.push({
      label: "Most points in a season",
      value: `${records.mostPoints[0]!.points}: ${join(records.mostPoints.map((r) => `${r.team.name} (${r.season.name})`))}`,
    });
  items.push({
    label: "Perfect seasons",
    value: records.perfectSeasons.length
      ? join(records.perfectSeasons.map((r) => `${r.team.name}, ${r.season.name} (won all ${r.won})`))
      : "None yet: nobody has won every match",
  });
  if (records.mostGoalsInSeason.length)
    items.push({
      label: "Most goals in a season",
      value: `${records.mostGoalsInSeason[0]!.goals}: ${join(records.mostGoalsInSeason.map((r) => `${r.name}, ${r.team.name} (${r.season.name})`))}`,
    });
  if (records.biggestWin.length)
    items.push({
      label: "Biggest win",
      value: (
        <>
          {records.biggestWin.map((w, i) => (
            <span key={w.matchId}>
              {i > 0 && "; "}
              <Link to={`/matches/${w.matchId}`} className="underline underline-offset-4 hover:text-violet-deep">
                {w.winner.name} over {w.loser.name}, {w.score}
              </Link>{" "}
              ({w.season.name}, round {w.round})
            </span>
          ))}
        </>
      ),
    });
  if (!records.mostPoints.length) return null;
  return (
    <dl className="card-surface grid gap-3 p-5 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-6">
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="font-semibold">{it.label}</dt>
          <dd className="tabular">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
