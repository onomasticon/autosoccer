import type { FixtureView } from "@autosoccer/contracts";
import { Link } from "react-router";
import { Loading, Skeleton } from "./States";
import { StatusChip } from "./StatusChip";
import { TeamBadge } from "./TeamBadge";

function TickerItem({ f }: { f: FixtureView }) {
  const s = f.score;
  const row = (team: FixtureView["home"], goals: number | undefined, win: boolean) => (
    <div className="flex items-center gap-2">
      <TeamBadge team={team} size="xs" decorative />
      <span className={`w-10 text-sm ${win ? "font-bold" : ""}`}>{team.shortName}</span>
      <span className="tabular ml-auto w-4 text-right font-display text-lg font-bold">{goals ?? ""}</span>
    </div>
  );
  const content = (
    <>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-text">R{f.round}</span>
        <StatusChip status={f.status} />
      </div>
      {row(f.home, s?.home, !!s && s.home > s.away)}
      {row(f.away, s?.away, !!s && s.away > s.home)}
    </>
  );
  const label = s
    ? `Round ${f.round}: ${f.home.name} ${s.home}, ${f.away.name} ${s.away}`
    : `Round ${f.round}: ${f.home.name} versus ${f.away.name}`;
  return (
    <li className="w-40 shrink-0 snap-start">
      {f.matchId ? (
        <Link
          to={`/matches/${f.matchId}`}
          aria-label={label}
          className="block rounded-lg bg-surface px-3 py-2 shadow-sm ring-1 ring-line hover:ring-violet"
        >
          {content}
        </Link>
      ) : (
        <div aria-label={label} role="group" className="rounded-lg bg-surface px-3 py-2 ring-1 ring-line">
          {content}
        </div>
      )}
    </li>
  );
}

export interface ScoreTickerProps {
  fixtures: FixtureView[] | null;
  matchweek?: number | null;
  loading?: boolean;
}

/** Matchweek/results strip under the global navigation. Scrolls horizontally on small screens. */
export function ScoreTicker({ fixtures, matchweek, loading }: ScoreTickerProps) {
  return (
    <section aria-label="Scores" className="border-b border-line bg-canvas">
      <div className="mx-auto flex max-w-[1440px] items-stretch gap-3 px-4 py-3 sm:px-6">
        <div className="flex shrink-0 flex-col justify-center rounded-lg bg-yellow px-3 py-2 text-ink">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em]">Matchweek</span>
          <span className="tabular font-display text-2xl font-extrabold italic leading-none">{matchweek ?? "–"}</span>
        </div>
        {loading ? (
          <Loading label="Loading scores">
            <div className="flex min-w-0 gap-3 overflow-hidden">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[76px] w-40" />
              ))}
            </div>
          </Loading>
        ) : !fixtures?.length ? (
          <p className="self-center text-sm text-muted-text" data-testid="empty-state">
            No fixtures scheduled yet.
          </p>
        ) : (
          <ul
            className="relative flex min-w-0 flex-1 snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]"
            data-testid="score-ticker"
          >
            {fixtures.map((f) => (
              <TickerItem key={f.id} f={f} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
