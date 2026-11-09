import type { FixtureView } from "@autosoccer/contracts";

/**
 * Matchweek for the ticker: the earliest round with unfinished fixtures (or the last round
 * once the season is over). Shows the previous round's results followed by that round.
 */
export function tickerFixtures(rounds: Array<{ round: number; fixtures: FixtureView[] }>): {
  matchweek: number | null;
  fixtures: FixtureView[];
} {
  if (!rounds.length) return { matchweek: null, fixtures: [] };
  const current = rounds.find((r) => r.fixtures.some((f) => f.status !== "completed")) ?? rounds[rounds.length - 1]!;
  const prev = rounds.find((r) => r.round === current.round - 1);
  return { matchweek: current.round, fixtures: [...(prev?.fixtures ?? []), ...current.fixtures] };
}
