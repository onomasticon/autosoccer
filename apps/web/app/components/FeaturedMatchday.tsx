import type { FixtureView } from "@autosoccer/contracts";
import { Link } from "react-router";
import { featuredFixture, kickoffUtc, matchdayHref } from "../lib/matchday";
import { TeamBadge } from "./TeamBadge";

/**
 * One-line homepage call to action for the featured matchday: the next fixture's build-up (or the
 * match being played), else the latest result's reaction. Deliberately compact: the matchday page
 * is the immersive experience.
 */
export function FeaturedMatchday({ fixtures }: { fixtures: readonly FixtureView[] }) {
  const f = featuredFixture(fixtures);
  if (!f) return null;
  const done = f.status === "completed" && f.score;
  const act = done ? "Reaction" : f.status === "playing" ? "Being simulated" : "Build-up";
  return (
    <Link
      to={matchdayHref(f.id)}
      className="card-surface flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-lg"
      data-testid="featured-matchday"
    >
      <span className="rounded-md bg-coral px-2 py-0.5 font-display text-sm font-extrabold uppercase italic text-ink">
        Matchday
      </span>
      <span className="flex min-w-0 items-center gap-2 font-semibold">
        <TeamBadge team={f.home} size="sm" decorative />
        {f.home.name}
        <span className="tabular rounded bg-ink px-1.5 text-white">
          {done ? `${f.score!.home}–${f.score!.away}` : "v"}
        </span>
        {f.away.name}
        <TeamBadge team={f.away} size="sm" decorative />
      </span>
      <span className="text-sm text-muted-text">
        Round {f.round} · {done ? "full time" : kickoffUtc(f.scheduledAt)}
      </span>
      <span className="ml-auto text-sm font-semibold text-violet-deep">
        {act} <span aria-hidden>→</span>
      </span>
    </Link>
  );
}
