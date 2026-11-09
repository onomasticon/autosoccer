import type { FixtureView } from "@autosoccer/contracts";

export interface Ticker {
  matchweek: number | null;
  /** Fixtures of the matchweek (results once played). */
  fixtures: FixtureView[];
  /** The next unplayed fixture after the matchweek, if any. */
  next: FixtureView | null;
}

/**
 * Matchweek for the ticker: a round in progress if there is one, otherwise the latest round with a
 * result (round 1 before kick-off); its fixtures; and the next fixture still to be played after it.
 */
export function tickerFixtures(rounds: Array<{ round: number; fixtures: FixtureView[] }>): Ticker {
  if (!rounds.length) return { matchweek: null, fixtures: [], next: null };
  const played = rounds.filter((r) => r.fixtures.some((f) => f.status === "completed"));
  const live = rounds.find((r) => r.fixtures.some((f) => f.status === "playing" || f.status === "ready"));
  const current = live ?? played.at(-1) ?? rounds[0]!;
  const next =
    rounds
      .filter((r) => r.round > current.round)
      .flatMap((r) => r.fixtures)
      .find((f) => f.status !== "completed") ?? null;
  return { matchweek: current.round, fixtures: current.fixtures, next };
}
