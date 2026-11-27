import type { LeagueDetailResponse } from "@autosoccer/contracts";
import { Link } from "react-router";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/league";
import { SeasonCard } from "./history";
import { leagueStatus } from "./leagues";

export async function loader({ params }: Route.LoaderArgs) {
  return apiOr404<LeagueDetailResponse>(`/api/v1/leagues/${encodeURIComponent(params.slug)}`);
}

export const meta: Route.MetaFunction = ({ data }) =>
  seo(data?.league.name ?? "League", data ? `${data.league.name}: every season, champion and top scorer.` : "");

export default function LeaguePage({ loaderData }: Route.ComponentProps) {
  const { league, seasons } = loaderData;
  const s = leagueStatus(league);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SectionHeader as="h1" banner eyebrow={s.label} title={league.name} />
      {league.status === "archived" && (
        <p className="card-surface p-4 text-sm" role="note">
          <span className="font-semibold">Archived history.</span> This league has finished. Its results, tables,
          players, articles and replays are kept exactly as they were, and nothing here changes any more. Old links
          still work.
        </p>
      )}
      {league.description && <p className="text-sm">{league.description}</p>}
      <p className="text-sm">
        <Link to="/leagues" className="font-semibold underline underline-offset-4 hover:text-violet-deep">
          All leagues
        </Link>
      </p>
      {!seasons.length ? (
        <EmptyState title="No seasons yet" />
      ) : (
        <ol className="grid gap-4" aria-label={`${league.name} seasons, newest first`}>
          {seasons.map((x) => (
            <SeasonCard key={x.season.id} s={x} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="League" />;
}
