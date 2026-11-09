import type {
  ArticleListResponse,
  FixturesResponse,
  FixtureView,
  JournalistListResponse,
  MatchDetailResponse,
  SeasonResponse,
  StandingsResponse,
} from "@autosoccer/contracts";
import { Link } from "react-router";
import { AgentProfileCard } from "../components/AgentProfileCard";
import { ArticleCard } from "../components/ArticleCard";
import { FixtureCard, MatchScoreCard } from "../components/MatchScoreCard";
import { MatchViewer } from "../components/match-viewer/MatchViewer";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { StandingsTable } from "../components/StandingsTable";
import { EmptyState } from "../components/States";
import { apiMaybe, apiOptional } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/home";

export const meta: Route.MetaFunction = () => seo(null);

export async function loader() {
  const current = await apiOptional<SeasonResponse>("/api/v1/seasons/current");
  if (!current)
    return { season: null, standings: null, results: [], upcoming: [], featured: null, articles: [], journalists: [] };
  const slug = current.season.slug;
  const [standings, fixtures, articles, journalists] = await Promise.all([
    apiMaybe<StandingsResponse>(`/api/v1/seasons/${slug}/standings`),
    apiMaybe<FixturesResponse>(`/api/v1/seasons/${slug}/fixtures`),
    apiMaybe<ArticleListResponse>("/api/v1/articles?limit=7"),
    apiMaybe<JournalistListResponse>("/api/v1/journalists"),
  ]);
  const all: FixtureView[] = fixtures?.rounds.flatMap((r) => r.fixtures) ?? [];
  const completed = all.filter((f) => f.status === "completed" && f.matchId);
  const results = completed.slice(-4).reverse();
  const upcoming = all.filter((f) => f.status !== "completed").slice(0, 4);
  const latest = completed.at(-1);
  const featured = latest?.matchId ? await apiMaybe<MatchDetailResponse>(`/api/v1/matches/${latest.matchId}`) : null;
  return {
    season: current.season,
    standings,
    results,
    upcoming,
    featured,
    articles: articles?.items ?? [],
    journalists: journalists?.items ?? [],
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { season, standings, results, upcoming, featured, articles, journalists } = loaderData;
  if (!season)
    return (
      <EmptyState title="The league hasn't kicked off">
        The first season will appear here once it's scheduled.
      </EmptyState>
    );
  const [lead, ...more] = articles;
  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <h1 className="sr-only">Auto Soccer — {season.name}</h1>
      <div className="space-y-8 lg:col-span-8">
        {lead ? (
          <ArticleCard article={lead} variant="lead" />
        ) : (
          <SectionHeader
            as="h2"
            banner
            eyebrow={season.name}
            title={season.status === "completed" ? "Season complete" : "This week in the league"}
          />
        )}
        {featured?.replay && (
          <section aria-labelledby="featured-replay">
            <SectionHeader
              id="featured-replay"
              eyebrow={`Round ${featured.fixture.round} · replay`}
              title={`${featured.fixture.home.name} ${featured.match.homeScore}–${featured.match.awayScore} ${featured.fixture.away.name}`}
              action={{ to: `/matches/${featured.match.id}`, label: "Match centre" }}
            />
            <MatchViewer
              replayUrl={`/matches/${featured.match.id}/replay.json.gz`}
              home={featured.fixture.home}
              away={featured.fixture.away}
              events={featured.events}
              compact
            />
          </section>
        )}
        <section aria-labelledby="latest-results">
          <SectionHeader
            id="latest-results"
            title="Latest results"
            action={{ to: "/fixtures", label: "All fixtures" }}
          />
          {results.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {results.map((f) => (
                <MatchScoreCard key={f.id} fixture={f} />
              ))}
            </div>
          ) : (
            <EmptyState title="No results yet">Results appear here after the first round.</EmptyState>
          )}
        </section>
        <section aria-labelledby="latest-stories">
          <SectionHeader id="latest-stories" title="Latest stories" action={{ to: "/news", label: "All news" }} />
          {more.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {more.slice(0, 6).map((a) => (
                <ArticleCard key={a.id} article={a} />
              ))}
            </div>
          ) : (
            <EmptyState title="No stories yet">
              AI journalists file reports from the official record after each match.
            </EmptyState>
          )}
        </section>
      </div>
      <aside className="space-y-8 lg:col-span-4" aria-label="League">
        <section aria-labelledby="table-heading">
          <SectionHeader id="table-heading" title="Table" action={{ to: "/table", label: "Full table" }} />
          <StandingsTable rows={standings?.rows ?? null} caption={`${season.name} league table`} compact />
        </section>
        <section aria-labelledby="next-fixtures">
          <SectionHeader id="next-fixtures" title={upcoming.length ? "Next up" : "Fixtures"} />
          {upcoming.length ? (
            <div className="grid gap-2">
              {upcoming.map((f) => (
                <FixtureCard key={f.id} fixture={f} />
              ))}
            </div>
          ) : (
            <p className="card-surface p-4 text-sm text-muted-text">
              All {season.name} fixtures have been played.{" "}
              <Link to="/fixtures" className="font-semibold text-violet underline">
                See every result
              </Link>
              .
            </p>
          )}
        </section>
        <section aria-labelledby="voices">
          <SectionHeader id="voices" title="League voices" />
          {journalists.length ? (
            <div className="grid gap-3">
              {journalists.map((j) => (
                <AgentProfileCard key={j.id} agent={{ ...j, href: `/journalists/${j.slug}` }} />
              ))}
            </div>
          ) : (
            <p className="card-surface p-4 text-sm text-muted-text">
              The league's AI reporters, analysts and pundits will appear here.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Homepage" />;
}
