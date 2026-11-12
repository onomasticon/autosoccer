import type { ScorersResponse, StandingsResponse } from "@autosoccer/contracts";
import { Link } from "react-router";
import { RouteError } from "../components/RouteError";
import { ScorersTable } from "../components/ScorersTable";
import { SectionHeader } from "../components/SectionHeader";
import { StandingsTable } from "../components/StandingsTable";
import { TitleRaceLine } from "../components/TitleRace";
import { apiMaybe, apiOr404, holdersBefore, seasonSlugFrom } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/table";

export async function loader({ request }: Route.LoaderArgs) {
  const slug = await seasonSlugFrom(request);
  const [standings, scorers, holders] = await Promise.all([
    apiOr404<StandingsResponse>(`/api/v1/seasons/${slug}/standings`),
    apiMaybe<ScorersResponse>(`/api/v1/seasons/${slug}/scorers`),
    holdersBefore(slug),
  ]);
  return { ...standings, scorers: scorers?.items ?? [], holders };
}

export const meta: Route.MetaFunction = ({ data }) =>
  seo(data ? `${data.season.name} table` : "Table", "The official league table: points, goal difference and form.");

export default function Table({ loaderData }: Route.ComponentProps) {
  const { season, rows, afterRound, race, scorers, holders } = loaderData;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <SectionHeader
        as="h1"
        banner
        eyebrow={
          season.status === "completed"
            ? `${season.name} · final`
            : afterRound
              ? `${season.name} · after round ${afterRound}`
              : season.name
        }
        title="League table"
      />
      <p className="text-sm">
        <Link to="/history" className="font-semibold underline underline-offset-4 hover:text-violet-deep">
          Past seasons and champions
        </Link>
      </p>
      <TitleRaceLine race={race} afterRound={afterRound} seasonCompleted={season.status === "completed"} />
      <StandingsTable
        holdersTeamId={holders}
        rows={rows}
        caption={`${season.name} league table${afterRound ? ` after round ${afterRound}` : ""}`}
      />
      <p className="text-sm text-muted-text">
        Three points for a win, one for a draw. Ties are split by goal difference, then goals scored, then the
        head-to-head record between the tied clubs.
      </p>
      <section aria-labelledby="scorers" className="space-y-3">
        <SectionHeader id="scorers" title="Top scorers" tone="coral" />
        <div className="card-surface p-3">
          <ScorersTable rows={scorers} caption={`${season.name} top scorers`} />
        </div>
      </section>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Table" />;
}
