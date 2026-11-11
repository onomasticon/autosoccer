/**
 * Official facts projection. Editorial agents may only write from these: persisted official
 * events and stats, standings computed from recorded results, lineups, deployed tactics
 * (with the manager's recorded rationale) and form. Every fact has a stable id so an article
 * can cite it, and a source pointing at the record it came from.
 */
import {
  describeTactics,
  type EditorialFacts,
  type Fact,
  type OfficialEvent,
  TacticalConfigV1,
  type TeamMatchStats,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { standingRows } from "../league/read.ts";

const clock = (e: { period: string; clockSec: number }) =>
  `${e.period === "firstHalf" ? "first" : "second"} half, ${Math.floor(e.clockSec / 60)}:${String(Math.floor(e.clockSec % 60)).padStart(2, "0")}`;

interface MatchRow {
  id: string;
  season_id: string;
  round: number;
  fixture_id: string;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
  home_score: number;
  away_score: number;
  final_hash: string;
  events: OfficialEvent[];
  stats: { home: TeamMatchStats; away: TeamMatchStats };
  request: {
    home: {
      starters: Array<{ playerId: string; name: string; position: string }>;
      deployment: { kind: string; config: Record<string, unknown> };
    };
    away: {
      starters: Array<{ playerId: string; name: string; position: string }>;
      deployment: { kind: string; config: Record<string, unknown> };
    };
  };
  home_revision_id: string | null;
  away_revision_id: string | null;
}

const tacticsText = (d: { kind: string; config: Record<string, unknown> }) => {
  if (d.kind !== "tactical" || Object.keys(d.config).length === 0) return "the league baseline tactics";
  const t = TacticalConfigV1.safeParse(d.config);
  return t.success ? describeTactics(t.data) : "an unrecognised setup";
};

async function loadMatch(db: Db, matchId: string): Promise<MatchRow> {
  const [m] = await db<MatchRow[]>`
    select m.id, f.season_id, f.round, f.id as fixture_id, f.home_team_id, f.away_team_id, h.name as home_name, a.name as away_name,
      m.home_score, m.away_score, m.final_hash, m.events, m.stats, m.request, m.home_revision_id, m.away_revision_id
    from matches m join fixtures f on f.id = m.fixture_id
    join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
    where m.id = ${matchId} and m.status = 'completed'`;
  if (!m) throw new Error(`match ${matchId} has no official result`);
  return m;
}

/** Standings facts after a round (computed from official results). */
async function standingFacts(db: Db, seasonId: string, round: number): Promise<Fact[]> {
  const { rows } = await standingRows(db, seasonId);
  return rows.map((r) => ({
    id: `standing:${seasonId}:r${round}:${r.team.slug}`,
    kind: "standing" as const,
    statement: `${r.team.name} are ${ordinal(r.position)} with ${r.points} point${r.points === 1 ? "" : "s"} from ${r.played} match${r.played === 1 ? "" : "es"} (W${r.won} D${r.drawn} L${r.lost}, goal difference ${r.goalDifference >= 0 ? "+" : ""}${r.goalDifference}); form ${r.form.join("") || "–"}`,
    value: {
      position: r.position,
      points: r.points,
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalDifference: r.goalDifference,
      form: r.form,
    },
    source: { table: "matches", id: `season:${seasonId}` },
  }));
}

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/** Facts for one official match (plus the table after its round). */
export async function matchFacts(db: Db, matchId: string): Promise<EditorialFacts> {
  const m = await loadMatch(db, matchId);
  const names = new Map([...m.request.home.starters, ...m.request.away.starters].map((s) => [s.playerId, s.name]));
  const side = (s: "home" | "away") => (s === "home" ? m.home_name : m.away_name);
  const facts: Fact[] = [];
  const src = { table: "matches", id: m.id };
  const winner = m.home_score === m.away_score ? null : m.home_score > m.away_score ? "home" : "away";
  facts.push({
    id: `match:${m.id}:score`,
    kind: "score",
    statement: `Final score (round ${m.round}): ${m.home_name} ${m.home_score}–${m.away_score} ${m.away_name}${winner ? `; ${side(winner)} won` : "; a draw"}`,
    value: { home: m.home_score, away: m.away_score },
    source: src,
  });
  let n = 0;
  for (const e of m.events) {
    if (e.type !== "goal") continue;
    n++;
    const scorer = e.scorerId ? (names.get(e.scorerId) ?? "an unidentified player") : "an unidentified player";
    const conceding = e.side === "home" ? m.away_name : m.home_name;
    facts.push({
      id: `match:${m.id}:goal:${n}`,
      kind: "goal",
      statement: e.ownGoal
        ? `Goal ${n}: own goal by ${scorer} of ${conceding} (${clock(e)}), credited to ${side(e.side)}; score ${m.home_name} ${e.score.home}–${e.score.away} ${m.away_name}`
        : `Goal ${n}: ${scorer} scored for ${side(e.side)} (${clock(e)}); score ${m.home_name} ${e.score.home}–${e.score.away} ${m.away_name}`,
      value: { scorer, side: e.side, ownGoal: e.ownGoal, period: e.period, clockSec: e.clockSec, score: e.score },
      source: src,
    });
  }
  if (n === 0)
    facts.push({ id: `match:${m.id}:goals`, kind: "goal", statement: "No goals were scored", value: 0, source: src });
  const stat = (key: keyof TeamMatchStats, label: string, fmt: (v: number) => string = String) =>
    facts.push({
      id: `match:${m.id}:stat:${key}`,
      kind: "stat",
      statement: `${label}: ${m.home_name} ${fmt(m.stats.home[key])}, ${m.away_name} ${fmt(m.stats.away[key])}`,
      value: { home: m.stats.home[key], away: m.stats.away[key] },
      source: src,
    });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  stat("possession", "Possession", pct);
  stat("shots", "Shots");
  stat("shotsOnTarget", "Shots on target");
  stat("passesCompleted", "Completed passes");
  stat("tacklesWon", "Tackles won");
  stat("interceptions", "Interceptions");
  stat("fouls", "Fouls");
  stat("avgTeamHeight", "Average team height (metres from own goal line)", (v) => v.toFixed(1));
  for (const s of ["home", "away"] as const) {
    const revId = s === "home" ? m.home_revision_id : m.away_revision_id;
    const [rev] = revId
      ? await db<
          { version: number; source: string }[]
        >`select version, source from tactical_revisions where id = ${revId}`
      : [];
    // The manager's free-text rationale is deliberately not a citable fact: it's model-written
    // and may mention unverified numbers. Only the deployed setup is official.
    facts.push({
      id: `match:${m.id}:tactics:${s}`,
      kind: "tactics",
      statement: `${side(s)} played ${tacticsText(m.request[s].deployment)}${rev ? ` (tactical revision v${rev.version}, set by ${rev.source === "manager" ? "their AI manager" : "the club's opening plan"})` : ""}`,
      value: { revisionVersion: rev?.version ?? null },
      source: { table: "tactical_revisions", id: revId ?? "baseline" },
    });
    facts.push({
      id: `match:${m.id}:lineup:${s}`,
      kind: "lineup",
      statement: `${side(s)} started: ${m.request[s].starters.map((p) => `${p.name} (${p.position})`).join(", ")}`,
      value: m.request[s].starters.map((p) => p.playerId),
      source: src,
    });
  }
  facts.push(...(await continuityFacts(db, m)));
  facts.push(...(await standingFacts(db, m.season_id, m.round)));
  return {
    contract: "editorial-facts/1",
    seasonId: m.season_id,
    matchId: m.id,
    generatedFrom: { resultFinalHash: m.final_hash, standingsAfterRound: m.round },
    match: {
      round: m.round,
      home: { teamId: m.home_team_id, name: m.home_name, score: m.home_score },
      away: { teamId: m.away_team_id, name: m.away_name, score: m.away_score },
      events: m.events,
      stats: m.stats,
      lineups: {
        home: m.request.home.starters.map((p) => ({ playerId: p.playerId, name: p.name, position: p.position })),
        away: m.request.away.starters.map((p) => ({ playerId: p.playerId, name: p.name, position: p.position })),
      },
    },
    facts,
  };
}

/**
 * Continuity from stored official history only (never more than the record shows):
 * earlier meetings between the two clubs this season, and each club's current run of form
 * going into and including this match. Nothing is emitted when there's no history.
 */
async function continuityFacts(db: Db, m: MatchRow): Promise<Fact[]> {
  const facts: Fact[] = [];
  const earlier = await db<
    { id: string; round: number; home_name: string; away_name: string; home_score: number; away_score: number }[]
  >`
    select m.id, f.round, h.name as home_name, a.name as away_name, m.home_score, m.away_score
    from matches m join fixtures f on f.id = m.fixture_id
    join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
    where f.season_id = ${m.season_id} and m.status = 'completed' and f.round < ${m.round}
      and ((f.home_team_id = ${m.home_team_id} and f.away_team_id = ${m.away_team_id})
        or (f.home_team_id = ${m.away_team_id} and f.away_team_id = ${m.home_team_id}))
    order by f.round`;
  for (const e of earlier)
    facts.push({
      id: `match:${e.id}:score`,
      kind: "score",
      statement: `Earlier meeting this season (round ${e.round}): ${e.home_name} ${e.home_score}–${e.away_score} ${e.away_name}`,
      value: { home: e.home_score, away: e.away_score, round: e.round },
      source: { table: "matches", id: e.id },
    });
  for (const [teamId, name] of [
    [m.home_team_id, m.home_name],
    [m.away_team_id, m.away_name],
  ] as const) {
    const results = await db<{ gf: number; ga: number }[]>`
      select case when f.home_team_id = ${teamId} then m.home_score else m.away_score end as gf,
             case when f.home_team_id = ${teamId} then m.away_score else m.home_score end as ga
      from matches m join fixtures f on f.id = m.fixture_id
      where f.season_id = ${m.season_id} and m.status = 'completed' and f.round <= ${m.round}
        and ${teamId}::uuid in (f.home_team_id, f.away_team_id)
      order by f.round desc`;
    if (results.length < 2) continue;
    const res = results.map((r) => (r.gf > r.ga ? "W" : r.gf === r.ga ? "D" : "L"));
    const run = (pred: (x: string) => boolean) => {
      let n = 0;
      while (n < res.length && pred(res[n]!)) n++;
      return n;
    };
    const wins = run((x) => x === "W");
    const unbeaten = run((x) => x !== "L");
    const winless = run((x) => x !== "W");
    const statement =
      wins >= 2
        ? `${name} have won their last ${wins} league matches`
        : unbeaten >= 2
          ? `${name} are unbeaten in their last ${unbeaten} league matches`
          : winless >= 2
            ? `${name} are without a win in their last ${winless} league matches`
            : null;
    if (statement)
      facts.push({
        id: `form:${m.season_id}:r${m.round}:${teamId}`,
        kind: "form",
        statement,
        value: { team: { id: teamId, name }, throughRound: m.round, recentFirst: res },
        source: { table: "matches", id: `season:${m.season_id}` },
      });
  }
  return facts;
}

/** Facts for a whole round: each match's score and key stats, plus the table afterwards. */
export async function roundFacts(
  db: Db,
  seasonId: string,
  round: number,
): Promise<EditorialFacts & { matchIds: string[] }> {
  const ids = await db<{ id: string }[]>`
    select m.id from matches m join fixtures f on f.id = m.fixture_id
    where f.season_id = ${seasonId} and f.round = ${round} and m.status = 'completed' order by f.id`;
  const facts: Fact[] = [];
  for (const { id } of ids) {
    const mf = await matchFacts(db, id);
    facts.push(...mf.facts.filter((f) => f.kind !== "standing" && f.kind !== "lineup"));
  }
  facts.push(...(await standingFacts(db, seasonId, round)));
  return {
    contract: "editorial-facts/1",
    seasonId,
    matchId: null,
    generatedFrom: { resultFinalHash: null, standingsAfterRound: round },
    match: null,
    facts,
    matchIds: ids.map((r) => r.id),
  };
}
