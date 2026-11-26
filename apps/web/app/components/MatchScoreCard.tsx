import type { FixtureView } from "@autosoccer/contracts";
import { Link } from "react-router";
import { formatDate } from "../lib/format";
import { StatusChip } from "./StatusChip";
import { TeamBadge } from "./TeamBadge";

/**
 * A fixture that isn't played because a club withdrew (bankrupt): "W/O" (walkover) or "Void", and
 * a plain sentence saying who is awarded it.
 */
export function forfeitText(fixture: FixtureView): { mark: string; sentence: string } | null {
  const ff = fixture.forfeit;
  if (!ff) return null;
  if (ff.kind === "void") return { mark: "Void", sentence: "Not played: both clubs withdrew. No points." };
  const to = ff.awardedTo === fixture.home.id ? fixture.home : fixture.away;
  return { mark: "W/O", sentence: `Walkover to ${to.name}: 3 points, no goals.` };
}

function ForfeitMark({ mark, sentence }: { mark: string; sentence: string }) {
  return (
    <span
      className="rounded-md bg-coral px-2 py-0.5 font-display text-lg font-extrabold text-ink"
      title={sentence}
      aria-hidden
    >
      {mark}
    </span>
  );
}

function Side({
  team,
  score,
  winner,
  align,
}: {
  team: FixtureView["home"];
  score: number | null;
  winner: boolean;
  align: "start" | "end";
}) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${align === "end" ? "flex-row-reverse text-right" : ""}`}>
      <TeamBadge team={team} size="md" decorative />
      <span className={`truncate text-sm sm:text-base ${winner ? "font-bold" : "font-medium"}`}>{team.name}</span>
      {score !== null && (
        <span
          className={`tabular ml-auto font-display text-3xl font-extrabold ${align === "end" ? "ml-0 mr-auto" : ""}`}
        >
          {score}
        </span>
      )}
    </div>
  );
}

/** Large result/fixture card used on the homepage and team pages. */
export function MatchScoreCard({ fixture }: { fixture: FixtureView }) {
  const s = fixture.score;
  const homeWin = !!s && s.home > s.away;
  const awayWin = !!s && s.away > s.home;
  const label = s
    ? `${fixture.home.name} ${s.home}, ${fixture.away.name} ${s.away}`
    : `${fixture.home.name} versus ${fixture.away.name}`;
  const body = (
    <>
      <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-text">
        <span>Round {fixture.round}</span>
        <StatusChip status={fixture.status} />
      </div>
      <div className="grid gap-2">
        <Side team={fixture.home} score={s ? s.home : null} winner={homeWin} align="start" />
        <Side team={fixture.away} score={s ? s.away : null} winner={awayWin} align="start" />
      </div>
    </>
  );
  return fixture.matchId ? (
    <Link
      to={`/matches/${fixture.matchId}`}
      aria-label={`${label}, round ${fixture.round}. Open match centre`}
      className="card-surface block p-4 transition hover:-translate-y-0.5 hover:shadow-lg"
      data-testid="match-score-card"
    >
      {body}
    </Link>
  ) : (
    <article aria-label={label} className="card-surface p-4" data-testid="match-score-card">
      {body}
    </article>
  );
}

/** Compact single-line fixture row for lists (fixtures page, team page). */
export function FixtureCard({ fixture }: { fixture: FixtureView }) {
  const s = fixture.score;
  const ff = forfeitText(fixture);
  const awarded = fixture.forfeit?.awardedTo;
  const inner = (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4">
      <div className="flex min-w-0 items-center justify-end gap-2 text-right">
        <span
          className={`truncate text-sm sm:text-base ${(s && s.home > s.away) || awarded === fixture.home.id ? "font-bold" : ""}`}
        >
          {fixture.home.name}
        </span>
        <TeamBadge team={fixture.home} size="sm" decorative />
      </div>
      <div className="flex min-w-[4.5rem] flex-col items-center">
        {s ? (
          <span className="tabular rounded-md bg-ink px-2 py-0.5 font-display text-xl font-extrabold text-white">
            {s.home}–{s.away}
          </span>
        ) : ff ? (
          <ForfeitMark {...ff} />
        ) : (
          <span className="rounded-md border border-line px-2 py-0.5 font-display text-lg font-bold text-muted-text">
            v
          </span>
        )}
        <span className="mt-1">
          {ff ? (
            <span className="block max-w-[11rem] text-center text-xs font-semibold text-muted-text">{ff.sentence}</span>
          ) : !s && fixture.status === "scheduled" && fixture.scheduledAt ? (
            <time dateTime={fixture.scheduledAt} className="text-xs font-semibold text-muted-text">
              {formatDate(fixture.scheduledAt, { weekday: true, time: true })}
            </time>
          ) : (
            <StatusChip status={fixture.status} />
          )}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <TeamBadge team={fixture.away} size="sm" decorative />
        <span
          className={`truncate text-sm sm:text-base ${(s && s.away > s.home) || awarded === fixture.away.id ? "font-bold" : ""}`}
        >
          {fixture.away.name}
        </span>
      </div>
    </div>
  );
  const label = s
    ? `${fixture.home.name} ${s.home}, ${fixture.away.name} ${s.away}`
    : ff
      ? `${fixture.home.name} versus ${fixture.away.name}. ${ff.sentence}`
      : `${fixture.home.name} versus ${fixture.away.name}`;
  if (ff)
    return (
      <Link
        to={`/matchday/${fixture.id}`}
        aria-label={`${label} Open matchday`}
        className="card-surface block px-3 py-3 hover:bg-canvas sm:px-4"
        data-testid="fixture-card"
      >
        {inner}
      </Link>
    );
  return fixture.matchId ? (
    <Link
      to={`/matches/${fixture.matchId}`}
      aria-label={`${label}. Open match centre`}
      className="card-surface block px-3 py-3 hover:bg-canvas sm:px-4"
      data-testid="fixture-card"
    >
      {inner}
    </Link>
  ) : (
    <div aria-label={label} role="group" className="card-surface px-3 py-3 sm:px-4" data-testid="fixture-card">
      {inner}
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * One-line schedule row (mockup "UPCOMING MATCHES"): matchweek chip, crests and names, then the
 * kick-off time, or the score once played.
 */
export function FixtureRow({ fixture }: { fixture: FixtureView }) {
  const s = fixture.score;
  const ff = forfeitText(fixture);
  const label = s
    ? `Matchweek ${fixture.round}: ${fixture.home.name} ${s.home}, ${fixture.away.name} ${s.away}`
    : ff
      ? `Matchweek ${fixture.round}: ${fixture.home.name} versus ${fixture.away.name}. ${ff.sentence}`
      : `Matchweek ${fixture.round}: ${fixture.home.name} versus ${fixture.away.name}`;
  const inner = (
    <>
      <span className="tabular shrink-0 rounded-md bg-lavender px-2 py-1 font-semi text-base font-bold text-slate-violet">
        MW{pad2(fixture.round)}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 font-semi text-xl font-bold" aria-hidden>
        <TeamBadge team={fixture.home} size="sm" decorative />
        <span>{fixture.home.shortName}</span>
        <span className="shrink-0 text-sm font-semibold text-muted-text">
          {s ? (
            <span className="tabular font-semi text-lg font-extrabold text-ink">{`${s.home}–${s.away}`}</span>
          ) : ff ? (
            <span className="rounded bg-coral px-1 font-semi text-sm font-extrabold text-ink">{ff.mark}</span>
          ) : (
            "vs"
          )}
        </span>
        <span>{fixture.away.shortName}</span>
        <TeamBadge team={fixture.away} size="sm" decorative />
      </span>
      <span className="tabular shrink-0 text-right text-sm font-semibold">
        {ff ? (
          <span className="text-muted-text">{fixture.forfeit?.kind === "void" ? "Void" : "Walkover"}</span>
        ) : s ? (
          <StatusChip status={fixture.status} />
        ) : fixture.scheduledAt ? (
          // Date over time, so a narrow panel keeps room for the team names.
          <time dateTime={fixture.scheduledAt} className="flex flex-col leading-tight">
            <span>{formatDate(fixture.scheduledAt, { weekday: true })}</span>
            <span className="text-muted-text">{formatDate(fixture.scheduledAt, { time: true }).split(", ")[1]}</span>
          </time>
        ) : (
          <StatusChip status={fixture.status} />
        )}
      </span>
    </>
  );
  const cls = "flex items-center gap-3 border-b border-line px-1 py-2.5 last:border-0";
  return (
    <li>
      {fixture.matchId ? (
        <Link
          to={`/matches/${fixture.matchId}`}
          aria-label={`${label}. Open match centre`}
          className={`${cls} hover:bg-canvas`}
        >
          {inner}
        </Link>
      ) : (
        <div aria-label={label} role="group" className={cls} data-testid="fixture-row">
          {inner}
        </div>
      )}
    </li>
  );
}
