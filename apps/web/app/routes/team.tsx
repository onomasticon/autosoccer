import type {
  ArticleListResponse,
  BudgetResponse,
  Position,
  SeasonResponse,
  TeamDetailResponse,
} from "@autosoccer/contracts";
import { AgentProfileCard } from "../components/AgentProfileCard";
import { ArticleCard } from "../components/ArticleCard";
import { BudgetMeter } from "../components/BudgetMeter";
import { FixtureCard } from "../components/MatchScoreCard";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { FormGuide } from "../components/StandingsTable";
import { EmptyState } from "../components/States";
import { TeamBadge } from "../components/TeamBadge";
import { apiMaybe, apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import { describeDeployment } from "../lib/tactics";
import type { Route } from "./+types/team";

export async function loader({ params }: Route.LoaderArgs) {
  const detail = await apiOr404<TeamDetailResponse>(`/api/v1/teams/${encodeURIComponent(params.slug)}`);
  const news = await apiMaybe<ArticleListResponse>(`/api/v1/articles?team=${encodeURIComponent(params.slug)}&limit=3`);
  const season = await apiMaybe<SeasonResponse>("/api/v1/seasons/current");
  const budget = season ? await apiMaybe<BudgetResponse>(`/api/v1/seasons/${season.season.slug}/budget`) : null;
  const budgetRow = budget?.rows.find((r) => r.teamId === detail.team.id) ?? null;
  return { ...detail, news: news?.items ?? [], budget: budgetRow };
}

export const meta: Route.MetaFunction = ({ data }) =>
  data
    ? seo(data.team.name, `${data.team.name}: squad, AI manager, form, fixtures and results.`)
    : seo("Team not found");

const POSITION_NAME: Record<Position, string> = { GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", FW: "Forward" };

export default function Team({ loaderData }: Route.ComponentProps) {
  const { team, players, manager, standing, fixtures, currentRevision, news, budget } = loaderData;
  const results = fixtures.filter((f) => f.status === "completed");
  const upcoming = fixtures.filter((f) => f.status !== "completed");
  return (
    <div className="space-y-8">
      <header className="card-surface relative overflow-hidden p-6 sm:p-8">
        <div aria-hidden className="absolute inset-y-0 right-0 w-2" style={{ background: team.colors.primary }} />
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <TeamBadge team={team} size="xl" decorative />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet">{team.city}</p>
            <h1 className="font-display text-5xl font-extrabold uppercase italic leading-none">{team.name}</h1>
            {standing ? (
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {[
                  ["Position", `${standing.position}`],
                  ["Points", `${standing.points}`],
                  ["Record", `${standing.won}W ${standing.drawn}D ${standing.lost}L`],
                  [
                    "Goal difference",
                    standing.goalDifference > 0 ? `+${standing.goalDifference}` : `${standing.goalDifference}`,
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted-text">{k}</dt>
                    <dd className="tabular font-display text-2xl font-extrabold">{v}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-muted-text">Form</dt>
                  <dd className="mt-1.5">
                    <FormGuide form={standing.form} />
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-muted-text">No league games played yet.</p>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-8">
          <section aria-labelledby="results">
            <SectionHeader id="results" title="Results" />
            {results.length ? (
              <div className="grid gap-2">
                {[...results].reverse().map((f) => (
                  <FixtureCard key={f.id} fixture={f} />
                ))}
              </div>
            ) : (
              <EmptyState title="No results yet" />
            )}
          </section>
          {upcoming.length > 0 && (
            <section aria-labelledby="upcoming">
              <SectionHeader id="upcoming" title="Fixtures" />
              <div className="grid gap-2">
                {upcoming.map((f) => (
                  <FixtureCard key={f.id} fixture={f} />
                ))}
              </div>
            </section>
          )}
          <section aria-labelledby="team-news">
            <SectionHeader id="team-news" title="Team news" />
            {news.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {news.map((a) => (
                  <ArticleCard key={a.id} article={a} />
                ))}
              </div>
            ) : (
              <EmptyState title="No stories yet">Reports about {team.name} appear here after their matches.</EmptyState>
            )}
          </section>
        </div>
        <aside className="space-y-8 lg:col-span-4" aria-label={`${team.name} club details`}>
          <section aria-labelledby="manager">
            <SectionHeader id="manager" title="Manager" />
            {manager && budget && (
              <div className="mb-3">
                <BudgetMeter row={budget} />
              </div>
            )}
            {manager ? (
              <AgentProfileCard
                agent={{
                  slug: manager.slug,
                  name: manager.name,
                  role: "manager",
                  bio: manager.persona,
                  avatar: {
                    shape: "square",
                    color: team.colors.primary,
                    initials: manager.name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2),
                  },
                  meta: `Philosophy: ${manager.philosophy}`,
                }}
              />
            ) : (
              <p className="card-surface p-4 text-sm text-muted-text">
                The club's AI manager hasn't been appointed yet; the team plays the league's baseline tactics.
              </p>
            )}
            {currentRevision && (
              <p className="mt-3 text-sm text-muted-text">
                Current tactics (v{currentRevision.version}): {describeDeployment(currentRevision.deployment)}
                {currentRevision.rationale ? ` — “${currentRevision.rationale}”` : ""}
              </p>
            )}
            {manager && (manager.memory.summary || manager.memory.notes.length > 0) && (
              <div className="card-surface mt-4 p-4 text-sm" data-testid="manager-notebook">
                <h3 className="font-display text-lg font-extrabold uppercase italic">Manager's notebook</h3>
                <p className="mt-1 text-xs text-muted-text">
                  The AI manager's persistent memory, rewritten after every match from the official record.
                </p>
                {manager.memory.summary && <p className="mt-3">{manager.memory.summary}</p>}
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-text">
                  {manager.memory.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section aria-labelledby="squad">
            <SectionHeader id="squad" title="Squad" />
            <ul className="card-surface divide-y divide-line">
              {players.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="tabular inline-flex size-8 items-center justify-center rounded-full bg-canvas font-display text-lg font-extrabold">
                    {p.shirtNumber}
                  </span>
                  <span className="flex-1 font-medium">{p.name}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-text">
                    <abbr title={POSITION_NAME[p.position]}>{p.position}</abbr>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Team" />;
}
