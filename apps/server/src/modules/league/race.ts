/**
 * The title race, from the table and the fixtures still to play: who can still finish first, and
 * whether someone already has. A team is caught only on points it can actually reach, so a leader
 * has clinched once nobody else can reach its points total (a tie on points could still go either
 * way on tie-breaks, so it doesn't count as clinched).
 */
export interface RaceInput {
  rows: Array<{ teamId: string; points: number }>;
  /** Matches each team has left. */
  remaining: Map<string, number>;
}

export interface Race {
  /** Teams that can still finish top, leader first. */
  contenders: string[];
  /** The champion once nobody can catch them (before or at the end of the season), else null. */
  clinched: string | null;
}

export function titleRace({ rows, remaining }: RaceInput): Race {
  if (!rows.length) return { contenders: [], clinched: null };
  const leader = rows[0]!;
  const max = (r: RaceInput["rows"][number]) => r.points + 3 * (remaining.get(r.teamId) ?? 0);
  const contenders = rows.filter((r) => r === leader || max(r) >= leader.points).map((r) => r.teamId);
  const rivalsCanReach = rows.slice(1).some((r) => max(r) >= leader.points);
  const done = rows.every((r) => (remaining.get(r.teamId) ?? 0) === 0);
  // At the end of the season the table's tie-breaks decide it; before then only a points lead nobody can reach does.
  const clinched = done || !rivalsCanReach ? leader.teamId : null;
  return { contenders: clinched ? [leader.teamId] : contenders, clinched };
}
