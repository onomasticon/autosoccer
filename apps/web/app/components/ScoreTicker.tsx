import type { FixtureView } from "@autosoccer/contracts";
import { Link } from "react-router";
import { formatDate } from "../lib/format";
import { Loading, Skeleton } from "./States";
import { StatusChip } from "./StatusChip";
import { TeamBadge } from "./TeamBadge";

const pad = (n: number) => String(n).padStart(2, "0");

function TickerItem({ f }: { f: FixtureView }) {
  const s = f.score;
  const content = (
    <>
      <TeamBadge team={f.home} size="sm" decorative />
      <span className={`font-display text-lg uppercase ${s && s.home > s.away ? "font-extrabold" : "font-bold"}`}>
        {f.home.shortName}
      </span>
      <span className="tabular px-1 font-display text-xl font-extrabold">{s ? `${s.home} – ${s.away}` : "v"}</span>
      <span className={`font-display text-lg uppercase ${s && s.away > s.home ? "font-extrabold" : "font-bold"}`}>
        {f.away.shortName}
      </span>
      <TeamBadge team={f.away} size="sm" decorative />
      <span className="ml-1">
        <StatusChip status={f.status} />
      </span>
    </>
  );
  const label = s
    ? `Round ${f.round}: ${f.home.name} ${s.home}, ${f.away.name} ${s.away}`
    : `Round ${f.round}: ${f.home.name} versus ${f.away.name}`;
  const cls = "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1";
  return (
    <li className="flex shrink-0 items-center border-l-2 border-lavender-strong first:border-l-0">
      {f.matchId ? (
        <Link to={`/matches/${f.matchId}`} aria-label={label} className={`${cls} hover:bg-white/70`}>
          {content}
        </Link>
      ) : (
        <div aria-label={label} role="group" className={cls}>
          {content}
        </div>
      )}
    </li>
  );
}

export interface ScoreTickerProps {
  fixtures: FixtureView[] | null;
  matchweek?: number | null;
  next?: FixtureView | null;
  loading?: boolean;
}

/** Broadcast matchweek bar under the global navigation. Scrolls horizontally on small screens. */
export function ScoreTicker({ fixtures, matchweek, next, loading }: ScoreTickerProps) {
  return (
    <section aria-label="Scores" className="mx-auto max-w-[1440px] px-4 pb-2 sm:px-6">
      <div className="flex min-h-14 items-stretch overflow-hidden rounded-xl bg-lavender">
        <p className="parallelogram-start flex shrink-0 items-center bg-yellow py-2 pl-4 pr-7 font-display text-lg font-extrabold uppercase italic leading-none text-ink sm:text-xl">
          <span className="hidden sm:inline">Matchweek&nbsp;</span>
          <span className="sm:hidden">MW&nbsp;</span>
          <span className="tabular">{matchweek ? pad(matchweek) : "–"}</span>
        </p>
        {loading ? (
          <Loading label="Loading scores">
            <div className="flex min-w-0 items-center gap-3 overflow-hidden px-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-7 w-48" />
              ))}
            </div>
          </Loading>
        ) : !fixtures?.length ? (
          <p className="self-center px-4 text-sm text-muted-text" data-testid="empty-state">
            No fixtures scheduled yet.
          </p>
        ) : (
          <ul
            className="relative flex min-w-0 flex-1 items-center overflow-x-auto px-2 py-2 [scrollbar-width:thin]"
            data-testid="score-ticker"
            aria-label={`Matchweek ${matchweek ?? ""} fixtures`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the strip scrolls horizontally, so keyboard users must be able to focus it
            tabIndex={0}
          >
            {fixtures.map((f) => (
              <TickerItem key={f.id} f={f} />
            ))}
            {next && (
              <li
                className="flex shrink-0 items-center gap-2 whitespace-nowrap border-l-2 border-lavender-strong px-3 font-display text-lg font-bold uppercase lg:ml-auto"
                data-testid="ticker-next"
              >
                <span className="font-extrabold">Next:</span>
                <span>
                  {next.home.shortName} <span className="text-sm text-muted-text">vs</span> {next.away.shortName}
                  <span className="sr-only">
                    {" "}
                    ({next.home.name} versus {next.away.name})
                  </span>
                </span>
                {next.scheduledAt && (
                  <time
                    dateTime={next.scheduledAt}
                    className="rounded-md bg-lavender-strong px-2 py-0.5 text-base text-violet-deep"
                  >
                    {formatDate(next.scheduledAt, { weekday: true, time: true, date: false })}
                  </time>
                )}
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
