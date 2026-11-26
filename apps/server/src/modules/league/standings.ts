export interface Result {
  round: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  /**
   * A fixture that wasn't played (insolvency/1): "home"/"away" is the side awarded a walkover (3
   * points, no goals); "void" (both clubs withdrawn) counts for nobody.
   */
  walkover?: "home" | "away" | "void";
}

export interface Standing {
  team: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: Array<"W" | "D" | "L">;
  /** Wins awarded by walkover, and fixtures forfeited (included in won / lost and played). */
  walkovers: number;
  forfeits: number;
  /** Set when the club withdrew (bankrupt): the first round it didn't play. */
  withdrawnFrom: number | null;
}

export const POINTS = { win: 3, draw: 1, loss: 0 } as const;

function tally(teams: readonly string[], results: readonly Result[]) {
  const rows = new Map<string, Omit<Standing, "position">>(
    teams.map((t) => [
      t,
      {
        team: t,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
        form: [],
        walkovers: 0,
        forfeits: 0,
        withdrawnFrom: null,
      },
    ]),
  );
  for (const r of [...results].sort((a, b) => a.round - b.round)) {
    const h = rows.get(r.home);
    const a = rows.get(r.away);
    if (!h || !a) continue;
    if (r.walkover) {
      if (r.walkover === "void") continue;
      const [w, l] = r.walkover === "home" ? [h, a] : [a, h];
      w.played++;
      w.won++;
      w.walkovers++;
      w.points += POINTS.win;
      w.form = [...w.form, "W" as const].slice(-5);
      l.played++;
      l.lost++;
      l.forfeits++;
      l.form = [...l.form, "L" as const].slice(-5);
      continue;
    }
    for (const [row, gf, ga] of [
      [h, r.homeGoals, r.awayGoals],
      [a, r.awayGoals, r.homeGoals],
    ] as const) {
      row.played++;
      row.goalsFor += gf;
      row.goalsAgainst += ga;
      row.goalDifference = row.goalsFor - row.goalsAgainst;
      const res: "W" | "D" | "L" = gf > ga ? "W" : gf === ga ? "D" : "L";
      if (res === "W") row.won++;
      else if (res === "D") row.drawn++;
      else row.lost++;
      row.points += res === "W" ? POINTS.win : res === "D" ? POINTS.draw : POINTS.loss;
      row.form = [...row.form, res].slice(-5);
    }
  }
  return rows;
}

/**
 * League table. Order: points → goal difference → goals for → head-to-head points →
 * head-to-head goal difference → head-to-head goals for (among the tied teams only) →
 * name (a stable, documented last resort). Withdrawn clubs (insolvency/1) are placed below every club
 * still in the season, in the same order among themselves: they can't win the title or a finishing prize.
 */
export function computeStandings(
  teams: readonly string[],
  results: readonly Result[],
  nameOf: (t: string) => string = (t) => t,
  withdrawn: ReadonlyMap<string, number> = new Map(),
): Standing[] {
  const rows = tally(teams, results);
  for (const [t, round] of withdrawn) {
    const row = rows.get(t);
    if (row) row.withdrawnFrom = round;
  }
  const key = (r: Omit<Standing, "position">) => [r.points, r.goalDifference, r.goalsFor];
  const cmp = (x: number[], y: number[]) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i]! - x[i]!;
    return 0;
  };
  const sorted = [...rows.values()].sort((a, b) => cmp(key(a), key(b)));
  // Resolve groups tied on the overall criteria with a head-to-head mini-table.
  const out: Array<Omit<Standing, "position">> = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && cmp(key(sorted[i]!), key(sorted[j]!)) === 0) j++;
    const group = sorted.slice(i, j);
    if (group.length > 1) {
      const names = new Set(group.map((g) => g.team));
      const h2h = tally(
        [...names],
        results.filter((r) => names.has(r.home) && names.has(r.away)),
      );
      group.sort(
        (a, b) => cmp(key(h2h.get(a.team)!), key(h2h.get(b.team)!)) || nameOf(a.team).localeCompare(nameOf(b.team)),
      );
    }
    out.push(...group);
    i = j;
  }
  const ordered = [...out.filter((r) => r.withdrawnFrom === null), ...out.filter((r) => r.withdrawnFrom !== null)];
  return ordered.map((r, i) => ({ ...r, position: i + 1 }));
}
