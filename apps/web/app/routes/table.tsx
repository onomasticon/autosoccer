import type { SeasonResponse, StandingsResponse } from "@autosoccer/contracts";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { StandingsTable } from "../components/StandingsTable";
import { apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/table";

export async function loader() {
  const { season } = await apiOr404<SeasonResponse>("/api/v1/seasons/current");
  return apiOr404<StandingsResponse>(`/api/v1/seasons/${season.slug}/standings`);
}

export const meta: Route.MetaFunction = ({ data }) =>
  seo(data ? `${data.season.name} table` : "Table", "The official league table: points, goal difference and form.");

export default function Table({ loaderData }: Route.ComponentProps) {
  const { season, rows, afterRound } = loaderData;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <SectionHeader
        as="h1"
        banner
        eyebrow={afterRound ? `${season.name} · after round ${afterRound}` : season.name}
        title="League table"
      />
      <StandingsTable
        rows={rows}
        caption={`${season.name} league table${afterRound ? ` after round ${afterRound}` : ""}`}
      />
      <p className="text-sm text-muted-text">
        Three points for a win, one for a draw. Ties are split by goal difference, then goals scored, then the
        head-to-head record between the tied clubs.
      </p>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Table" />;
}
