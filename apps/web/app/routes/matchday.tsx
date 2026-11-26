import type { FixtureStory, ManagerProfile, MatchDetailResponse, StorySide } from "@autosoccer/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { StoryCard } from "../components/FixtureStory";
import { ManagerArc } from "../components/ManagerArc";
import { MatchViewer } from "../components/match-viewer/MatchViewer";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { TeamBadge } from "../components/TeamBadge";
import { apiMaybe, apiOr404 } from "../lib/api.server";
import {
  type Act,
  forfeitHeadline,
  kickoffUtc,
  managerContrast,
  matchdayHref,
  STAGE_INFO,
  watchNote,
} from "../lib/matchday";
import { seo } from "../lib/seo";
import type { Route } from "./+types/matchday";

export async function loader({ params }: Route.LoaderArgs) {
  const id = encodeURIComponent(params.fixtureId);
  const story = await apiOr404<FixtureStory>(`/api/v1/fixtures/${id}/story`);
  const done = story.stage === "completed" || story.stage === "forfeited";
  // Manager patterns are "to date": shown only before the match, so a finished matchday never
  // describes a manager with decisions made after it.
  const profile = (s: StorySide) =>
    done ? null : apiMaybe<ManagerProfile>(`/api/v1/teams/${encodeURIComponent(s.team.slug)}/manager-profile`);
  const [detail, home, away] = await Promise.all([
    story.match ? apiMaybe<MatchDetailResponse>(`/api/v1/matches/${encodeURIComponent(story.match.id)}`) : null,
    profile(story.home),
    profile(story.away),
  ]);
  return { story, detail, profiles: { home, away } };
}

export const meta: Route.MetaFunction = ({ data }) => {
  if (!data) return seo("Matchday not found");
  const { story: s } = data;
  const score = s.match?.score;
  const ff = forfeitHeadline(s);
  const title = score
    ? `Matchday: ${s.home.team.name} ${score.home}–${score.away} ${s.away.team.name}`
    : ff
      ? `Matchday: ${s.home.team.name} v ${s.away.team.name} (${ff})`
      : `Matchday: ${s.home.team.name} v ${s.away.team.name}`;
  return seo(title, `${s.season.name}, round ${s.round}: build-up, the recorded replay and the reaction.`);
};

const ACTS: Array<{ id: Act; title: string }> = [
  { id: "build-up", title: "Build-up" },
  { id: "watch", title: "Watch" },
  { id: "reaction", title: "Reaction" },
];

const TONE = {
  muted: "bg-white/15 text-white",
  live: "bg-yellow text-navy",
  done: "bg-white text-navy",
  warn: "bg-coral text-ink",
} as const;

/** Kick-off in the reader's own time zone, added after hydration (the server renders UTC only). */
function LocalKickoff({ iso }: { iso: string | null }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone === "UTC" || zone === "Etc/UTC") return;
    setLocal(
      `${d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} your time`,
    );
  }, [iso]);
  return local ? <span className="block text-xs opacity-80">{local}</span> : null;
}

function Decision({ side }: { side: StorySide }) {
  const d = side.decision;
  const text =
    !d || d.status === "pending"
      ? "Decision still to come before kick-off."
      : d.status === "opening"
        ? `On the club's pre-season plan: ${d.summary}.`
        : d.status === "skipped_budget"
          ? `No decision: the season's compute budget is spent, so the last valid setup plays (${d.summary}).`
          : d.status === "failed" || d.status === "rejected"
            ? `The decision run didn't produce a valid setup, so the last valid one plays (${d.summary}).`
            : `${d.status === "kept" ? "Kept the same setup" : "Committed a new setup"}: ${d.summary}${d.revisionVersion ? ` (revision v${d.revisionVersion})` : ""}.`;
  return (
    <div className="text-sm">
      <p className="font-semibold">
        {side.manager?.name ?? "Manager"} <span className="font-normal text-muted-text">({side.team.name})</span>
      </p>
      <p className="mt-0.5">{text}</p>
      {d?.rationale && (
        <p className="mt-1 rounded-lg bg-lavender/60 px-2 py-1 text-xs">
          <span className="font-semibold">Stated reason</span> (AI-written, unverified): {d.rationale}
        </p>
      )}
    </div>
  );
}

export default function Matchday({ loaderData }: Route.ComponentProps) {
  const { story, detail, profiles } = loaderData;
  const { home, away } = story;
  const info = STAGE_INFO[story.stage];
  const done = story.stage === "completed";
  const score = story.match?.score ?? null;
  const forfeit = story.forfeit ?? null;
  const headline = forfeitHeadline(story);
  const replay = detail?.replay ?? null;
  const note = watchNote(story, !!replay);
  const contrast = managerContrast(profiles.home, profiles.away);
  const names = detail
    ? new Map([...detail.lineups.home, ...detail.lineups.away].map((p) => [p.id, p.name]))
    : undefined;
  return (
    <div className="space-y-8">
      <header className="card-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-violet px-5 py-2 text-sm font-semibold text-white">
          <span>
            Matchday · {story.season.name} · Round {story.round} of {story.season.rounds} ·{" "}
            {story.season.playersPerTeam}
            -a-side
          </span>
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${TONE[info.tone]}`}
            data-testid="stage"
          >
            {info.label}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-6 sm:gap-8 sm:px-8">
          <Link
            to={`/teams/${home.team.slug}`}
            className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-end sm:text-right"
          >
            <span className="order-2 font-display text-xl font-extrabold uppercase italic leading-none sm:order-1 sm:text-3xl">
              {home.team.name}
            </span>
            <TeamBadge team={home.team} size="lg" decorative className="order-1 sm:order-2" />
          </Link>
          <h1 className="text-center">
            <span className="sr-only">
              {home.team.name} {score ? `${score.home}–${score.away}` : "versus"} {away.team.name}
              {headline ? `: ${headline}` : ""}
            </span>
            <span
              aria-hidden
              className={`tabular rounded-xl px-4 py-2 font-display text-4xl font-extrabold sm:text-6xl ${forfeit ? "bg-coral text-ink" : "bg-ink text-white"}`}
            >
              {score ? `${score.home}–${score.away}` : forfeit ? (forfeit.kind === "void" ? "Void" : "W/O") : "v"}
            </span>
          </h1>
          <Link
            to={`/teams/${away.team.slug}`}
            className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-left"
          >
            <TeamBadge team={away.team} size="lg" decorative />
            <span className="font-display text-xl font-extrabold uppercase italic leading-none sm:text-3xl">
              {away.team.name}
            </span>
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm sm:px-8">
          <p>
            <span className="font-semibold">Kick-off:</span> {kickoffUtc(story.scheduledAt)}
            <LocalKickoff iso={story.scheduledAt} />
          </p>
          <nav aria-label="Matchday sections" className="flex gap-1">
            {ACTS.map((a) => (
              <a
                key={a.id}
                href={`#${a.id}`}
                aria-current={a.id === info.act ? "step" : undefined}
                className={`rounded-full px-3 py-1 font-semibold ${a.id === info.act ? "bg-ink text-white" : "text-violet-deep hover:bg-lavender"}`}
              >
                {a.title}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {forfeit && (
        <section aria-labelledby="forfeit" className="card-surface space-y-2 border-l-4 border-coral p-4">
          <h2 id="forfeit" className="font-display text-xl font-extrabold uppercase italic">
            {headline}
          </h2>
          {forfeit.withdrawn.map((w) => (
            <p key={w.team.id} className="text-sm">
              <span className="font-semibold">{w.team.name}</span> withdrew from {story.season.name} before round{" "}
              {w.round}: bankrupt. {w.reason}
            </p>
          ))}
          <p className="text-sm">
            {forfeit.kind === "void"
              ? "Neither club gets points. The fixture isn't simulated."
              : `${forfeit.awardedTo?.name ?? "The opponent"} get 3 points by walkover, with no goals for either side. The fixture isn't simulated: there is no replay, lineup or goals, and nobody's record changes.`}
          </p>
          <p className="text-sm">
            <Link to="/table" className="font-semibold text-violet-deep underline-offset-4 hover:underline">
              The table <span aria-hidden>→</span>
            </Link>
          </p>
        </section>
      )}

      <section aria-labelledby="build-up" className="scroll-mt-24 space-y-4">
        <SectionHeader id="build-up" title="Build-up" meta={done ? "As it stood before kick-off" : undefined} />
        <div className="grid gap-4 lg:grid-cols-2">
          <StoryCard story={story} mode="before" headingId="why-it-matters" as="h3" />
          <div className="card-surface space-y-4 p-4">
            <h3 className="font-display text-lg font-extrabold uppercase italic">The dugouts</h3>
            {forfeit ? (
              <p className="text-sm">No decisions: neither manager picks a side for a fixture that won't be played.</p>
            ) : (
              <>
                <Decision side={home} />
                <Decision side={away} />
              </>
            )}
            {contrast.length > 0 && (
              <div className="border-t border-line pt-3 text-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-text">
                  How they've managed so far (patterns in the record)
                </p>
                <ul className="mt-1 space-y-1">
                  {contrast.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        {!done && (profiles.home || profiles.away) && (
          <details className="card-surface group p-4">
            <summary className="cursor-pointer font-semibold text-violet-deep">The managers' full stories</summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              {profiles.home && <ManagerArc profile={profiles.home} compact />}
              {profiles.away && <ManagerArc profile={profiles.away} compact />}
            </div>
          </details>
        )}
      </section>

      <section aria-labelledby="watch" className="scroll-mt-24 space-y-3">
        <SectionHeader id="watch" title="Watch" meta={replay ? "Recorded replay of the official match" : undefined} />
        {replay && story.match && detail ? (
          <MatchViewer
            replayUrl={`/matches/${story.match.id}/replay.json.gz`}
            home={home.team}
            away={away.team}
            events={detail.events}
            playerNames={names}
            lineups={detail.lineups}
          />
        ) : note ? (
          <EmptyState title={note.title}>{note.body}</EmptyState>
        ) : null}
        {story.match && (
          <p className="text-sm">
            <Link
              to={`/matches/${story.match.id}`}
              className="font-semibold text-violet-deep underline-offset-4 hover:underline"
            >
              Match centre: statistics, lineups and the timeline <span aria-hidden>→</span>
            </Link>
          </p>
        )}
      </section>

      <section aria-labelledby="reaction" className="scroll-mt-24 space-y-4">
        <SectionHeader id="reaction" title="Reaction" />
        {story.postmatch ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <StoryCard story={story} mode="after" headingId="what-changed" as="h3" />
            <div className="card-surface space-y-4 p-4">
              <h3 className="font-display text-lg font-extrabold uppercase italic">What's next</h3>
              {[home, away].map((s) =>
                s.next ? (
                  <p key={s.team.id} className="text-sm">
                    <span className="font-semibold">{s.team.name}</span>: round {s.next.round},{" "}
                    {s.next.venue === "home" ? `${s.next.opponent.name} at home` : `away at ${s.next.opponent.name}`} ·{" "}
                    {kickoffUtc(s.next.scheduledAt)}.{" "}
                    <Link
                      to={matchdayHref(s.next.fixtureId)}
                      className="font-semibold text-violet-deep underline-offset-4 hover:underline"
                    >
                      Next matchday <span aria-hidden>→</span>
                    </Link>
                  </p>
                ) : (
                  <p key={s.team.id} className="text-sm">
                    <span className="font-semibold">{s.team.name}</span>: season complete.
                  </p>
                ),
              )}
            </div>
          </div>
        ) : forfeit ? (
          <EmptyState title="No match, no reaction">
            A forfeited fixture has no result to react to: no reflections, no match report.
          </EmptyState>
        ) : (
          <EmptyState title="After full time">
            The result, the table movement, both managers' reflections and the match report appear here once the
            official result is recorded.
          </EmptyState>
        )}
      </section>
      <p className="text-xs text-muted-text">
        Everything here comes from the official league record: managers' and journalists' words are AI-written and
        labelled as such, and nothing is generated when this page loads.
      </p>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Matchday" />;
}
