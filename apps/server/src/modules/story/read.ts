/**
 * Fixture story (contract "fixture-story/1"): the read model behind "why this matters" and "what
 * changed". Deterministic and built from persisted official records only; it never calls a model.
 * See packages/contracts/src/story.ts for what each part may contain.
 */
import {
  type Fact,
  type FixtureStory,
  STORY_CONTRACT,
  type StandingSnapshot,
  type StoryArticle,
  type StoryLine,
  type StoryNextFixture,
  type StorySide,
  type StoryStage,
  type Team,
  toTeamSize,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { teamDugout } from "../dugout/read.ts";
import { matchFacts, possessive, prematchFacts } from "../editorial/facts.ts";
import { withdrawals } from "../insolvency/check.ts";
import { forfeitOf, type SeasonRow, seasonTeams, seasonWithdrawals, standingRows } from "../league/read.ts";
import { completedDeals } from "../transfers/history.ts";

interface FixtureRow {
  id: string;
  season_id: string;
  round: number;
  status: string;
  scheduled_at: Date | null;
  home_team_id: string;
  away_team_id: string;
  match_id: string | null;
  match_status: string | null;
  home_score: number | null;
  away_score: number | null;
}

/** How long past kickoff a fixture can sit unreleased before it's shown as delayed. */
const DELAY_GRACE_MS = 15 * 60_000;

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const pts = (n: number) => `${n} point${n === 1 ? "" : "s"}`;
const kickoff = (d: Date | null) =>
  d ? `${d.toISOString().slice(0, 10)}, ${d.toISOString().slice(11, 16)} UTC` : "time to be confirmed";

const rec = (kind: StoryLine["kind"], text: string, factIds: string[]): StoryLine => ({
  kind,
  source: "record",
  text,
  factIds,
});

/** The fixture's stage, from fixture, match and job state (never inferred from the clock alone). */
async function stageOf(db: Db, f: FixtureRow, decided: boolean, now: Date): Promise<StoryStage> {
  if (f.status === "completed" && f.match_status === "completed") return "completed";
  const [job] = await db<{ status: string }[]>`
    select status from jobs where kind = 'match.play' and payload->>'fixtureId' = ${f.id}
    order by created_at desc limit 1`;
  if (f.status === "failed" || job?.status === "failed") return "failed";
  if (f.status === "playing" || f.match_status === "running") return "playing";
  const late = f.scheduled_at !== null && now.getTime() - f.scheduled_at.getTime() > DELAY_GRACE_MS;
  if (f.status === "ready") return late && job?.status !== "running" ? "delayed" : "prepared";
  const [pending] = await db<{ n: number }[]>`
    select count(*)::int as n from jobs where kind = 'manager.pre_match' and payload->>'fixtureId' = ${f.id}
      and status in ('queued', 'running')`;
  if (pending!.n > 0) return "awaiting_decisions";
  if (decided) return "prepared";
  return late ? "delayed" : "scheduled";
}

async function snapshot(db: Db, seasonId: string, round: number): Promise<Map<string, StandingSnapshot>> {
  if (round < 1) return new Map();
  const { rows } = await standingRows(db, seasonId, { throughRound: round });
  return new Map(
    rows.map((r) => [r.team.id, { afterRound: round, position: r.position, points: r.points, played: r.played }]),
  );
}

async function nextFixture(db: Db, seasonId: string, teamId: string, round: number, teams: Map<string, Team>) {
  const [n] = await db<
    { id: string; round: number; home_team_id: string; away_team_id: string; scheduled_at: Date | null }[]
  >`
    select id, round, home_team_id, away_team_id, scheduled_at from fixtures
    where season_id = ${seasonId} and round > ${round} and ${teamId}::uuid in (home_team_id, away_team_id)
    order by round limit 1`;
  if (!n) return null;
  const home = n.home_team_id === teamId;
  return {
    fixtureId: n.id,
    round: n.round,
    venue: home ? "home" : "away",
    opponent: teams.get(home ? n.away_team_id : n.home_team_id)!,
    scheduledAt: n.scheduled_at?.toISOString() ?? null,
  } satisfies StoryNextFixture;
}

const byId = (facts: Fact[], id: string) => facts.find((f) => f.id === id);
const nameOf = (f: Fact) => (f.value as { team?: { name?: string } } | null)?.team?.name;

function prematchLines(
  facts: Fact[],
  home: Team,
  away: Team,
  round: number,
  rounds: number,
  asOf: number,
): StoryLine[] {
  const lines: StoryLine[] = [];
  const fixture = facts.find((f) => f.kind === "fixture" && f.id.startsWith("fixture:") && !f.id.includes(":tactics:"));
  if (fixture) lines.push(rec("fixture", `Round ${round} of ${rounds}: ${home.name} host ${away.name}.`, [fixture.id]));
  const table = facts.filter((f) => f.kind === "standing" && f.id.startsWith("standing:"));
  const hs = table.find((f) => nameOf(f) === home.name);
  const as = table.find((f) => nameOf(f) === away.name);
  if (hs && as) {
    const v = (f: Fact) => f.value as { position: number; points: number };
    const gap = v(hs).points - v(as).points;
    lines.push(
      rec(
        "table",
        `After round ${asOf}, ${home.name} are ${ordinal(v(hs).position)} on ${pts(v(hs).points)} and ${away.name} are ${ordinal(v(as).position)} on ${pts(v(as).points)}${gap === 0 ? ": level on points" : `: ${gap > 0 ? home.name : away.name} are ${pts(Math.abs(gap))} ahead`}.`,
        [hs.id, as.id],
      ),
    );
  }
  const race = facts.find((f) => f.id.startsWith("race:"));
  if (race) {
    const r = race.value as { contenders: string[]; clinched: string | null; roundsLeft: number };
    const inIt = [home.name, away.name].filter((n) => r.contenders.includes(n));
    const text = r.clinched
      ? [home.name, away.name].includes(r.clinched)
        ? `${r.clinched} have already won the title.`
        : `${r.clinched} have already won the title; this match can't change that.`
      : inIt.length === 2
        ? `Both clubs can still win the title, with ${r.roundsLeft} round${r.roundsLeft === 1 ? "" : "s"} left.`
        : inIt.length === 1
          ? `${inIt[0]} can still win the title; ${inIt[0] === home.name ? away.name : home.name} can no longer finish top.`
          : `Neither club can still win the title.`;
    lines.push({ ...rec("race", text, [race.id]), kind: "stakes" });
  }
  for (const m of facts.filter((f) => f.kind === "score" && f.statement.startsWith("Earlier meeting")))
    lines.push(rec("meeting", `${m.statement}.`, [m.id]));
  for (const m of facts.filter((f) => f.kind === "score" && /'s? last match \(round/.test(f.statement)))
    lines.push(rec("form", `${m.statement}.`, [m.id]));
  for (const f of facts.filter((x) => x.kind === "form")) lines.push(rec("form", `${f.statement}.`, [f.id]));
  for (const f of facts.filter((x) => x.id.startsWith("scorers:")))
    lines.push(rec("scorers", `${f.statement}.`, [f.id]));
  const defending = facts.find((f) => f.id.endsWith(":defending"));
  const champ = (defending?.value as { defending?: string } | undefined)?.defending;
  if (defending && champ && [home.name, away.name].includes(champ))
    lines.push(rec("history", `${defending.statement}.`, [defending.id]));
  for (const f of facts.filter((x) => x.kind === "tactics")) lines.push(rec("tactics", `${f.statement}.`, [f.id]));
  for (const f of facts.filter((x) => x.id.startsWith("takeover:")))
    lines.push(rec("takeover", `${f.statement}.`, [f.id]));
  for (const f of facts.filter((x) => x.id.startsWith("deal:"))) lines.push(rec("transfer", `${f.statement}.`, [f.id]));
  return lines;
}

function postmatchLines(
  facts: Fact[],
  sides: {
    team: Team;
    before: StandingSnapshot | null;
    after: StandingSnapshot | null;
    next: StoryNextFixture | null;
  }[],
  seasonId: string,
  round: number,
): StoryLine[] {
  const lines: StoryLine[] = [];
  const score = facts.find((f) => f.kind === "score" && f.statement.startsWith("Final score"));
  if (score) lines.push(rec("result", `${score.statement}.`, [score.id]));
  const goals = facts.filter((f) => f.kind === "goal" && f.id.includes(":goal:"));
  if (goals.length)
    lines.push(
      rec(
        "goals",
        goals.map((g) => `${g.statement.replace(/^Goal \d+: /, "").replace(/; score .*$/, "")}.`).join(" "),
        goals.map((g) => g.id),
      ),
    );
  else {
    const none = facts.find((f) => f.kind === "goal");
    if (none) lines.push(rec("goals", "No goals were scored.", [none.id]));
  }
  for (const s of sides) {
    if (!s.after) continue;
    const ids = [`standing:${seasonId}:r${round}:${s.team.slug}`];
    if (s.before) ids.push(`standing:${seasonId}:r${round - 1}:${s.team.slug}`);
    const move = !s.before
      ? `${s.team.name} are ${ordinal(s.after.position)} after round ${round}`
      : s.before.position === s.after.position
        ? `${s.team.name} stay ${ordinal(s.after.position)}`
        : `${s.team.name} move from ${ordinal(s.before.position)} to ${ordinal(s.after.position)}`;
    lines.push(
      rec(
        "table",
        `${move} on ${pts(s.after.points)}.`,
        ids.filter((id) => byId(facts, id)),
      ),
    );
  }
  const race = facts.find((f) => f.id === `race:${seasonId}:r${round}`);
  if (race) lines.push(rec("race", `${race.statement}.`, [race.id]));
  for (const s of sides) {
    if (!s.next) continue;
    const id = `fixture:${s.next.fixtureId}`;
    lines.push(
      rec(
        "next",
        `Next for ${s.team.name}: ${s.next.venue === "home" ? `${s.next.opponent.name} at home` : `away at ${s.next.opponent.name}`} in round ${s.next.round} (${kickoff(s.next.scheduledAt ? new Date(s.next.scheduledAt) : null)}).`,
        byId(facts, id) ? [id] : [],
      ),
    );
  }
  return lines;
}

/** Fixture facts for each club's next match, so "next" lines are citable. */
function nextFacts(sides: { team: Team; next: StoryNextFixture | null }[]): Fact[] {
  return sides.flatMap(({ team, next }) =>
    next
      ? [
          {
            id: `fixture:${next.fixtureId}`,
            kind: "fixture" as const,
            statement: `${team.name}'s next fixture: round ${next.round}, ${next.venue} against ${next.opponent.name}, scheduled for ${kickoff(next.scheduledAt ? new Date(next.scheduledAt) : null)}`,
            value: {
              round: next.round,
              scheduledAt: next.scheduledAt,
              venue: next.venue,
              opponent: next.opponent.name,
            },
            source: { table: "fixtures", id: next.fixtureId },
          },
        ]
      : [],
  );
}

async function articleRef(
  db: Db,
  where: { fixtureId: string; kind: "preview" } | { matchId: string; kind: "match_report" },
) {
  const rows =
    where.kind === "preview"
      ? await db<StoryArticle[]>`
          select slug, kind, headline from articles where fixture_id = ${where.fixtureId} and kind = 'preview' and status = 'published' and published_at <= now()
          order by published_at limit 1`
      : await db<StoryArticle[]>`
          select slug, kind, headline from articles where match_id = ${where.matchId} and kind = 'match_report' and status = 'published' and published_at <= now()
          order by published_at limit 1`;
  return rows[0] ?? null;
}

/** The story for one fixture, or null if it doesn't exist. */
async function signingReasons(db: Db, seasonId: string, facts: Fact[]): Promise<StoryLine[]> {
  const ids = new Set(facts.filter((x) => x.id.startsWith("deal:")).map((x) => x.id.slice(5)));
  if (!ids.size) return [];
  return (await completedDeals(db, { seasonId }))
    .filter((d) => ids.has(d.id))
    .map((d) => ({
      kind: "transfer" as const,
      source: "interpretation" as const,
      text: `${d.buyer.manager ?? `${possessive(d.to.name)} manager`} (${d.to.name}) on signing ${d.player.name}: ${d.buyer.reason}`,
      factIds: [],
    }));
}

export async function fixtureStory(db: Db, fixtureId: string, now = new Date()): Promise<FixtureStory | null> {
  const [f] = await db<FixtureRow[]>`
    select f.id, f.season_id, f.round, f.status, f.scheduled_at, f.home_team_id, f.away_team_id,
      m.id as match_id, m.status as match_status, m.home_score, m.away_score
    from fixtures f left join matches m on m.fixture_id = f.id where f.id = ${fixtureId}`;
  if (!f) return null;
  const [season] = await db<SeasonRow[]>`select * from seasons where id = ${f.season_id}`;
  const [count] = await db<{ rounds: number }[]>`
    select coalesce(max(round), 0)::int as rounds from fixtures where season_id = ${f.season_id}`;
  const rounds = count!.rounds;
  const teams = await seasonTeams(db, f.season_id);
  const home = teams.get(f.home_team_id)!;
  const away = teams.get(f.away_team_id)!;
  const completed = f.status === "completed" && f.match_status === "completed";
  // A club in this fixture has withdrawn (bankrupt): it's a walkover or void, never played.
  const ff = forfeitOf(f, await withdrawals(db, f.season_id));
  const forfeit: FixtureStory["forfeit"] = ff
    ? {
        kind: ff.kind,
        awardedTo: ff.awardedTo ? teams.get(ff.awardedTo)! : null,
        withdrawn: (await seasonWithdrawals(db, f.season_id))
          .filter((w) => ff.withdrawn.includes(w.team.id))
          .map((w) => ({ team: w.team, round: w.round, reason: w.reason })),
      }
    : null;

  const pre = await prematchFacts(db, f.id);
  const before = await snapshot(db, f.season_id, f.round - 1);
  const after =
    completed || (ff && f.status === "completed")
      ? await snapshot(db, f.season_id, f.round)
      : new Map<string, StandingSnapshot>();

  const side = async (team: Team): Promise<StorySide> => {
    const story = await teamDugout(db, season!, team);
    const chapter = story.chapters.find((c) => c.fixtureId === f.id) ?? null;
    return {
      team,
      manager: story.manager ? { slug: story.manager.slug, name: story.manager.name } : null,
      before: before.get(team.id) ?? null,
      after: after.get(team.id) ?? null,
      decision: chapter?.decision ?? null,
      reflection: completed ? (chapter?.reflection ?? null) : null,
      next: await nextFixture(db, f.season_id, team.id, f.round, teams),
    };
  };
  const [hs, as] = [await side(home), await side(away)];
  // Decided once each manager's run for this fixture has finished: a new or kept setup, or an
  // honest no-decision (budget, rejected, failed). The pre-season plan alone isn't a decision.
  const done = new Set(["new", "kept", "skipped_budget", "rejected", "failed"]);
  const decided = [hs, as].every((s) => s.decision && done.has(s.decision.status));
  const stage = ff ? "forfeited" : await stageOf(db, f, decided, now);

  let postmatch: FixtureStory["postmatch"] = null;
  if (completed && f.match_id) {
    const mf = await matchFacts(db, f.match_id);
    const prior = f.round > 1 ? pre.facts.filter((x) => x.kind === "standing" && x.id.startsWith("standing:")) : [];
    const facts = [...mf.facts, ...prior, ...nextFacts([hs, as])];
    const lines = postmatchLines(facts, [hs, as], f.season_id, f.round);
    for (const s of [hs, as])
      if (s.reflection?.lesson)
        lines.push({
          kind: "result",
          source: "interpretation",
          text: `${s.manager?.name ?? `${s.team.name}'s manager`} (${s.team.name}) took this lesson: ${s.reflection.lesson}`,
          factIds: [],
        });
    postmatch = { afterRound: f.round, lines, facts };
  }

  return {
    contract: STORY_CONTRACT,
    fixtureId: f.id,
    season: {
      id: season!.id,
      slug: season!.slug,
      name: season!.name,
      playersPerTeam: toTeamSize(season!.players_per_team),
      rounds,
    },
    round: f.round,
    scheduledAt: f.scheduled_at?.toISOString() ?? null,
    timezone: "UTC",
    stage,
    home: hs,
    away: as,
    match: f.match_id
      ? {
          id: f.match_id,
          score: completed ? { home: f.home_score!, away: f.away_score! } : null,
        }
      : null,
    prematch: {
      asOfRound: pre.asOfRound,
      lines: [
        ...prematchLines(pre.facts, home, away, f.round, rounds, pre.asOfRound),
        // The managers' own reasons for this season's signings, attributed (AI-written, not fact-checked).
        ...(await signingReasons(db, f.season_id, pre.facts)),
      ],
      facts: pre.facts,
    },
    postmatch,
    forfeit,
    articles: {
      preview: await articleRef(db, { fixtureId: f.id, kind: "preview" }),
      report: completed && f.match_id ? await articleRef(db, { matchId: f.match_id, kind: "match_report" }) : null,
    },
  };
}
