/**
 * Season review: what a season looked like to a visitor, from the official record only.
 * Match entertainment (goals, 0–0s, comebacks, late goals, own goals), the title race,
 * manager behaviour (tactical changes, rejected proposals, budget), journalism (published,
 * template fallbacks, rejections) and spend. Read-only.
 *
 *   bun scripts/season-review.ts --season season-2 [--json out.json]
 */
import { writeFileSync } from "node:fs";
import { createDb } from "@autosoccer/db";
import { loadConfig } from "../apps/server/src/config.ts";
import { seasonBySlug, standingRows } from "../apps/server/src/modules/league/read.ts";

const opt = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const slug = opt("season", "season-1");
const s = await seasonBySlug(db, slug);
if (!s) throw new Error(`no season ${slug}`);

interface GoalEvent {
  type: string;
  side?: "home" | "away";
  ownGoal?: boolean;
  period?: string;
  clockSec?: number;
  score?: { home: number; away: number };
}
const matches = await db<
  {
    round: number;
    home: string;
    away: string;
    home_score: number;
    away_score: number;
    events: GoalEvent[];
    stats: { home: Record<string, number>; away: Record<string, number> };
    request: { config: { halfDurationSec?: number; playersPerTeam?: number } };
  }[]
>`
  select f.round, h.name as home, a.name as away, m.home_score, m.away_score, m.events, m.stats, m.request
  from matches m join fixtures f on f.id = m.fixture_id join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
  where f.season_id = ${s.id} and m.status = 'completed' order by f.round, h.name`;

const n = matches.length || 1;
let goals = 0;
let nil = 0;
let draws = 0;
let comebacks = 0;
let lateGoals = 0;
let ownGoals = 0;
let shots = 0;
let onTarget = 0;
let oneGoalGames = 0;
const half = matches[0]?.request.config.halfDurationSec ?? 120;
for (const m of matches) {
  const g = m.home_score + m.away_score;
  goals += g;
  if (g === 0) nil++;
  if (m.home_score === m.away_score) draws++;
  if (Math.abs(m.home_score - m.away_score) === 1) oneGoalGames++;
  shots += (m.stats?.home.shots ?? 0) + (m.stats?.away.shots ?? 0);
  onTarget += (m.stats?.home.shotsOnTarget ?? 0) + (m.stats?.away.shotsOnTarget ?? 0);
  const gs = m.events.filter((e) => e.type === "goal");
  ownGoals += gs.filter((e) => e.ownGoal).length;
  lateGoals += gs.filter((e) => e.period === "secondHalf" && (e.clockSec ?? 0) > half - 30).length;
  // Comeback: the eventual winner trailed at some point.
  const winner = m.home_score > m.away_score ? "home" : m.away_score > m.home_score ? "away" : null;
  if (
    winner &&
    gs.some((e) => e.score && (winner === "home" ? e.score.home < e.score.away : e.score.away < e.score.home))
  )
    comebacks++;
}
const { rows } = await standingRows(db, s.id);
const pts = rows.map((r) => r.points);

const revs = await db<
  { team: string; version: number; source: string; status: string; deployment: { config: { formation?: string } } }[]
>`
  select t.name as team, r.version, r.source, r.status, r.deployment from tactical_revisions r join teams t on t.id = r.team_id
  where r.season_id = ${s.id} order by t.name, r.version`;
const byTeam = new Map<string, string[]>();
for (const r of revs.filter((x) => x.status === "valid"))
  byTeam.set(r.team, [...(byTeam.get(r.team) ?? []), r.deployment.config.formation ?? "baseline"]);

const runs = await db<{ agent_kind: string; purpose: string; status: string; n: number; cost: number }[]>`
  select agent_kind, purpose, status, count(*)::int as n, sum(cost_micro_usd)::bigint as cost from agent_runs
  where season_id = ${s.id} group by 1, 2, 3 order by 1, 2, 3`;
const articles = await db<{ kind: string; status: string; n: number; template: number }[]>`
  select a.kind, a.status, count(*)::int as n,
    count(*) filter (where r.provider = 'template' or r.prompt ? 'rejected')::int as template
  from articles a left join agent_runs r on r.id = a.agent_run_id
  where a.season_id = ${s.id} group by 1, 2 order by 1, 2`;

const review = {
  season: {
    slug: s.slug,
    name: s.name,
    status: s.status,
    playersPerTeam: s.players_per_team,
    simVersion: s.sim_version,
  },
  matches: matches.length,
  entertainment: {
    goalsPerMatch: +(goals / n).toFixed(2),
    nilNil: +(nil / n).toFixed(3),
    draws: +(draws / n).toFixed(3),
    oneGoalGames: +(oneGoalGames / n).toFixed(3),
    comebacks,
    lateGoals,
    ownGoalShare: goals ? +(ownGoals / goals).toFixed(3) : 0,
    shotsPerMatch: +(shots / n).toFixed(2),
    onTargetShare: shots ? +(onTarget / shots).toFixed(3) : 0,
  },
  table: rows.map((r) => ({
    pos: r.position,
    team: r.team.name,
    pts: r.points,
    gd: r.goalDifference,
    form: r.form.join(""),
  })),
  titleMargin: (pts[0] ?? 0) - (pts[1] ?? 0),
  pointsSpread: (pts[0] ?? 0) - (pts.at(-1) ?? 0),
  formations: Object.fromEntries(byTeam),
  rejectedRevisions: revs.filter((r) => r.status === "rejected").length,
  runs,
  articles,
  results: matches.map((m) => `R${m.round} ${m.home} ${m.home_score}–${m.away_score} ${m.away}`),
};
console.log(JSON.stringify(review, null, 2));
if (process.argv.includes("--json")) writeFileSync(opt("json", "review.json"), JSON.stringify(review, null, 2));
await db.end();
