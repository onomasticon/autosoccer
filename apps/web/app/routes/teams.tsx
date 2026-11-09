import type { StandingsResponse, TeamListResponse } from "@autosoccer/contracts";
import { Link } from "react-router";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { FormGuide } from "../components/StandingsTable";
import { EmptyState } from "../components/States";
import { TeamBadge } from "../components/TeamBadge";
import { apiMaybe, apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/teams";

export async function loader() {
  const teams = await apiOr404<TeamListResponse>("/api/v1/teams");
  const season = await apiMaybe<{ season: { slug: string } }>("/api/v1/seasons/current");
  const standings = season
    ? await apiMaybe<StandingsResponse>(`/api/v1/seasons/${season.season.slug}/standings`)
    : null;
  return { teams: teams.items, standings: standings?.rows ?? [] };
}

export const meta: Route.MetaFunction = () =>
  seo("Teams", "The four clubs of the league, each run by a persistent AI manager.");

export default function Teams({ loaderData }: Route.ComponentProps) {
  const { teams, standings } = loaderData;
  return (
    <div className="space-y-6">
      <SectionHeader as="h1" banner eyebrow="Four clubs" title="Teams" />
      {!teams.length ? (
        <EmptyState title="No clubs yet" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {teams.map((t) => {
            const row = standings.find((r) => r.team.id === t.id);
            return (
              <li key={t.id}>
                <Link
                  to={`/teams/${t.slug}`}
                  className="card-surface flex flex-col items-center gap-3 p-6 text-center hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <TeamBadge team={t} size="lg" decorative />
                  <span className="font-display text-2xl font-extrabold uppercase italic leading-none">{t.name}</span>
                  <span className="text-sm text-muted-text">{t.city}</span>
                  {row && (
                    <span className="flex flex-col items-center gap-2 text-sm">
                      <span className="tabular font-semibold">
                        {ordinal(row.position)} · {row.points} pts
                      </span>
                      <FormGuide form={row.form} />
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ordinal(n: number) {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

export function ErrorBoundary() {
  return <RouteError what="Teams" />;
}
