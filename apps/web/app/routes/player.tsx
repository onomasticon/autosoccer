import type { FixtureStory, PlayerProfileResponse, SeasonResponse } from "@autosoccer/contracts";
import { Link } from "react-router";
import { FollowButton } from "../components/FollowClub";
import { PlayerCareer } from "../components/PlayerCareer";
import { OverallBadge, PlayerRatings } from "../components/PlayerRatings";
import { KIND_LABEL } from "../components/PlayerSpotlight";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { TeamBadge } from "../components/TeamBadge";
import { apiMaybe, apiOr404 } from "../lib/api.server";
import { kickoffUtc, matchdayHref } from "../lib/matchday";
import { seo } from "../lib/seo";
import { possessive, spotlightHref, surname } from "../lib/spotlight";
import type { Route } from "./+types/player";

export async function loader({ params }: Route.LoaderArgs) {
  const profile = await apiOr404<PlayerProfileResponse>(`/api/v1/players/${encodeURIComponent(params.id)}`);
  const [season, story] = await Promise.all([
    apiMaybe<SeasonResponse>("/api/v1/seasons/current"),
    profile.next
      ? apiMaybe<FixtureStory>(`/api/v1/fixtures/${encodeURIComponent(profile.next.fixtureId)}/story`)
      : Promise.resolve(null),
  ]);
  // What's at stake next, from the fixture story's record lines (never the result).
  const stakes = (story?.prematch.lines ?? [])
    .filter((l) => l.source === "record" && l.kind !== "fixture" && l.kind !== "tactics")
    .slice(0, 2)
    .map((l) => l.text);
  return { ...profile, teams: season?.teams ?? [], stakes };
}

export const meta: Route.MetaFunction = ({ data }) =>
  data
    ? seo(
        data.career.name,
        `${data.career.name} (${data.team.name}): ${data.allTime.goals} league goals in ${data.allTime.starts} starts. Career, ratings and latest moment.`,
      )
    : seo("Player not found");

const POSITION = { GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", FW: "Forward" } as const;

export default function PlayerPage({ loaderData }: Route.ComponentProps) {
  const { team, career, allTime, distinctions, recent, next, teams, stakes } = loaderData;
  const latest = career.seasons.at(-1);
  const short = surname(career.name);
  return (
    <div className="space-y-8">
      <header className="card-surface relative overflow-hidden p-6 sm:p-8" data-testid="player-header">
        <div aria-hidden className="absolute inset-y-0 right-0 w-2" style={{ background: team.colors.primary }} />
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <span className="tabular inline-flex size-20 shrink-0 items-center justify-center rounded-2xl bg-ink font-display text-5xl font-extrabold text-white">
            {career.shirtNumber}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet">
              {POSITION[career.position]}
              {career.retired && (
                <span className="ml-2 rounded bg-ink px-1.5 py-0.5 text-white" data-testid="retired-badge">
                  Retired
                </span>
              )}
            </p>
            <h1 className="font-display text-5xl font-extrabold uppercase italic leading-none">{career.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 font-semibold">
              <TeamBadge team={team} size="sm" decorative />
              <Link to={`/teams/${team.slug}`} className="underline underline-offset-4 hover:text-violet-deep">
                {team.name}
              </Link>
              {latest && <OverallBadge overall={latest.overall} />}
            </p>
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {[
                ["League goals", allTime.goals],
                ["Starts", allTime.starts],
                ["Seasons", career.seasons.filter((s) => s.teamMatches > 0).length],
                ...(typeof career.age === "number" ? [["Age", career.age] as const] : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-text">{k}</dt>
                  <dd className="tabular font-display text-2xl font-extrabold">{v}</dd>
                </div>
              ))}
            </dl>
            {(career.retired || career.graduate) && (
              <p className="mt-3 text-sm text-muted-text" data-testid="career-note">
                {career.retired
                  ? `Retired after ${career.retired.name}. Their record stays in the league's history.`
                  : `Promoted from the ${team.name} academy after ${career.graduate!.name}.`}
              </p>
            )}
          </div>
        </div>
        {distinctions.length > 0 && (
          <ul className="mt-5 space-y-1 border-t border-line pt-4 text-sm" data-testid="distinctions">
            {distinctions.map((d, i) => (
              <li key={d} className={i === 0 ? "font-semibold text-base" : ""}>
                {d}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-text">
          From the official record: league matches only, own goals excluded.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-7">
          <section aria-labelledby="recent-moment">
            <SectionHeader id="recent-moment" title="Latest moment" />
            {recent ? (
              <div className="card-surface space-y-2 p-5" data-testid="recent-moment">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-text">
                  {KIND_LABEL[recent.kind]} · {recent.season.name}, round {recent.round}
                </p>
                <p className="text-lg font-semibold">{recent.headline}</p>
                <p className="text-muted-text">{recent.detail}</p>
                <Link
                  to={spotlightHref(recent)}
                  className="inline-flex min-h-10 items-center rounded-lg bg-coral px-3 py-1.5 text-sm font-bold text-ink hover:brightness-95"
                >
                  {recent.replay && <span aria-hidden>▶&nbsp;</span>}
                  {recent.action}
                </Link>
              </div>
            ) : (
              <EmptyState title="No goals on record yet">
                {career.name} hasn't scored in a league match yet. Their starts are in the career table below.
              </EmptyState>
            )}
          </section>
          <section aria-labelledby="career">
            <SectionHeader id="career" title="Career" meta="Season by season" />
            <div className="card-surface p-5">
              <PlayerCareer career={career} />
            </div>
          </section>
        </div>
        <aside className="space-y-8 lg:col-span-5" aria-label={`${career.name}: club and next match`}>
          <section aria-labelledby="next-match">
            <SectionHeader id="next-match" title={`${team.shortName} next`} />
            <div className="card-surface space-y-3 p-5" data-testid="player-next">
              {next ? (
                <>
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <TeamBadge team={team} size="sm" decorative />
                    {team.name} {next.venue === "home" ? "v" : "at"} {next.opponent.name}
                    <TeamBadge team={next.opponent} size="sm" decorative />
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">Round {next.round} kick-off:</span> {kickoffUtc(next.scheduledAt)}
                  </p>
                  {stakes.length > 0 && (
                    <div className="text-sm">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-text">What's at stake</p>
                      <ul className="space-y-1">
                        {stakes.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Link
                    to={matchdayHref(next.fixtureId)}
                    className="inline-flex min-h-10 items-center rounded-lg bg-violet px-3 py-1.5 text-sm font-bold text-white hover:bg-violet-deep"
                  >
                    See the build-up <span aria-hidden>&nbsp;→</span>
                  </Link>
                </>
              ) : (
                <p className="text-sm text-muted-text">
                  No fixture scheduled for {team.name} yet. The next season's fixtures appear here once they're drawn.{" "}
                  <Link to="/history" className="font-semibold underline underline-offset-4">
                    Past seasons
                  </Link>
                </p>
              )}
              <div className="border-t border-line pt-3">
                <FollowButton team={team} teams={teams.length ? teams : [team]} />
              </div>
            </div>
          </section>
          {latest && (
            <section aria-labelledby="ratings">
              <SectionHeader id="ratings" title="Ratings" meta={latest.season.name} />
              <div className="card-surface p-5">
                <PlayerRatings player={{ attributes: latest.attributes, position: career.position }} />
                <p className="mt-3 text-xs text-muted-text">
                  Ratings are derived, not recorded: a fixed baseline, then one small rule-based step a season from{" "}
                  {possessive(short)} playing time and goals.
                </p>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Player" />;
}
