import type { StandingRow } from "@autosoccer/contracts";
import { Link } from "react-router";
import { EmptyState, Loading, Skeleton } from "./States";
import { TeamBadge } from "./TeamBadge";

const FORM_STYLE = { W: "bg-violet text-white", D: "bg-line text-ink", L: "bg-coral text-ink" } as const;
const FORM_WORD = { W: "won", D: "drew", L: "lost" } as const;

export function FormGuide({ form }: { form: StandingRow["form"] }) {
  if (!form.length) return <span className="text-muted-text">–</span>;
  return (
    <span
      role="img"
      className="inline-flex gap-1"
      aria-label={`Last ${form.length}: ${form.map((f) => FORM_WORD[f]).join(", ")}`}
    >
      {form.map((f, i) => (
        <span
          key={i}
          aria-hidden
          className={`inline-flex size-5 items-center justify-center rounded text-[11px] font-bold ${FORM_STYLE[f]}`}
        >
          {f}
        </span>
      ))}
    </span>
  );
}

export interface StandingsTableProps {
  rows: StandingRow[] | null;
  caption: string;
  /** Homepage variant: P, GD, Pts only. */
  compact?: boolean;
  loading?: boolean;
  highlightTeamId?: string;
  /** Render without its own card (inside a Panel). */
  bare?: boolean;
}

export function StandingsTable({
  rows,
  caption,
  compact = false,
  loading = false,
  highlightTeamId,
  bare = false,
}: StandingsTableProps) {
  if (loading)
    return (
      <Loading label="Loading table">
        <div className="card-surface space-y-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </Loading>
    );
  if (!rows?.length) return <EmptyState title="No table yet">Standings appear after the first results.</EmptyState>;
  const num = "tabular px-2 py-2.5 text-right";
  const wdl = "hidden sm:table-cell";
  return (
    <div className={`${bare ? "" : "card-surface"} relative overflow-x-auto`} data-testid="standings-table">
      <table className="w-full min-w-[18rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wider text-muted-text">
            <th scope="col" className="w-10 px-3 py-2 text-right">
              <abbr title="Position">#</abbr>
            </th>
            <th scope="col" className="px-2 py-2">
              Team
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              <abbr title="Played">P</abbr>
            </th>
            <th scope="col" className={`${wdl} px-2 py-2 text-right`}>
              <abbr title="Won">W</abbr>
            </th>
            <th scope="col" className={`${wdl} px-2 py-2 text-right`}>
              <abbr title="Drawn">D</abbr>
            </th>
            <th scope="col" className={`${wdl} px-2 py-2 text-right`}>
              <abbr title="Lost">L</abbr>
            </th>
            {!compact && (
              <>
                <th scope="col" className="hidden px-2 py-2 text-right md:table-cell">
                  <abbr title="Goals for">GF</abbr>
                </th>
                <th scope="col" className="hidden px-2 py-2 text-right md:table-cell">
                  <abbr title="Goals against">GA</abbr>
                </th>
              </>
            )}
            <th scope="col" className="px-2 py-2 text-right">
              <abbr title="Goal difference">GD</abbr>
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              <abbr title="Points">Pts</abbr>
            </th>
            {!compact && (
              <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                Form
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const leader = r.position === 1 && r.played > 0;
            const mine = r.team.id === highlightTeamId;
            return (
              <tr
                key={r.team.id}
                className={`border-b border-line last:border-0 ${leader ? "bg-yellow/45" : ""} ${mine ? "outline-2 -outline-offset-2 outline-violet" : ""}`}
                aria-current={mine ? "true" : undefined}
              >
                <td className="tabular px-3 py-2.5 text-right font-bold">
                  {r.position}
                  {leader && <span className="sr-only"> (leader)</span>}
                </td>
                <th scope="row" className="px-2 py-2 text-left font-semibold">
                  <Link to={`/teams/${r.team.slug}`} className="flex items-center gap-2 hover:underline">
                    <TeamBadge team={r.team} size="sm" decorative />
                    <span className={`truncate ${compact ? "font-display text-lg font-bold" : ""}`}>{r.team.name}</span>
                    {leader && !compact && (
                      <span aria-hidden className="rounded bg-yellow px-1 text-[10px] font-bold uppercase text-ink">
                        Top
                      </span>
                    )}
                  </Link>
                </th>
                <td className={num}>{r.played}</td>
                <td className={`${num} ${wdl}`}>{r.won}</td>
                <td className={`${num} ${wdl}`}>{r.drawn}</td>
                <td className={`${num} ${wdl}`}>{r.lost}</td>
                {!compact && (
                  <>
                    <td className={`${num} hidden md:table-cell`}>{r.goalsFor}</td>
                    <td className={`${num} hidden md:table-cell`}>{r.goalsAgainst}</td>
                  </>
                )}
                <td className={num}>{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
                <td className="tabular px-3 py-2.5 text-right font-display text-lg font-extrabold">{r.points}</td>
                {!compact && (
                  <td className="hidden px-3 py-2 lg:table-cell">
                    <FormGuide form={r.form} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
