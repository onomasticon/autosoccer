import type { FixturesResponse, SeasonResponse } from "@autosoccer/contracts";
import { FixtureCard } from "../components/MatchScoreCard";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { apiOr404 } from "../lib/api.server";
import { formatDate } from "../lib/format";
import { seo } from "../lib/seo";
import type { Route } from "./+types/fixtures";

export async function loader() {
  const { season } = await apiOr404<SeasonResponse>("/api/v1/seasons/current");
  return apiOr404<FixturesResponse>(`/api/v1/seasons/${season.slug}/fixtures`);
}

export const meta: Route.MetaFunction = ({ data }) =>
  seo(
    data ? `${data.season.name} fixtures & results` : "Fixtures",
    "Every fixture and result of the season, round by round, with links to each match centre.",
  );

export default function Fixtures({ loaderData }: Route.ComponentProps) {
  const { season, rounds } = loaderData;
  const played = rounds.flatMap((r) => r.fixtures).filter((f) => f.status === "completed").length;
  const total = rounds.flatMap((r) => r.fixtures).length;
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <SectionHeader as="h1" banner eyebrow={`${season.name} · ${played}/${total} played`} title="Fixtures & results" />
      {!rounds.length && (
        <EmptyState title="No fixtures yet">The calendar appears once the season is scheduled.</EmptyState>
      )}
      {rounds.map((r) => (
        <section key={r.round} aria-labelledby={`round-${r.round}`}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id={`round-${r.round}`} className="font-display text-2xl font-extrabold uppercase italic">
              Round {r.round}
            </h2>
            <span className="text-sm text-muted-text">
              {formatDate(r.fixtures[0]?.scheduledAt ?? null, { weekday: true })}
            </span>
          </div>
          <div className="grid gap-2">
            {r.fixtures.map((f) => (
              <FixtureCard key={f.id} fixture={f} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Fixtures" />;
}
