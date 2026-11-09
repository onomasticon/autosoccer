export interface Result {
  round: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
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
      },
    ]),
  );
  for (const r of [...results].sort((a, b) => a.round - b.round)) {
    const h = rows.get(r.home);
    const a = rows.get(r.away);
    if (!h || !a) continue;
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
 * name (a stable, documented last resort).
 */
export function computeStandings(
  teams: readonly string[],
  results: readonly Result[],
  nameOf: (t: string) => string = (t) => t,
): Standing[] {
  const rows = tally(teams, results);
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
  return out.map((r, i) => ({ ...r, position: i + 1 }));
}
