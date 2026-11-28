import type {
  ArticleListResponse,
  DugoutResponse,
  FixtureStory,
  FixturesResponse,
  FixtureView,
  JournalistListResponse,
  MatchDetailResponse,
  ScorersResponse,
  SeasonListResponse,
  SeasonResponse,
  SeasonSummary,
  SpotlightResponse,
  StandingsResponse,
} from "@autosoccer/contracts";
import { Link } from "react-router";
import { VoicesStrip } from "../components/AgentProfileCard";
import { ArticleCard } from "../components/ArticleCard";
import { InsideTheDugout } from "../components/Dugout";
import { FeaturedMatchday } from "../components/FeaturedMatchday";
import { YourClub } from "../components/FollowClub";
import { LeadStory } from "../components/LeadStory";
import { FixtureRow } from "../components/MatchScoreCard";
import { MatchViewer } from "../components/match-viewer/MatchViewer";
import { PlayerSpotlight } from "../components/PlayerSpotlight";
import { RouteError } from "../components/RouteError";
import { Panel, SectionHeader } from "../components/SectionHeader";
import { StandingsTable } from "../components/StandingsTable";
import { EmptyState, ErrorState } from "../components/States";
import { TitleRaceLine } from "../components/TitleRace";
import { apiMaybe, apiOptional } from "../lib/api.server";
import { formatDate } from "../lib/format";
import { seo } from "../lib/seo";
import { clubReasons, focusFor } from "../lib/spotlight";
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
      fixtures: [],
      previous: null,
      nextStories: {},
      spotlight: null,
      reasons: {},
    };
  const slug = current.season.slug;
  const [standings, fixtures, articles, journalists, dugout, spotlight, seasons, allTime] = await Promise.all([
    apiMaybe<StandingsResponse>(`/api/v1/seasons/${slug}/standings`),
    apiMaybe<FixturesResponse>(`/api/v1/seasons/${slug}/fixtures`),
    // Biggest stories first (priority, fading with age): a champion is the headline.
    apiMaybe<ArticleListResponse>("/api/v1/articles?limit=10&sort=priority"),
    apiMaybe<JournalistListResponse>("/api/v1/journalists"),
    apiMaybe<DugoutResponse>(`/api/v1/seasons/${slug}/dugout`),
    apiMaybe<SpotlightResponse>("/api/v1/spotlight"),
    apiMaybe<SeasonListResponse>("/api/v1/seasons"),
    apiMaybe<ScorersResponse>("/api/v1/scorers"),
  ]);
  const all: FixtureView[] = fixtures?.rounds.flatMap((r) => r.fixtures) ?? [];
  const completed = all.filter((f) => f.status === "completed" && f.matchId);
  // At least a full round (ten clubs: five fixtures), and never fewer than four.
  const perPanel = Math.max(4, Math.floor(current.teams.length / 2));
  const results = completed.slice(-perPanel).reverse();
  const upcoming = all.filter((f) => f.status !== "completed").slice(0, perPanel);
  // Before the new season's first result, the last completed season is still the story: its champion,
  // its final table and its last replay.
  let previous: SeasonSummary | null = null;
  let latest = completed.at(-1);
  if (!latest) {
    previous = seasons?.items.find((s) => s.season.status === "completed" && s.season.slug !== slug) ?? null;
    if (previous) {
      const prev = await apiMaybe<FixturesResponse>(`/api/v1/seasons/${previous.season.slug}/fixtures`);
      latest = prev?.rounds
        .flatMap((r) => r.fixtures)
        .filter((f) => f.status === "completed" && f.matchId)
        .at(-1);
    }
  }
  // The featured replay is the spotlight's match when it has one (so the lead and the pitch agree),
  // else the latest result.
  const lead = spotlight?.lead ?? null;
  const featuredId = lead?.matchId && lead.replay ? lead.matchId : latest?.matchId;
  const featured = featuredId ? await apiMaybe<MatchDetailResponse>(`/api/v1/matches/${featuredId}`) : null;
  // Stakes for the next round (each club plays once a round), for Your Club. Shared data only: the
  // followed club is picked in the browser, so this page stays the same for every visitor.
  const nextRound = Math.min(...all.filter((f) => f.status !== "completed").map((f) => f.round));
  const nextStories: Record<string, FixtureStory> = {};
  for (const f of all.filter((x) => x.round === nextRound && x.status !== "completed")) {
    const s = await apiMaybe<FixtureStory>(`/api/v1/fixtures/${encodeURIComponent(f.id)}/story`);
    if (s) nextStories[f.id] = s;
  }
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
    fixtures: all,
    previous,
    nextStories,
    spotlight,
    reasons: clubReasons({
      teams: current.teams,
      seasons: seasons?.items ?? [],
      allTimeScorers: allTime?.items ?? [],
      standings: standings?.rows ?? null,
      lead,
    }),
  };
}

/** Between seasons: who won the last one, and when the next one starts. */
export function OffSeasonCard({
  previous,
  next,
  firstKickoff,
}: {
  previous: SeasonSummary;
  next: string;
  firstKickoff: string | null;
}) {
  const champ = previous.leader;
  return (
    <div className="card-surface flex flex-col gap-4 p-6">
      <SectionHeader
        as="h2"
        banner
        eyebrow={`${previous.season.name} · final`}
        title={champ ? `${champ.team.name}, champions` : previous.season.name}
      />
      {champ && (
        <p>
          {champ.points} points from {champ.played} matches
          {previous.margin !== null && previous.runnerUp
            ? previous.margin === 0
              ? `, level on points with ${previous.runnerUp.team.name} and ahead on tie-breaks.`
              : `, ${previous.margin} clear of ${previous.runnerUp.team.name}.`
            : "."}
        </p>
      )}
      <p className="text-muted-text">
        {next}{" "}
        {firstKickoff ? `kicks off ${formatDate(firstKickoff, { weekday: true, time: true })}.` : "is scheduled."} The
        managers keep what they learned last season.
      </p>
      <p className="flex flex-wrap gap-x-4 text-sm font-semibold">
        <Link
          to={`/table?season=${previous.season.slug}`}
          className="underline underline-offset-4 hover:text-violet-deep"
        >
          {previous.season.name} final table
        </Link>
        <Link to="/history" className="underline underline-offset-4 hover:text-violet-deep">
          Every champion
        </Link>
      </p>
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A story this big (champions, a bankruptcy, a takeover, league changes) leads the page. */
export const HEADLINE_PRIORITY = 75;

/**
 * Picks the homepage's stories from a priority-ranked list: the headline (a big enough story),
 * the lead (the headline, else the report on the featured match, else the top story) and the
 * next three.
 */
export function pickStories<T extends { id: string; kind: string; matchId: string | null; priority?: number }>(
  ranked: T[],
  featuredMatchId: string | null,
  offSeason: boolean,
) {
  const headline = !offSeason && ranked[0] && (ranked[0].priority ?? 0) >= HEADLINE_PRIORITY ? ranked[0] : null;
  const lead =
    headline ??
    ranked.find((a) => featuredMatchId && a.matchId === featuredMatchId && a.kind === "match_report") ??
    ranked[0] ??
    null;
  return { headline, lead, stories: ranked.filter((a) => a !== lead).slice(0, 5) };
}

/**
 * Homepage, laid out after the approved mockup (docs/design/assets/homepage-reference.png), led by
 * the biggest story: between seasons the champion, in season a headline story when there is one;
 * then the player spotlight and genuine replay, your club, the matchday, the stories / table /
 * schedule panels, Inside the Dugout (the AI managers' decision → match → lesson loop), and voices.
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    season,
    teams,
    standings,
    results,
    upcoming,
    featured,
    articles,
    journalists,
    dugout,
    fixtures,
    previous,
    nextStories,
    spotlight,
    reasons,
  } = loaderData;
  if (!season)
    return (
      <EmptyState title="The league hasn't kicked off">
        The first season will appear here once it's scheduled.
      </EmptyState>
    );
  // Articles come biggest story first. Without a headline, lead with the report on the featured
  // (latest) match, so story and replay agree.
  const { headline, lead, stories } = pickStories(articles, featured?.match.id ?? null, !!previous);
  const schedule = upcoming.length ? upcoming : results;
  const spot = spotlight?.lead ?? null;
  const focus = spot && featured && spot.matchId === featured.match.id ? focusFor(featured, spot.player.id) : null;
  const moments = Object.fromEntries((spotlight?.clubs ?? []).map((c) => [c.teamId, c.moment]));
  const replay = featured?.replay ? (
    <section aria-labelledby="featured-replay" className="flex flex-col" id="replay">
      <h2 id="featured-replay" className="sr-only">
        Replay: {featured.fixture.home.name} {featured.match.homeScore}–{featured.match.awayScore}{" "}
        {featured.fixture.away.name}
      </h2>
      <MatchViewer
        replayUrl={`/matches/${featured.match.id}/replay.json.gz`}
        home={featured.fixture.home}
        away={featured.fixture.away}
        events={featured.events}
        playerNames={new Map([...featured.lineups.home, ...featured.lineups.away].map((p) => [p.id, p.name]))}
        lineups={featured.lineups}
        focus={focus ?? undefined}
        compact
      />
      <Link
        to={`/matches/${featured.match.id}`}
        className="mt-1 self-end text-sm font-semibold underline-offset-4 hover:underline"
      >
        {previous && featured.fixture.round === previous.rounds
          ? `${previous.season.name}, last match`
          : `Matchweek ${pad2(featured.fixture.round)}`}{" "}
        match centre <span aria-hidden>→</span>
      </Link>
    </section>
  ) : spot ? (
    <EmptyState title="No replay for this one">
      {spot.matchId
        ? "This match has no stored replay, so there's no clip to play. The match record has every goal."
        : "No goals in the latest round, so there's no clip to play. The next match is one tap away."}
    </EmptyState>
  ) : (
    <EmptyState title="No replay yet">The latest match replay appears here after the first result.</EmptyState>
  );
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Auto Soccer — {season.name}</h1>
      {previous ? (
        <OffSeasonCard previous={previous} next={season.name} firstKickoff={upcoming[0]?.scheduledAt ?? null} />
      ) : (
        headline && <LeadStory article={headline} teams={teams} />
      )}
      {spot && (
        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <PlayerSpotlight lead={spot} />
          {replay}
        </div>
      )}
      <section aria-labelledby="latest-news" data-testid="latest-news">
        <SectionHeader
          id="latest-news"
          title="Latest news"
          action={{ to: "/news", label: "All news" }}
          meta="Biggest stories first"
        />
        {lead || stories.length ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Without a headline at the top, the lead story opens the news, bigger. */}
            {lead && !headline && !previous && (
              <div className="sm:col-span-2">
                <ArticleCard article={lead} variant="lead" />
              </div>
            )}
            {(headline || previous ? articles.filter((a) => a !== headline) : stories)
              .slice(0, lead && !headline && !previous ? 4 : 6)
              .map((a) => (
                <ArticleCard key={a.id} article={a} />
              ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-text">
            AI journalists file reports from the official record after each match, and league news as it happens.
          </p>
        )}
      </section>
      <YourClub
        teams={teams}
        fixtures={fixtures}
        stories={dugout?.stories ?? null}
        articles={articles}
        season={season.slug}
        nextStories={nextStories}
        reasons={reasons}
        moments={moments}
      />
      {!previous && <FeaturedMatchday fixtures={fixtures} />}
      {!spot && replay}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="table-heading" title="League table" tone="coral" meta={season.name} bodyClassName="p-2 sm:p-3">
          {standings && (
            <TitleRaceLine
              race={standings.race}
              afterRound={standings.afterRound}
              seasonCompleted={season.status === "completed"}
              endedEarly={season.endedEarly}
              className="px-2 pb-2"
            />
          )}
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

      {dugout ? (
        <InsideTheDugout featured={dugout.featured} stories={dugout.stories} />
      ) : (
        <ErrorState title="Inside the Dugout is unavailable">
          The managers' decisions couldn't be loaded just now. Results and stories above are unaffected.
        </ErrorState>
      )}

      <VoicesStrip agents={journalists.map((j) => ({ ...j, href: `/journalists/${j.slug}` }))} />
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Homepage" />;
}
