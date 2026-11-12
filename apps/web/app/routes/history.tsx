import type { SeasonListResponse, SeasonSummary } from "@autosoccer/contracts";
import { Link } from "react-router";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { TeamBadge } from "../components/TeamBadge";
import { apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/history";

export async function loader() {
  return apiOr404<SeasonListResponse>("/api/v1/seasons");
}

export const meta: Route.MetaFunction = () =>
  seo("History", "Every Auto Soccer season: champions, runners-up, top scorers and final tables.");

const fmtPts = (n: number) => `${n} pt${n === 1 ? "" : "s"}`;

/** "Max Ruiz (Red Rock Rovers) and Abel Novak (Saltmarsh Athletic), 4 goals each". */
export function scorersLine(s: SeasonSummary["topScorers"]): string {
  if (!s.length) return "No goals yet";
  const names = s.map((p) => `${p.name} (${p.team.name})`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
  const g = s[0]!.goals;
  return `${list}, ${g} goal${g === 1 ? "" : "s"}${s.length > 1 ? " each" : ""}`;
}

export function SeasonCard({ s }: { s: SeasonSummary }) {
  const done = s.season.status === "completed";
  const leader = s.leader;
  return (
    <li className="card-surface grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
      {leader ? <TeamBadge team={leader.team} size="lg" decorative /> : <span aria-hidden className="h-16 w-16" />}
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-text">
          {s.season.name} · {s.season.playersPerTeam}-a-side ·{" "}
          {done ? "completed" : s.roundsPlayed ? `after round ${s.roundsPlayed} of ${s.rounds}` : "not started"}
        </p>
        <h2 className="font-display text-3xl font-extrabold uppercase italic leading-none">
          {leader ? (done ? `${leader.team.name}, champions` : `${leader.team.name} lead`) : "Kick-off to come"}
        </h2>
        {leader && (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold">{done ? "Title won" : "Top"}: </dt>
              <dd className="tabular inline">
                {fmtPts(leader.points)}
                {s.margin !== null && s.runnerUp
                  ? s.margin === 0
                    ? `, level on points with ${s.runnerUp.team.name} (ahead on tie-breaks)`
                    : `, ${fmtPts(s.margin)} clear of ${s.runnerUp.team.name}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Top scorer: </dt>
              <dd className="inline">{scorersLine(s.topScorers)}</dd>
            </div>
            {done && s.decidedAfterRound && (
              <div>
                <dt className="inline font-semibold">Decided: </dt>
                <dd className="inline">
                  {s.decidedAfterRound < s.rounds
                    ? `after round ${s.decidedAfterRound}, with ${s.rounds - s.decidedAfterRound} round${s.rounds - s.decidedAfterRound === 1 ? "" : "s"} to spare`
                    : "on the final day"}
                </dd>
              </div>
            )}
            <div>
              <dt className="inline font-semibold">Goals per match: </dt>
              <dd className="tabular inline">{s.goalsPerMatch.toFixed(2)}</dd>
            </div>
          </dl>
        )}
        <p className="flex flex-wrap gap-x-4 text-sm font-semibold">
          <Link to={`/table?season=${s.season.slug}`} className="underline underline-offset-4 hover:text-violet-deep">
            {done ? "Final table" : "Table"}
          </Link>
          <Link
            to={`/fixtures?season=${s.season.slug}`}
            className="underline underline-offset-4 hover:text-violet-deep"
          >
            Results
          </Link>
        </p>
      </div>
    </li>
  );
}

export default function History({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  const titles = new Map<string, { name: string; n: number }>();
  for (const s of items)
    if (s.season.status === "completed" && s.leader) {
      const t = titles.get(s.leader.team.id) ?? { name: s.leader.team.name, n: 0 };
      titles.set(s.leader.team.id, { ...t, n: t.n + 1 });
    }
  const honours = [...titles.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SectionHeader as="h1" banner eyebrow="Roll of honour" title="History" />
      {honours.length > 0 && (
        <p className="text-sm">
          <span className="font-semibold">Titles: </span>
          {honours.map((h) => `${h.name} ${h.n}`).join(" · ")}
        </p>
      )}
      {!items.length ? (
        <EmptyState title="No seasons yet" />
      ) : (
        <ol className="grid gap-4" aria-label="Seasons, newest first">
          {items.map((s) => (
            <SeasonCard key={s.season.id} s={s} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="History" />;
}
