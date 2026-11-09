import { createHash } from "node:crypto";

export interface ScheduledFixture {
  round: number;
  home: string;
  away: string;
}

/** Single round robin by the circle method (n − 1 rounds). */
function circle(teams: readonly string[]): ScheduledFixture[] {
  const n = teams.length;
  const rot = [...teams];
  const out: ScheduledFixture[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = rot[i]!;
      const b = rot[n - 1 - i]!;
      const swap = i === 0 ? r % 2 === 1 : (r + i) % 2 === 1;
      out.push({ round: r + 1, home: swap ? b : a, away: swap ? a : b });
    }
    rot.splice(1, 0, rot.pop()!);
  }
  return out;
}

/** Longest run of consecutive home (or away) games for any team, and the total number of breaks. */
export function venueRuns(fixtures: readonly ScheduledFixture[], teams: readonly string[]) {
  let maxRun = 0;
  let breaks = 0;
  for (const t of teams) {
    const v = fixtures
      .filter((f) => f.home === t || f.away === t)
      .sort((a, b) => a.round - b.round)
      .map((f) => (f.home === t ? "H" : "A"));
    let run = 1;
    for (let i = 1; i < v.length; i++) {
      if (v[i] === v[i - 1]) {
        run++;
        breaks++;
      } else run = 1;
      maxRun = Math.max(maxRun, run);
    }
  }
  return { maxRun, breaks };
}

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/**
 * Double round robin: a circle-method first leg, then the same pairings with home and away
 * swapped. Every ordered pairing occurs exactly once, every team plays once per round and
 * has n − 1 home games. For small leagues (≤ 4 teams, i.e. the MVP) a deterministic search
 * over first-leg venues and second-leg round order minimises consecutive home/away runs
 * (four teams: never three in a row). Deterministic in the input order.
 */
export function doubleRoundRobin(teams: readonly string[]): ScheduledFixture[] {
  if (teams.length < 2 || teams.length % 2 !== 0) throw new Error("need an even number of teams (≥ 2)");
  if (new Set(teams).size !== teams.length) throw new Error("duplicate team");
  const n = teams.length;
  const base = circle(teams);
  const build = (mask: number, order: number[]) => {
    const first = base.map((f, i) => ((mask >> i) & 1 ? { round: f.round, home: f.away, away: f.home } : f));
    const second = first.map((f) => ({ round: n - 1 + order.indexOf(f.round) + 1, home: f.away, away: f.home }));
    return [...first, ...second];
  };
  const identity = Array.from({ length: n - 1 }, (_, i) => i + 1);
  if (base.length > 10) return build(0, identity);
  let best = build(0, identity);
  let score = venueRuns(best, teams);
  for (let mask = 0; mask < 1 << base.length; mask++) {
    for (const order of permutations(identity)) {
      const cand = build(mask, order);
      const s = venueRuns(cand, teams);
      if (s.maxRun < score.maxRun || (s.maxRun === score.maxRun && s.breaks < score.breaks)) {
        best = cand;
        score = s;
      }
    }
  }
  return best;
}

/** Per-fixture simulator seed derived from the season seed: stable, uniform uint32. */
export function fixtureSeed(seasonSeed: number, round: number, homeSlug: string, awaySlug: string): number {
  const h = createHash("sha256").update(`${seasonSeed}:${round}:${homeSlug}:${awaySlug}`).digest();
  return h.readUInt32BE(0);
}

/** Deterministic team order for a season (seeded shuffle), so the seed alone decides the calendar. */
export function seededOrder<T extends { slug: string }>(teams: readonly T[], seed: number): T[] {
  const key = (t: T) => createHash("sha256").update(`${seed}:${t.slug}`).digest("hex");
  return [...teams].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
