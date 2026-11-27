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
import { formatCredits } from "../finance/rules.ts";
import { absencesFor } from "../injuries/injuries.ts";
import { seasonRace, standingRows } from "../league/read.ts";
import { completedDeals, takeoverStories } from "../transfers/history.ts";

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
    select m.id, f.season_id, f.round, f.id as fixture_id, f.home_team_id, f.away_team_id, team_name_as_of(h.id, f.season_id) as home_name, team_name_as_of(a.id, f.season_id) as away_name,
      m.home_score, m.away_score, m.final_hash, m.events, m.stats, m.request, m.home_revision_id, m.away_revision_id
    from matches m join fixtures f on f.id = m.fixture_id
    join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
    where m.id = ${matchId} and m.status = 'completed'`;
  if (!m) throw new Error(`match ${matchId} has no official result`);
  return m;
}

/**
 * Standings facts after a round: a snapshot computed only from official results up to and
 * including that round, so an article about round N never cites a later table.
 */
export async function standingFacts(db: Db, seasonId: string, round: number): Promise<Fact[]> {
  const { rows } = await standingRows(db, seasonId, { throughRound: round });
  return rows.map((r) => ({
    id: `standing:${seasonId}:r${round}:${r.team.slug}`,
    kind: "standing" as const,
    statement: `${r.team.name} are ${ordinal(r.position)} with ${r.points} point${r.points === 1 ? "" : "s"} from ${r.played} match${r.played === 1 ? "" : "es"} (W${r.won} D${r.drawn} L${r.lost}, goal difference ${r.goalDifference >= 0 ? "+" : ""}${r.goalDifference}); form ${r.form.join("") || "–"}`,
    value: {
      team: { id: r.team.id, name: r.team.name },
      afterRound: round,
      teams: rows.length,
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

/** The title race after a round: who can still win it, or who already has (from the table and fixtures left). */
export async function raceFact(db: Db, seasonId: string, round: number): Promise<Fact[]> {
  const { rows } = await standingRows(db, seasonId, { throughRound: round });
  if (!rows.length || rows.every((r) => r.played === 0)) return [];
  const race = await seasonRace(db, seasonId, rows, round);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]!);
  const statement = race.clinched
    ? race.roundsLeft > 0
      ? `After round ${round}, ${race.clinched.name} can no longer be caught: they have won the title with ${race.roundsLeft} round${race.roundsLeft === 1 ? "" : "s"} to spare`
      : `${race.clinched.name} finished top and won the title`
    : `After round ${round}, with ${race.roundsLeft} round${race.roundsLeft === 1 ? "" : "s"} left, ${race.contenders.length === rows.length ? "every club" : list(race.contenders.map((t) => t.name))} can still win the title`;
  return [
    {
      id: `race:${seasonId}:r${round}`,
      kind: "standing",
      statement,
      value: {
        afterRound: round,
        roundsLeft: race.roundsLeft,
        contenders: race.contenders.map((t) => t.name),
        clinched: race.clinched?.name ?? null,
      },
      source: { table: "matches", id: `season:${seasonId}` },
    },
  ];
}

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

/**
 * injury/1 facts for a match: starters who missed it injured and who played instead (a squad
 * player or an emergency call-up), and players hurt in it, with how long they're out.
 */
async function injuryFacts(db: Db, m: MatchRow): Promise<Fact[]> {
  const club = new Map([
    [m.home_team_id, m.home_name],
    [m.away_team_id, m.away_name],
  ]);
  const out: Fact[] = [];
  for (const a of await absencesFor(db, m.fixture_id))
    out.push({
      id: `match:${m.id}:absent:${a.player.id}`,
      kind: "lineup",
      statement: a.emergency
        ? `${a.player.name} missed the match injured, and ${club.get(a.teamId)} had nobody fit to replace them: ${a.replacedBy.name} started as an emergency call-up`
        : `${a.player.name} missed the match injured; ${a.replacedBy.name} started for ${club.get(a.teamId)} instead`,
      value: { teamId: a.teamId, player: a.player.name, replacedBy: a.replacedBy.name, emergency: a.emergency },
      source: { table: "lineup_changes", id: m.fixture_id },
    });
  const hurt = await db<{ player_id: string; name: string; team_id: string; rounds: number }[]>`
    select i.player_id, p.name, i.team_id, (i.out_until_round - i.out_from_round + 1)::int as rounds
    from player_injuries i join players p on p.id = i.player_id where i.match_id = ${m.id} order by p.name`;
  for (const h of hurt)
    out.push({
      id: `match:${m.id}:injury:${h.player_id}`,
      kind: "lineup",
      statement: `${h.name} of ${club.get(h.team_id)} was injured in the match and will miss the next ${h.rounds === 1 ? "round" : `${h.rounds} rounds`}`,
      value: { player: h.name, rounds: h.rounds },
      source: { table: "player_injuries", id: m.id },
    });
  return out;
}

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
    value: {
      home: m.home_score,
      away: m.away_score,
      round: m.round,
      homeTeam: { id: m.home_team_id, name: m.home_name },
      awayTeam: { id: m.away_team_id, name: m.away_name },
    },
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
  facts.push(...(await injuryFacts(db, m)));
  facts.push(...(await standingFacts(db, m.season_id, m.round)));
  facts.push(...(await historyFacts(db, m.season_id)));
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
    {
      id: string;
      round: number;
      home_id: string;
      away_id: string;
      home_name: string;
      away_name: string;
      home_score: number;
      away_score: number;
    }[]
  >`
    select m.id, f.round, f.home_team_id as home_id, f.away_team_id as away_id, team_name_as_of(h.id, f.season_id) as home_name, team_name_as_of(a.id, f.season_id) as away_name,
      m.home_score, m.away_score
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
      value: {
        home: e.home_score,
        away: e.away_score,
        round: e.round,
        homeTeam: { id: e.home_id, name: e.home_name },
        awayTeam: { id: e.away_id, name: e.away_name },
      },
      source: { table: "matches", id: e.id },
    });
  for (const [teamId, name] of [
    [m.home_team_id, m.home_name],
    [m.away_team_id, m.away_name],
  ] as const) {
    const f = await formFact(db, m.season_id, teamId, name, m.round);
    if (f) facts.push(f);
  }
  return facts;
}

/**
 * A club's current run (2+ wins, unbeaten or winless matches) through a round, from official
 * results only. Null when there's no run to speak of.
 */
async function formFact(
  db: Db,
  seasonId: string,
  teamId: string,
  name: string,
  throughRound: number,
): Promise<Fact | null> {
  const results = await db<{ gf: number; ga: number }[]>`
    select case when f.home_team_id = ${teamId} then m.home_score else m.away_score end as gf,
           case when f.home_team_id = ${teamId} then m.away_score else m.home_score end as ga
    from matches m join fixtures f on f.id = m.fixture_id
    where f.season_id = ${seasonId} and m.status = 'completed' and f.round <= ${throughRound}
      and ${teamId}::uuid in (f.home_team_id, f.away_team_id)
    order by f.round desc`;
  if (results.length < 2) return null;
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
  if (!statement) return null;
  return {
    id: `form:${seasonId}:r${throughRound}:${teamId}`,
    kind: "form",
    statement,
    value: { team: { id: teamId, name }, throughRound, recentFirst: res },
    source: { table: "matches", id: `season:${seasonId}` },
  };
}

/** Facts for a whole round: each match's score and key stats, plus the table afterwards. */
/**
 * League history before this season, from earlier seasons' final tables: the defending champion and
 * any run of consecutive titles, and every club's title count. Gives journalists the long story
 * ("seeking a fourth straight title") without inventing it.
 */
export async function historyFacts(db: Db, seasonId: string): Promise<Fact[]> {
  const earlier = await db<{ id: string; name: string }[]>`
    select s.id, s.name from seasons s, seasons cur
    where cur.id = ${seasonId} and s.status = 'completed' and s.id <> cur.id and s.league_id = cur.league_id
      and coalesce(s.starts_at, s.created_at) < coalesce(cur.starts_at, cur.created_at)
    order by coalesce(s.starts_at, s.created_at)`;
  if (!earlier.length) return [];
  const champions: Array<{ season: string; team: string }> = [];
  for (const s of earlier) {
    const { rows } = await standingRows(db, s.id);
    if (rows[0]) champions.push({ season: s.name, team: rows[0].team.name });
  }
  if (!champions.length) return [];
  const last = champions.at(-1)!;
  let streak = 0;
  for (let i = champions.length - 1; i >= 0 && champions[i]!.team === last.team; i--) streak++;
  const counts = new Map<string, number>();
  for (const c of champions) counts.set(c.team, (counts.get(c.team) ?? 0) + 1);
  const { rows: clubs } = await standingRows(db, seasonId);
  const tally = clubs
    .map((r) => ({ team: r.team.name, n: counts.get(r.team.name) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.team.localeCompare(b.team));
  const src = { table: "seasons", id: `history:${seasonId}` };
  const listSeasons = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]!);
  return [
    {
      id: `history:${seasonId}:defending`,
      kind: "standing",
      statement:
        streak > 1
          ? `${last.team} are the defending champions and have won the last ${streak} titles in a row (${listSeasons(champions.slice(-streak).map((c) => c.season))})`
          : `${last.team} are the defending champions (${last.season})`,
      value: { defending: last.team, streak, seasons: champions.slice(-streak).map((c) => c.season) },
      source: src,
    },
    {
      id: `history:${seasonId}:titles`,
      kind: "standing",
      statement: `League titles before this season: ${tally.map((t) => `${t.team} ${t.n}`).join(", ")} (${champions.length} seasons completed)`,
      value: { titles: Object.fromEntries(tally.map((t) => [t.team, t.n])), seasons: champions.length },
      source: src,
    },
  ];
}

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
  facts.push(
    ...(await standingFacts(db, seasonId, round)),
    ...(await raceFact(db, seasonId, round)),
    ...(await historyFacts(db, seasonId)),
  );
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

interface FixtureRow {
  id: string;
  season_id: string;
  round: number;
  scheduled_at: Date | null;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
}

/** In the first rounds of a season, a club's signings and a takeover are part of its story. */
export const CLUB_EVENT_ROUNDS = 3;

/**
 * The season's club decisions with sporting consequences (#80): signings made in the window before
 * it, and a club playing its first season under new owners. Only in the first rounds, while they're
 * still news. Facts from the record; the managers' reasons are attributed separately (Matchday).
 */
export async function clubEventFacts(db: Db, seasonId: string, teamIds: string[], round: number): Promise<Fact[]> {
  if (round > CLUB_EVENT_ROUNDS) return [];
  const out: Fact[] = [];
  for (const d of await completedDeals(db, { seasonId }))
    if (teamIds.includes(d.to.id))
      out.push({
        id: `deal:${d.id}`,
        kind: "news",
        statement: `${d.player.name} joined ${d.to.name} from ${d.from.name} for ${formatCredits(d.fee)} in the ${d.season.name} transfer window`,
        value: { player: d.player.name, from: d.from.name, to: d.to.name, fee: d.fee, teamId: d.to.id },
        source: { table: "transfer_bids", id: d.id },
      });
  for (const teamId of teamIds)
    for (const t of await takeoverStories(db, teamId))
      if (t.returned.slug === (await db<{ slug: string }[]>`select slug from seasons where id = ${seasonId}`)[0]?.slug)
        out.push({
          id: `takeover:${seasonId}:${teamId}`,
          kind: "news",
          statement: `${t.to} are playing their first season under new owners, after ${t.from} withdrew from ${t.withdrew.season.name} before round ${t.withdrew.round}, unable to pay their wages`,
          value: { from: t.from, to: t.to, teamId },
          source: { table: "team_identities", id: teamId },
        });
  return out;
}

/** "Harbour City's", "Northgate Comets'". */
export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

const kickoffText = (d: Date | null) =>
  d ? `${d.toISOString().slice(0, 10)} at ${d.toISOString().slice(11, 16)} UTC` : "a time still to be confirmed";

/**
 * Facts known before a fixture kicks off: what it is and when, the table and title race after the
 * previous round, earlier meetings this season, each club's last result, run of form and leading
 * scorer through the previous round, league history, and any tactics a manager has already
 * committed for this fixture. Built only from rounds before the fixture's own, so it's the same
 * whenever it's read: no result of this fixture or any later round can appear in it.
 */
export async function prematchFacts(db: Db, fixtureId: string): Promise<EditorialFacts & { asOfRound: number }> {
  const [f] = await db<FixtureRow[]>`
    select f.id, f.season_id, f.round, f.scheduled_at, f.home_team_id, f.away_team_id, team_name_as_of(h.id, f.season_id) as home_name, team_name_as_of(a.id, f.season_id) as away_name
    from fixtures f join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
    where f.id = ${fixtureId}`;
  if (!f) throw new Error(`fixture ${fixtureId} not found`);
  const asOf = f.round - 1;
  const facts: Fact[] = [
    {
      id: `fixture:${f.id}`,
      kind: "fixture",
      statement: `Round ${f.round}: ${f.home_name} host ${f.away_name}, kick-off scheduled for ${kickoffText(f.scheduled_at)}`,
      value: {
        round: f.round,
        scheduledAt: f.scheduled_at?.toISOString() ?? null,
        homeTeam: { id: f.home_team_id, name: f.home_name },
        awayTeam: { id: f.away_team_id, name: f.away_name },
      },
      source: { table: "fixtures", id: f.id },
    },
  ];
  if (asOf > 0) {
    facts.push(...(await standingFacts(db, f.season_id, asOf)), ...(await raceFact(db, f.season_id, asOf)));
  }
  type Played = Pick<
    MatchRow,
    "id" | "round" | "home_name" | "away_name" | "home_score" | "away_score" | "events" | "request"
  > & {
    home_id: string;
    away_id: string;
  };
  const played = await db<Played[]>`
    select m.id, f.round, f.home_team_id as home_id, f.away_team_id as away_id, team_name_as_of(h.id, f.season_id) as home_name, team_name_as_of(a.id, f.season_id) as away_name,
      m.home_score, m.away_score, m.events, m.request
    from matches m join fixtures f on f.id = m.fixture_id
    join teams h on h.id = f.home_team_id join teams a on a.id = f.away_team_id
    where f.season_id = ${f.season_id} and m.status = 'completed' and f.round < ${f.round}
    order by f.round`;
  const scoreFact = (p: Played, statement: string): Fact => ({
    id: `match:${p.id}:score`,
    kind: "score",
    statement,
    value: {
      home: p.home_score,
      away: p.away_score,
      round: p.round,
      homeTeam: { id: p.home_id, name: p.home_name },
      awayTeam: { id: p.away_id, name: p.away_name },
    },
    source: { table: "matches", id: p.id },
  });
  const line = (p: Played) => `${p.home_name} ${p.home_score}–${p.away_score} ${p.away_name}`;
  const pair = new Set([f.home_team_id, f.away_team_id]);
  const seen = new Set<string>();
  for (const p of played.filter((x) => pair.has(x.home_id) && pair.has(x.away_id))) {
    facts.push(scoreFact(p, `Earlier meeting this season (round ${p.round}): ${line(p)}`));
    seen.add(p.id);
  }
  for (const [teamId, name] of [
    [f.home_team_id, f.home_name],
    [f.away_team_id, f.away_name],
  ] as const) {
    const last = played.filter((x) => x.home_id === teamId || x.away_id === teamId).at(-1);
    if (last && !seen.has(last.id)) {
      facts.push(scoreFact(last, `${possessive(name)} last match (round ${last.round}): ${line(last)}`));
      seen.add(last.id);
    }
    const form = asOf > 0 ? await formFact(db, f.season_id, teamId, name, asOf) : null;
    if (form) facts.push(form);
    // Leading scorer through the previous round (own goals don't count for the scorer).
    const goals = new Map<string, number>();
    const names = new Map<string, string>();
    for (const p of played) {
      const side = p.home_id === teamId ? "home" : p.away_id === teamId ? "away" : null;
      if (!side) continue;
      for (const s of p.request[side].starters) names.set(s.playerId, s.name);
      for (const e of p.events)
        if (e.type === "goal" && e.side === side && !e.ownGoal && e.scorerId && names.has(e.scorerId))
          goals.set(e.scorerId, (goals.get(e.scorerId) ?? 0) + 1);
    }
    const top = [...goals.entries()].sort((a, b) => b[1] - a[1] || names.get(a[0])!.localeCompare(names.get(b[0])!));
    if (top.length) {
      const best = top[0]![1];
      const leaders = top.filter(([, n]) => n === best).map(([id]) => names.get(id)!);
      facts.push({
        id: `scorers:${f.season_id}:r${asOf}:${teamId}`,
        kind: "stat",
        statement: `${possessive(name)} leading league scorer${leaders.length > 1 ? "s" : ""} before round ${f.round}: ${leaders.join(" and ")} (${best} goal${best === 1 ? "" : "s"}${leaders.length > 1 ? " each" : ""})`,
        value: { team: { id: teamId, name }, throughRound: asOf, players: leaders, goals: best },
        source: { table: "matches", id: `season:${f.season_id}` },
      });
    }
    // Tactics a manager has committed for this fixture (official once deployed as a revision).
    const [rev] = await db<{ id: string; version: number; deployment: MatchRow["request"]["home"]["deployment"] }[]>`
      select id, version, deployment from tactical_revisions
      where fixture_id = ${f.id} and team_id = ${teamId} and status = 'valid' and source = 'manager'
      order by version desc limit 1`;
    if (rev)
      facts.push({
        id: `fixture:${f.id}:tactics:${teamId}`,
        kind: "tactics",
        statement: `${possessive(name)} AI manager has committed to ${tacticsText(rev.deployment)} for this match (tactical revision v${rev.version})`,
        value: { revisionVersion: rev.version },
        source: { table: "tactical_revisions", id: rev.id },
      });
  }
  facts.push(...(await historyFacts(db, f.season_id)));
  facts.push(...(await clubEventFacts(db, f.season_id, [f.home_team_id, f.away_team_id], f.round)));
  return {
    contract: "editorial-facts/1",
    seasonId: f.season_id,
    matchId: null,
    generatedFrom: { resultFinalHash: null, standingsAfterRound: asOf },
    match: null,
    facts,
    asOfRound: asOf,
  };
}
