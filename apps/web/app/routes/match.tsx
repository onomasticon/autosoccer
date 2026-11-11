import type {
  ArticleListResponse,
  MatchDetailResponse,
  OfficialEvent,
  Player,
  TeamMatchStats,
} from "@autosoccer/contracts";
import { Link } from "react-router";
import { ArticleCard } from "../components/ArticleCard";
import { MatchViewer } from "../components/match-viewer/MatchViewer";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { StatusChip } from "../components/StatusChip";
import { TeamBadge } from "../components/TeamBadge";
import { apiMaybe, apiOr404 } from "../lib/api.server";
import { formatClock, formatDate } from "../lib/format";
import { seo } from "../lib/seo";
import { describeDeployment } from "../lib/tactics";
import type { Route } from "./+types/match";

export async function loader({ params }: Route.LoaderArgs) {
  const detail = await apiOr404<MatchDetailResponse>(`/api/v1/matches/${encodeURIComponent(params.id)}`);
  const reports = await apiMaybe<ArticleListResponse>(
    `/api/v1/articles?match=${encodeURIComponent(params.id)}&limit=3`,
  );
  return { ...detail, reports: reports?.items ?? [] };
}

export const meta: Route.MetaFunction = ({ data }) => {
  if (!data) return seo("Match not found");
  const { fixture: f, match: m } = data;
  const t =
    m.status === "completed"
      ? `${f.home.name} ${m.homeScore}–${m.awayScore} ${f.away.name}`
      : `${f.home.name} v ${f.away.name}`;
  return seo(
    t,
    `Round ${f.round} match centre: replay, timeline, statistics and lineups for ${f.home.name} v ${f.away.name}.`,
  );
};

type StatRow = { label: string; home: number; away: number; format?: (n: number) => string; total?: "sum" | "max" };
const pct = (n: number) => `${Math.round(n * 100)}%`;

function statRows(s: { home: TeamMatchStats; away: TeamMatchStats }): StatRow[] {
  const acc = (t: TeamMatchStats) => (t.passes ? t.passesCompleted / t.passes : 0);
  return [
    { label: "Possession", home: s.home.possession, away: s.away.possession, format: pct },
    { label: "Shots", home: s.home.shots, away: s.away.shots },
    { label: "Shots on target", home: s.home.shotsOnTarget, away: s.away.shotsOnTarget },
    { label: "Passes completed", home: s.home.passesCompleted, away: s.away.passesCompleted },
    { label: "Pass accuracy", home: acc(s.home), away: acc(s.away), format: pct },
    { label: "Tackles won", home: s.home.tacklesWon, away: s.away.tacklesWon },
    { label: "Interceptions", home: s.home.interceptions, away: s.away.interceptions },
    { label: "Keeper catches", home: s.home.keeperCatches, away: s.away.keeperCatches },
    { label: "Fouls", home: s.home.fouls, away: s.away.fouls },
  ];
}

function StatsTable({
  stats,
  home,
  away,
}: {
  stats: { home: TeamMatchStats; away: TeamMatchStats };
  home: string;
  away: string;
}) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Match statistics</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">{home}</th>
          <th scope="col">Statistic</th>
          <th scope="col">{away}</th>
        </tr>
      </thead>
      <tbody>
        {statRows(stats).map((r) => {
          const total = r.home + r.away || 1;
          const f = r.format ?? String;
          return (
            <tr key={r.label} className="border-b border-line last:border-0">
              <td className="tabular w-16 py-2.5 text-left font-bold">{f(r.home)}</td>
              <th scope="row" className="py-2.5 font-medium">
                <span className="block text-center">{r.label}</span>
                <span aria-hidden className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-line">
                  <span className="bg-violet" style={{ width: `${(r.home / total) * 100}%` }} />
                  <span className="ml-auto bg-coral" style={{ width: `${(r.away / total) * 100}%` }} />
                </span>
              </th>
              <td className="tabular w-16 py-2.5 text-right font-bold">{f(r.away)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Timeline({
  events,
  names,
  home,
  away,
}: {
  events: OfficialEvent[];
  names: Map<string, string>;
  home: string;
  away: string;
}) {
  const shown = events.filter(
    (e) =>
      e.type === "goal" ||
      e.type === "foul" ||
      (e.type === "restart" && (e.restart === "corner" || e.restart === "freeKick")) ||
      e.type === "periodEnd",
  );
  if (!shown.length) return <EmptyState title="No events recorded" />;
  const who = (id: string | null) => (id ? (names.get(id) ?? "Unknown player") : "Unknown player");
  const sideName = (s: "home" | "away") => (s === "home" ? home : away);
  return (
    <ol className="relative space-y-3 border-l-2 border-line pl-5">
      {shown.map((e, i) => {
        let icon = "•";
        let text = "";
        let strong = false;
        if (e.type === "goal") {
          icon = "⚽";
          strong = true;
          const other = e.side === "home" ? "away" : "home";
          text = e.ownGoal
            ? `Own goal by ${who(e.scorerId)} (${sideName(other)}) — ${sideName(e.side)} score. ${e.score.home}–${e.score.away}`
            : `Goal! ${who(e.scorerId)} — ${sideName(e.side)}. ${e.score.home}–${e.score.away}`;
        } else if (e.type === "foul") {
          icon = "✕";
          text = `Foul by ${who(e.playerId)} (${sideName(e.side)}) on ${who(e.againstId)}`;
        } else if (e.type === "restart") {
          icon = e.restart === "corner" ? "⚑" : "↗";
          text = `${e.restart === "corner" ? "Corner" : "Free kick"} to ${sideName(e.side)}, taken by ${who(e.takerId)}`;
        } else if (e.type === "periodEnd") {
          icon = "⏸";
          text = e.period === "firstHalf" ? "Half-time" : "Full time";
          strong = true;
        }
        return (
          <li key={`${e.tick}-${i}`} className="relative">
            <span
              aria-hidden
              className={`absolute -left-[1.95rem] top-0 inline-flex size-6 items-center justify-center rounded-full text-xs ${e.type === "goal" ? "bg-yellow" : "bg-surface ring-1 ring-line"}`}
            >
              {icon}
            </span>
            <span className="tabular mr-2 text-xs font-semibold text-muted-text">
              {formatClock(e.period, e.clockSec)}
            </span>
            <span className={strong ? "font-semibold" : ""}>{text}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Lineup({ players, title }: { players: Player[]; title: string }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <ul className="space-y-1 text-sm">
        {players.map((p) => (
          <li key={p.id} className="flex gap-2">
            <span className="tabular w-6 text-right font-bold">{p.shirtNumber}</span>
            <span className="flex-1">{p.name}</span>
            <span className="text-muted-text">{p.position}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MatchCentre({ loaderData }: Route.ComponentProps) {
  const { match, fixture, events, stats, lineups, replay, revisions, reports } = loaderData;
  const names = new Map([...lineups.home, ...lineups.away].map((p) => [p.id, p.name]));
  const done = match.status === "completed";
  const tactics = (r: (typeof revisions)["home"]) =>
    r
      ? `v${r.version}: ${describeDeployment(r.deployment)}${r.rationale ? `. Manager's reasoning: ${r.rationale}` : ""}`
      : "League baseline tactics (no manager revision)";
  return (
    <div className="space-y-8">
      <header className="card-surface overflow-hidden">
        <div className="flex items-center justify-between bg-violet px-5 py-2 text-sm font-semibold text-white">
          <span>
            <Link to="/fixtures" className="underline-offset-4 hover:underline">
              Round {fixture.round}
            </Link>
            {fixture.scheduledAt && ` · ${formatDate(fixture.scheduledAt, { weekday: true })}`}
          </span>
          <StatusChip status={fixture.status} />
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-6 sm:gap-8 sm:px-8">
          <Link
            to={`/teams/${fixture.home.slug}`}
            className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-end sm:text-right"
          >
            <span className="order-2 font-display text-xl font-extrabold uppercase italic leading-none sm:order-1 sm:text-3xl">
              {fixture.home.name}
            </span>
            <TeamBadge team={fixture.home} size="lg" decorative className="order-1 sm:order-2" />
          </Link>
          <h1 className="text-center">
            <span className="sr-only">
              {fixture.home.name} {done ? match.homeScore : ""} {done ? "–" : "versus"} {done ? match.awayScore : ""}{" "}
              {fixture.away.name}
            </span>
            <span
              aria-hidden
              className="tabular rounded-xl bg-ink px-4 py-2 font-display text-4xl font-extrabold text-white sm:text-6xl"
            >
              {done ? `${match.homeScore}–${match.awayScore}` : "v"}
            </span>
          </h1>
          <Link
            to={`/teams/${fixture.away.slug}`}
            className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-left"
          >
            <TeamBadge team={fixture.away} size="lg" decorative />
            <span className="font-display text-xl font-extrabold uppercase italic leading-none sm:text-3xl">
              {fixture.away.name}
            </span>
          </Link>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-8">
          {replay ? (
            <MatchViewer
              replayUrl={`/matches/${match.id}/replay.json.gz`}
              home={fixture.home}
              away={fixture.away}
              events={events}
            />
          ) : (
            <EmptyState title={done ? "Replay unavailable" : "Not played yet"}>
              {done ? "This match has no stored replay." : "The replay appears here once the match has been simulated."}
            </EmptyState>
          )}
          <section aria-labelledby="timeline">
            <SectionHeader id="timeline" title="Timeline" />
            <div className="card-surface p-5">
              {done ? (
                <Timeline events={events} names={names} home={fixture.home.name} away={fixture.away.name} />
              ) : (
                <p className="text-muted-text">No events yet.</p>
              )}
            </div>
          </section>
          <section aria-labelledby="report">
            <SectionHeader id="report" title="Match report" />
            {reports.length ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {reports.map((a) => (
                  <ArticleCard key={a.id} article={a} />
                ))}
              </div>
            ) : (
              <EmptyState title="No report yet">
                An AI reporter files a report from the official record after full time.
              </EmptyState>
            )}
          </section>
        </div>
        <aside className="space-y-8 lg:col-span-4" aria-label="Match details">
          <section aria-labelledby="stats">
            <SectionHeader id="stats" title="Statistics" />
            <div className="card-surface p-4">
              <div className="mb-2 flex justify-between text-xs font-bold uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2 rounded-full bg-violet" />
                  {fixture.home.shortName}
                </span>
                <span className="flex items-center gap-1.5">
                  {fixture.away.shortName}
                  <span aria-hidden className="size-2 rounded-full bg-coral" />
                </span>
              </div>
              {stats ? (
                <StatsTable stats={stats} home={fixture.home.name} away={fixture.away.name} />
              ) : (
                <p className="text-sm text-muted-text">Statistics appear after full time.</p>
              )}
            </div>
          </section>
          <section aria-labelledby="lineups">
            <SectionHeader id="lineups" title="Lineups" />
            <div className="card-surface grid grid-cols-2 gap-4 p-4">
              <Lineup players={lineups.home} title={fixture.home.shortName} />
              <Lineup players={lineups.away} title={fixture.away.shortName} />
            </div>
          </section>
          <section aria-labelledby="tactics">
            <SectionHeader id="tactics" title="Tactics" />
            <dl className="card-surface space-y-3 p-4 text-sm">
              <div>
                <dt className="font-semibold">{fixture.home.name}</dt>
                <dd className="text-muted-text">{tactics(revisions.home)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{fixture.away.name}</dt>
                <dd className="text-muted-text">{tactics(revisions.away)}</dd>
              </div>
            </dl>
          </section>
          <section aria-labelledby="provenance">
            <SectionHeader id="provenance" title="Match record" />
            <div className="card-surface p-4 text-sm">
              <p>
                Played by the deterministic autosoccer-sim engine: the same seed and pinned simulator always reproduce
                this exact match.
                {replay &&
                  (replay.verified
                    ? " The replay has been verified against the record."
                    : " The replay hasn't been verified yet.")}
              </p>
              <details className="group mt-3 rounded-lg border border-line" data-testid="technical-details">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet">
                  Technical details
                  <span aria-hidden className="transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line p-3 text-xs">
                  <dt className="text-muted-text">Seed</dt>
                  <dd className="tabular font-mono">{match.seed}</dd>
                  <dt className="text-muted-text">Simulator</dt>
                  <dd className="font-mono">
                    {match.versions.simCommit.slice(0, 7)} · engine {match.versions.engineVersion} · SDK{" "}
                    {match.versions.sdkVersion}
                  </dd>
                  {match.finalHash && (
                    <>
                      <dt className="text-muted-text">Final state hash</dt>
                      <dd className="break-all font-mono">{match.finalHash}</dd>
                    </>
                  )}
                  {replay && (
                    <>
                      <dt className="text-muted-text">Replay</dt>
                      <dd>
                        {replay.verified ? "✓ verified (every state hash re-simulated)" : "not verified"} ·{" "}
                        {(replay.byteSize / 1024).toFixed(0)} KB
                      </dd>
                    </>
                  )}
                </dl>
              </details>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Match" />;
}
