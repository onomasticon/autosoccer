import type { ScorerRow } from "@autosoccer/contracts";
import { Link } from "react-router";
import { TeamBadge } from "./TeamBadge";

/** Goals per player, most first (own goals don't count). Ties share a rank. */
export function ScorersTable({ rows, caption }: { rows: ScorerRow[]; caption: string }) {
  if (!rows.length) return <p className="text-sm text-muted-text">No goals yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-text">
            <th scope="col" className="px-2 py-2 font-semibold">
              #
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Player
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              <abbr title="Matches started">MP</abbr>
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              Goals
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.playerId} className="border-t border-line">
              <td className="tabular px-2 py-2 text-muted-text">
                {i > 0 && rows[i - 1]!.rank === r.rank ? "=" : r.rank}
              </td>
              <td className="px-2 py-2">
                <span className="flex items-center gap-2">
                  <TeamBadge team={r.team} size="sm" decorative />
                  <span className="font-semibold">{r.name}</span>
                  <Link to={`/teams/${r.team.slug}`} className="text-muted-text underline-offset-4 hover:underline">
                    {r.team.shortName}
                  </Link>
                </span>
              </td>
              <td className="tabular px-2 py-2 text-right text-muted-text">{r.matches}</td>
              <td className="tabular px-2 py-2 text-right font-display text-lg font-extrabold">{r.goals}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
