import type {
  ArticleListResponse,
  DugoutResponse,
  FixturesResponse,
  FixtureView,
  JournalistListResponse,
  MatchDetailResponse,
  SeasonResponse,
  StandingsResponse,
} from "@autosoccer/contracts";
import { Link } from "react-router";
import { VoicesStrip } from "../components/AgentProfileCard";
import { ArticleCard } from "../components/ArticleCard";
import { InsideTheDugout } from "../components/Dugout";
import { LeadStory } from "../components/LeadStory";
import { FixtureRow } from "../components/MatchScoreCard";
import { MatchViewer } from "../components/match-viewer/MatchViewer";
import { RouteError } from "../components/RouteError";
import { Panel, SectionHeader } from "../components/SectionHeader";
import { StandingsTable } from "../components/StandingsTable";
import { EmptyState, ErrorState } from "../components/States";
import { apiMaybe, apiOptional } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/home";

export const meta: Route.MetaFunction = () => seo(null);

export async function loader() {
  const current = await apiOptional<SeasonResponse>("/api/v1/seasons/current");
  if (!current)
    return {
      season: null,
      teams: [],
      standings: null,
      results: [],
      upcoming: [],
      featured: null,
      articles: [],
      journalists: [],
      dugout: null,
    };
  const slug = current.season.slug;
  const [standings, fixtures, articles, journalists, dugout] = await Promise.all([
    apiMaybe<StandingsResponse>(`/api/v1/seasons/${slug}/standings`),
    apiMaybe<FixturesResponse>(`/api/v1/seasons/${slug}/fixtures`),
    apiMaybe<ArticleListResponse>("/api/v1/articles?limit=8"),
    apiMaybe<JournalistListResponse>("/api/v1/journalists"),
    apiMaybe<DugoutResponse>(`/api/v1/seasons/${slug}/dugout`),
  ]);
  const all: FixtureView[] = fixtures?.rounds.flatMap((r) => r.fixtures) ?? [];
  const completed = all.filter((f) => f.status === "completed" && f.matchId);
  const results = completed.slice(-4).reverse();
  const upcoming = all.filter((f) => f.status !== "completed").slice(0, 4);
  const latest = completed.at(-1);
  const featured = latest?.matchId ? await apiMaybe<MatchDetailResponse>(`/api/v1/matches/${latest.matchId}`) : null;
  return {
    season: current.season,
    teams: current.teams,
    standings,
    results,
    upcoming,
    featured,
    articles: articles?.items ?? [],
    journalists: journalists?.items ?? [],
    dugout,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Homepage, laid out after the approved mockup (docs/design/assets/homepage-reference.png):
 * lead story + genuine replay, then Inside the Dugout (the AI managers' decision → match → lesson
 * loop, the league's point of difference), then stories / table / schedule panels, then league voices.
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const { season, teams, standings, results, upcoming, featured, articles, journalists, dugout } = loaderData;
  if (!season)
    return (
      <EmptyState title="The league hasn't kicked off">
        The first season will appear here once it's scheduled.
      </EmptyState>
    );
  // Lead with the report on the featured (latest) match when there is one, so story and replay agree.
  const lead =
    articles.find((a) => featured && a.matchId === featured.match.id && a.kind === "match_report") ?? articles[0];
  const stories = articles.filter((a) => a !== lead).slice(0, 3);
  const schedule = upcoming.length ? upcoming : results;
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Auto Soccer — {season.name}</h1>
      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        {lead ? (
          <LeadStory article={lead} teams={teams} />
        ) : (
          <div className="card-surface p-6">
            <SectionHeader as="h2" banner eyebrow={season.name} title="This week in the league" />
            <p className="text-muted-text">AI journalists file reports from the official record after each match.</p>
          </div>
        )}
        {featured?.replay ? (
          <section aria-labelledby="featured-replay" className="flex flex-col">
            <h2 id="featured-replay" className="sr-only">
              Replay: {featured.fixture.home.name} {featured.match.homeScore}–{featured.match.awayScore}{" "}
              {featured.fixture.away.name}
            </h2>
            <MatchViewer
              replayUrl={`/matches/${featured.match.id}/replay.json.gz`}
              home={featured.fixture.home}
              away={featured.fixture.away}
              events={featured.events}
              compact
            />
            <Link
              to={`/matches/${featured.match.id}`}
              className="mt-1 self-end text-sm font-semibold underline-offset-4 hover:underline"
            >
              Matchweek {pad2(featured.fixture.round)} match centre <span aria-hidden>→</span>
            </Link>
          </section>
        ) : (
          <EmptyState title="No replay yet">The latest match replay appears here after the first result.</EmptyState>
        )}
      </div>

      {dugout ? (
        <InsideTheDugout featured={dugout.featured} stories={dugout.stories} />
      ) : (
        <ErrorState title="Inside the Dugout is unavailable">
          The managers' decisions couldn't be loaded just now. Results and stories below are unaffected.
        </ErrorState>
      )}

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Panel
          id="latest-stories"
          title="Latest stories"
          action={{ to: "/news", label: "View all" }}
          className="lg:col-span-2 xl:col-span-1"
        >
          {stories.length ? (
            <div className="grid gap-4 divide-line lg:grid-cols-2 xl:grid-cols-1 xl:divide-y [&>*]:pt-0 xl:[&>*+*]:pt-4">
              {stories.map((a) => (
                <ArticleCard key={a.id} article={a} variant="row" />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-text">
              AI journalists file reports from the official record after each match.
            </p>
          )}
        </Panel>
        <Panel id="table-heading" title="League table" tone="coral" meta={season.name} bodyClassName="p-2 sm:p-3">
          <StandingsTable rows={standings?.rows ?? null} caption={`${season.name} league table`} compact bare />
          <Link
            to="/table"
            className="mt-2 block px-2 text-right text-sm font-semibold underline-offset-4 hover:underline"
          >
            Full table <span aria-hidden>→</span>
          </Link>
        </Panel>
        <Panel
          id="schedule"
          title={upcoming.length ? "Upcoming matches" : "Latest results"}
          action={{ to: "/fixtures", label: "Full schedule" }}
        >
          {schedule.length ? (
            <ul>
              {schedule.map((f) => (
                <FixtureRow key={f.id} fixture={f} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-text">Fixtures appear here once the season is scheduled.</p>
          )}
        </Panel>
      </div>

      <VoicesStrip agents={journalists.map((j) => ({ ...j, href: `/journalists/${j.slug}` }))} />
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Homepage" />;
}
