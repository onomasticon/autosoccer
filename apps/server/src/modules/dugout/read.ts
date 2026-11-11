/**
 * Inside the Dugout read model (contract dugout/1). Assembles each manager's story from
 * persisted records only: the tactical revision each match actually used (decision), the
 * official result (observation), and the manager's own recorded rationale and post-match
 * lesson (speculation). Nothing is generated here, and prompts are never read.
 */
import {
  type DugoutChapter,
  type DugoutDecision,
  type DugoutReflection,
  type DugoutResponse,
  describeTactics,
  type FixtureView,
  type Lineup,
  type ManagerStory,
  type SharedResult,
  TacticalConfigV1,
  type TacticChange,
  type Team,
  type TeamMatchStats,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { fixtureViews, type SeasonRow, seasonTeams } from "../league/read.ts";
import type { RevisionRow } from "../mappers.ts";

const LABELS: Record<keyof TacticalConfigV1, string> = {
  formation: "Formation",
  lineHeight: "Defensive line",
  width: "Width",
  pressing: "Pressing",
  tempo: "Tempo",
  passingRisk: "Passing risk",
  shooting: "Shooting",
  dribbling: "Dribbling",
  keeperDistribution: "Keeper distribution",
};

interface MatchRow {
  id: string;
  fixture_id: string;
  home_score: number;
  away_score: number;
  stats: { home: TeamMatchStats; away: TeamMatchStats } | null;
  home_revision_id: string | null;
  away_revision_id: string | null;
  request: { home: { starters: Array<{ playerId: string }> }; away: { starters: Array<{ playerId: string }> } };
}
interface RunRow {
  purpose: "pre_match" | "post_match";
  fixture_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped_budget";
  output: unknown;
  finished_at: Date | null;
}
interface PlayerLite {
  id: string;
  name: string;
  shirt_number: number;
  position: string;
}

const tacticsOf = (rev: Pick<RevisionRow, "deployment"> | undefined): TacticalConfigV1 | null => {
  if (!rev || rev.deployment.kind !== "tactical") return null;
  const t = TacticalConfigV1.safeParse(rev.deployment.config);
  return t.success ? t.data : null;
};

export function tacticChanges(prev: TacticalConfigV1 | null, next: TacticalConfigV1 | null): TacticChange[] {
  if (!prev || !next) return [];
  return (Object.keys(LABELS) as Array<keyof TacticalConfigV1>)
    .filter((k) => prev[k] !== next[k])
    .map((k) => ({ field: k, label: LABELS[k], from: prev[k], to: next[k] }));
}

/** Only the public review fields: lesson and summary strings, nothing else from the run. */
function reviewOf(output: unknown): { lesson: string | null; summary: string | null } {
  const o = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { lesson: str(o.lesson), summary: str(o.summary) };
}

interface Loaded {
  season: SeasonRow;
  teams: Map<string, Team>;
  fixtures: FixtureView[];
  matches: Map<string, MatchRow>;
}

async function loadSeason(db: Db, season: SeasonRow): Promise<Loaded> {
  const teams = await seasonTeams(db, season.id);
  const fixtures = await fixtureViews(db, season.id);
  const rows = await db<MatchRow[]>`
    select m.id, m.fixture_id, m.home_score, m.away_score, m.stats, m.home_revision_id, m.away_revision_id, m.request
    from matches m join fixtures f on f.id = m.fixture_id
    where f.season_id = ${season.id} and m.status = 'completed'`;
  return { season, teams, fixtures, matches: new Map(rows.map((m) => [m.fixture_id, m])) };
}

async function storyFor(db: Db, l: Loaded, team: Team): Promise<ManagerStory> {
  const [manager] = await db<{ id: string; slug: string; name: string; philosophy: string }[]>`
    select id, slug, name, philosophy from manager_agents where team_id = ${team.id}`;
  const revisions = await db<RevisionRow[]>`
    select * from tactical_revisions where team_id = ${team.id} and season_id = ${l.season.id} order by version`;
  const byId = new Map(revisions.map((r) => [r.id, r]));
  const runs = manager
    ? await db<RunRow[]>`
        select purpose, fixture_id, status, output, finished_at from agent_runs
        where agent_kind = 'manager' and agent_id = ${manager.id} and season_id = ${l.season.id}
          and purpose in ('pre_match', 'post_match') and fixture_id is not null`
    : [];
  const run = (purpose: RunRow["purpose"], fixtureId: string) =>
    runs.find((r) => r.purpose === purpose && r.fixture_id === fixtureId);
  const players = new Map(
    (await db<PlayerLite[]>`select id, name, shirt_number, position from players where team_id = ${team.id}`).map(
      (p) => [p.id, { id: p.id, name: p.name, shirtNumber: p.shirt_number, position: p.position }],
    ),
  );

  const mine = l.fixtures.filter((f) => f.homeTeamId === team.id || f.awayTeamId === team.id);
  const played = mine.filter((f) => f.status === "completed" && l.matches.has(f.id));
  const next = mine.find((f) => f.status !== "completed");
  const chapters: DugoutChapter[] = [];
  let prevTactics: TacticalConfigV1 | null = null;
  let prevStarters: string[] | null = null;

  const decide = (f: FixtureView, used: RevisionRow | undefined, starters: string[] | null): DugoutDecision => {
    const pre = run("pre_match", f.id);
    const rejected = revisions.find((r) => r.fixture_id === f.id && r.status === "rejected");
    const tactics = tacticsOf(used);
    const changes = tacticChanges(prevTactics, tactics);
    const lineupIn = prevStarters && starters ? starters.filter((id) => !prevStarters!.includes(id)) : [];
    const lineupOut = prevStarters && starters ? prevStarters.filter((id) => !starters.includes(id)) : [];
    const byManagerNow = used?.source === "manager" && used.fixture_id === f.id && pre?.status === "succeeded";
    let status: DugoutDecision["status"];
    if (byManagerNow) status = changes.length || lineupIn.length ? "new" : "kept";
    else if (pre?.status === "skipped_budget") status = "skipped_budget";
    else if (pre?.status === "failed") status = rejected ? "rejected" : "failed";
    else if (!used || used.source === "seed") status = "opening";
    else status = "kept";
    const summary = tactics
      ? describeTactics(tactics)
      : used?.deployment.kind === "scripted"
        ? "a scripted controller"
        : "the league baseline tactics";
    return {
      status,
      revisionVersion: used?.version ?? null,
      tactics,
      summary,
      changes,
      lineupIn: lineupIn.map((id) => players.get(id)).filter((p) => !!p),
      lineupOut: lineupOut.map((id) => players.get(id)).filter((p) => !!p),
      // Only a reason the manager actually gave for this very decision; never filled in otherwise.
      rationale: byManagerNow ? (used?.rationale ?? null) : null,
      decidedAt: byManagerNow ? (used ? used.created_at.toISOString() : null) : null,
    };
  };

  for (const f of played) {
    const m = l.matches.get(f.id)!;
    const side = f.homeTeamId === team.id ? "home" : "away";
    const other = side === "home" ? "away" : "home";
    const used = byId.get((side === "home" ? m.home_revision_id : m.away_revision_id) ?? "");
    const starters =
      m.request?.[side]?.starters?.map((s) => s.playerId) ?? (used?.lineup as Lineup | undefined)?.starters ?? null;
    const decision = decide(f, used, starters);
    const gf = side === "home" ? m.home_score : m.away_score;
    const ga = side === "home" ? m.away_score : m.home_score;
    const post = run("post_match", f.id);
    const review = post?.status === "succeeded" ? reviewOf(post.output) : { lesson: null, summary: null };
    const reflection: DugoutReflection | null = manager
      ? {
          status:
            post?.status === "succeeded"
              ? "reviewed"
              : post?.status === "skipped_budget"
                ? "skipped_budget"
                : post?.status === "failed"
                  ? "failed"
                  : "pending",
          ...review,
          reviewedAt: post?.status === "succeeded" ? (post.finished_at?.toISOString() ?? null) : null,
        }
      : null;
    chapters.push({
      fixtureId: f.id,
      round: f.round,
      venue: side,
      opponent: side === "home" ? f.away : f.home,
      scheduledAt: f.scheduledAt,
      status: "completed",
      decision,
      result: {
        matchId: m.id,
        goalsFor: gf,
        goalsAgainst: ga,
        outcome: gf > ga ? "W" : gf === ga ? "D" : "L",
        possession: m.stats?.[side].possession ?? null,
        shots: m.stats?.[side].shots ?? null,
        shotsAgainst: m.stats?.[other].shots ?? null,
      },
      reflection,
    });
    prevTactics = decision.tactics;
    prevStarters = starters;
  }

  if (next) {
    const side = next.homeTeamId === team.id ? "home" : "away";
    const prepared = revisions.filter((r) => r.fixture_id === next.id && r.status === "valid").at(-1);
    const pre = run("pre_match", next.id);
    let decision: DugoutDecision;
    if (prepared && pre?.status === "succeeded") {
      decision = decide(next, prepared, (prepared.lineup as Lineup).starters);
    } else {
      const status: DugoutDecision["status"] =
        pre?.status === "skipped_budget"
          ? "skipped_budget"
          : pre?.status === "failed"
            ? "failed"
            : played.length === 0
              ? "opening"
              : "pending";
      const current = revisions.filter((r) => r.status === "valid").at(-1);
      const t = status === "pending" ? null : tacticsOf(current);
      decision = {
        status,
        revisionVersion: status === "pending" ? null : (current?.version ?? null),
        tactics: t,
        summary:
          status === "pending"
            ? "To be decided before kick-off"
            : t
              ? describeTactics(t)
              : "the league baseline tactics",
        changes: [],
        lineupIn: [],
        lineupOut: [],
        rationale: null,
        decidedAt: null,
      };
    }
    chapters.push({
      fixtureId: next.id,
      round: next.round,
      venue: side,
      opponent: side === "home" ? next.away : next.home,
      scheduledAt: next.scheduledAt,
      status: "upcoming",
      decision,
      result: null,
      reflection: null,
    });
  }

  return {
    team,
    manager: manager ? { slug: manager.slug, name: manager.name, philosophy: manager.philosophy } : null,
    chapters,
    seasonComplete: !next && played.length > 0,
  };
}

export async function teamDugout(db: Db, season: SeasonRow, team: Team): Promise<ManagerStory> {
  return storyFor(db, await loadSeason(db, season), team);
}

/**
 * Every club's story, plus a featured result: from the latest round both managers have
 * reviewed, the match where their lessons differ (else any reviewed one), else the latest match.
 */
export async function seasonDugout(db: Db, season: SeasonRow): Promise<Omit<DugoutResponse, "contract">> {
  const l = await loadSeason(db, season);
  const stories: ManagerStory[] = [];
  for (const t of l.teams.values()) stories.push(await storyFor(db, l, t));
  const completed = l.fixtures.filter((f) => f.status === "completed" && l.matches.has(f.id)).reverse();
  const chapterOf = (teamId: string, fixtureId: string) =>
    stories.find((s) => s.team.id === teamId)?.chapters.find((c) => c.fixtureId === fixtureId);
  const shared = (f: FixtureView): SharedResult | null => {
    const home = chapterOf(f.homeTeamId, f.id);
    const away = chapterOf(f.awayTeamId, f.id);
    const m = l.matches.get(f.id)!;
    if (!home || !away) return null;
    return {
      matchId: m.id,
      fixtureId: f.id,
      round: f.round,
      home: { team: f.home, score: m.home_score },
      away: { team: f.away, score: m.away_score },
      sides: { home, away },
    };
  };
  // Newest first. Within the latest round both managers have reviewed, prefer a match where
  // their lessons differ: two readings of one official result are the point of the module.
  const reviewed = completed
    .map(shared)
    .filter((x): x is SharedResult => !!(x?.sides.home.reflection?.lesson && x.sides.away.reflection?.lesson));
  const latestRound = reviewed[0]?.round;
  const pick =
    reviewed.find(
      (x) => x.round === latestRound && x.sides.home.reflection!.lesson !== x.sides.away.reflection!.lesson,
    ) ??
    reviewed[0] ??
    (completed[0] ? shared(completed[0]) : null);
  return { seasonId: season.id, featured: pick, stories };
}
