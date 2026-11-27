/**
 * spotlight/1: the homepage lead, chosen from official events by a fixed rule (docs/spotlight.md).
 *
 * Candidates: every player who scored (own goals excluded) in the round's completed matches.
 * Ranked by, in order:
 *   1. goals in the match (a hat-trick beats a brace beats one goal);
 *   2. a decisive goal: the winner (the goal that put their side ahead for good) beats the
 *      equaliser (the goal that made the final score level), which beats neither;
 *   3. their side's result: win, then draw, then defeat;
 *   4. the later decisive (or last) goal, as a late winner is the bigger moment;
 *   5. name, then player id, so the choice never depends on query order.
 * A round with no goals is "quiet": the lead is then the season's leading scorer (else the
 * all-time leader), with their next match as the action. No goals ever: no lead.
 *
 * Every sentence below is assembled from the record passed in. Nothing is AI-written.
 */
import type {
  Spotlight,
  SpotlightGoal,
  SpotlightKind,
  SpotlightNext,
  SpotlightPlayer,
  Team,
} from "@autosoccer/contracts";

export const SPOTLIGHT_RULE = "spotlight/1";
/** Two goals at most this many match seconds apart (same half) make the "quickfire" detail. */
export const QUICKFIRE_SEC = 60;

type Side = "home" | "away";
export interface GoalEvent {
  type: "goal";
  tick: number;
  period: "firstHalf" | "secondHalf";
  clockSec: number;
  side: Side;
  scorerId: string | null;
  ownGoal: boolean;
  score: { home: number; away: number };
}

export interface MatchInput {
  matchId: string;
  fixtureId: string;
  round: number;
  season: { slug: string; name: string };
  home: Team;
  away: Team;
  /** Official events (only goals are read). */
  events: ReadonlyArray<{ type: string } & Partial<GoalEvent>>;
  replay: boolean;
}

/** League-wide context the details are drawn from (all counts as of now, from the record). */
export interface SpotlightContext {
  players: ReadonlyMap<string, SpotlightPlayer & { teamId: string }>;
  /** All seasons: goals and starts per player (own goals excluded). */
  allTime: ReadonlyMap<string, { goals: number; starts: number }>;
  /** The lead's season: goals and starts per player. */
  season: ReadonlyMap<string, { goals: number; starts: number }>;
  /** The club's next fixture in the current season, by team id. */
  next: ReadonlyMap<string, SpotlightNext>;
  /** This season's signings (#80), by player id: where from, the fee, and the season. */
  signings?: ReadonlyMap<string, { from: string; fee: string; season: string }>;
  /** Clubs in their first season under new owners (#80), by team id. */
  rescued?: ReadonlyMap<string, { from: string; withdrewFrom: string; season: string }>;
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);
export const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
export const surname = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const clock = (g: { period: string; clockSec: number }) =>
  `${g.period === "firstHalf" ? "1H" : "2H"} ${Math.floor(g.clockSec / 60)}:${String(Math.floor(g.clockSec % 60)).padStart(2, "0")}`;

const goalsOf = (m: MatchInput): GoalEvent[] =>
  m.events
    .filter((e): e is GoalEvent => e.type === "goal" && typeof e.tick === "number" && !!e.score && !!e.side)
    .sort((a, b) => a.tick - b.tick);

interface Candidate {
  match: MatchInput;
  playerId: string;
  side: Side;
  goals: GoalEvent[];
  kind: Exclude<SpotlightKind, "quiet">;
  decisive: 0 | 1 | 2;
  result: 0 | 1 | 2;
  /** The decisive goal's tick, else the last goal's. */
  keyTick: number;
}

/** Every scorer in the match (optionally one side only), with how their goals mattered. */
export function candidates(m: MatchInput, onlySide?: Side): Candidate[] {
  const all = goalsOf(m);
  const final = all.at(-1)?.score ?? { home: 0, away: 0 };
  const by = new Map<string, GoalEvent[]>();
  for (const g of all) {
    if (g.ownGoal || !g.scorerId || (onlySide && g.side !== onlySide)) continue;
    by.set(g.scorerId, [...(by.get(g.scorerId) ?? []), g]);
  }
  const out: Candidate[] = [];
  for (const [playerId, goals] of by) {
    const side = goals[0]!.side;
    const other: Side = side === "home" ? "away" : "home";
    const gf = final[side];
    const ga = final[other];
    const result = gf > ga ? 2 : gf === ga ? 1 : 0;
    // Winner: the goal that took their side to (opponent's final + 1), after which they led for good.
    const winner = result === 2 ? goals.find((g) => g.score[side] === ga + 1) : undefined;
    // Equaliser: in a draw, the goal that made the final score.
    const equaliser =
      result === 1 && gf > 0
        ? goals.find((g) => g.score.home === final.home && g.score.away === final.away)
        : undefined;
    const decisive = winner ? 2 : equaliser ? 1 : 0;
    const kind =
      goals.length >= 3
        ? "hat_trick"
        : goals.length === 2
          ? "brace"
          : winner
            ? "winner"
            : equaliser
              ? "equaliser"
              : "goal";
    out.push({
      match: m,
      playerId,
      side,
      goals,
      kind,
      decisive,
      result,
      keyTick: (winner ?? equaliser ?? goals.at(-1)!).tick,
    });
  }
  return out;
}

export function rank(a: Candidate, b: Candidate, names: (id: string) => string): number {
  return (
    b.goals.length - a.goals.length ||
    b.decisive - a.decisive ||
    b.result - a.result ||
    b.keyTick - a.keyTick ||
    names(a.playerId).localeCompare(names(b.playerId)) ||
    (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
  );
}

/** The closest two of the player's goals in the same half, in match seconds (null if under two). */
export function closestPair(goals: readonly GoalEvent[]): number | null {
  let best: number | null = null;
  for (let i = 1; i < goals.length; i++) {
    const a = goals[i - 1]!;
    const b = goals[i]!;
    if (a.period !== b.period) continue;
    const d = Math.round(b.clockSec - a.clockSec);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** The league's top all-time scorer(s) (ids level on the most goals). */
function leaders(table: ReadonlyMap<string, { goals: number }>): { ids: Set<string>; goals: number } {
  let goals = 0;
  for (const v of table.values()) goals = Math.max(goals, v.goals);
  return { ids: new Set([...table].filter(([, v]) => v.goals === goals && goals > 0).map(([id]) => id)), goals };
}

/** The one verified detail that gives the moment significance: the first that applies. */
export function detailFor(c: Candidate, ctx: SpotlightContext, name: string): string {
  const pair = closestPair(c.goals);
  if (pair !== null && pair <= QUICKFIRE_SEC)
    return c.goals.length === 2
      ? `The two goals came ${pair} match seconds apart.`
      : `Two of them came ${pair} match seconds apart.`;
  // A transfer or a rescue with sporting significance (#80): a new signing scoring, or a rescued
  // club winning, in the season it happened.
  const signed = ctx.signings?.get(c.playerId);
  if (signed && signed.season === c.match.season.slug)
    return `A new signing: ${name} joined from ${signed.from} for ${signed.fee} before ${c.match.season.name}.`;
  const team = c.side === "home" ? c.match.home : c.match.away;
  const rescued = ctx.rescued?.get(team.id);
  if (rescued && rescued.season === c.match.season.slug && c.result === 2)
    return `It's ${possessive(team.name)} first season under new owners, after ${rescued.from} withdrew from ${rescued.withdrewFrom}.`;
  const all = ctx.allTime.get(c.playerId);
  const top = leaders(ctx.allTime);
  if (all && top.ids.has(c.playerId))
    return top.ids.size === 1
      ? `${name} is the league's all-time top scorer: ${all.goals} goals in ${all.starts} starts.`
      : `${name} is level at the top of the all-time scorers, with ${all.goals} goals.`;
  const season = ctx.season.get(c.playerId);
  const st = leaders(ctx.season);
  if (season && st.ids.has(c.playerId) && season.goals >= 2)
    return st.ids.size === 1
      ? `${possessive(name)} ${season.goals} goals lead the ${c.match.season.name} scoring chart.`
      : `${possessive(name)} ${season.goals} goals put them level at the top of the ${c.match.season.name} scoring chart.`;
  const g = c.goals.find((x) => x.tick === c.keyTick)!;
  const final = goalsOf(c.match).at(-1)!.score;
  if (c.decisive === 2)
    return final.home + final.away === 1 ? "It was the only goal of the match." : `The winner came at ${clock(g)}.`;
  if (c.decisive === 1) return `The equaliser came at ${clock(g)}.`;
  if (all) return `It took ${surname(name)} to ${all.goals} league goals in ${all.starts} starts.`;
  return `${name} has ${c.goals.length} league goal${c.goals.length === 1 ? "" : "s"}.`;
}

function headlineFor(c: Candidate, name: string): string {
  const m = c.match;
  const team = c.side === "home" ? m.home : m.away;
  const opp = c.side === "home" ? m.away : m.home;
  const final = goalsOf(m).at(-1)!.score;
  const gf = final[c.side];
  const ga = final[c.side === "home" ? "away" : "home"];
  const result =
    c.result === 2
      ? `as ${team.name} beat ${opp.name} ${gf}–${ga}`
      : c.result === 1
        ? `in ${possessive(team.name)} ${gf}–${ga} draw with ${opp.name}`
        : `in ${possessive(team.name)} ${gf}–${ga} defeat to ${opp.name}`;
  const did =
    c.goals.length >= 3
      ? `scored ${word(c.goals.length)}`
      : c.goals.length === 2
        ? "scored twice"
        : c.kind === "winner"
          ? "scored the winner"
          : c.kind === "equaliser"
            ? "scored the equaliser"
            : "scored";
  return `${name} ${did} ${result}.`;
}

function actionFor(c: Candidate, name: string): string {
  const s = possessive(surname(name));
  if (!c.match.replay) return `Read the record of ${s} match`;
  if (c.goals.length > 1) return `Watch ${s} ${word(c.goals.length)} goals`;
  return `Watch ${s} ${c.kind === "winner" ? "winner" : c.kind === "equaliser" ? "equaliser" : "goal"}`;
}

const toGoal = (g: GoalEvent): SpotlightGoal => ({
  tick: g.tick,
  period: g.period,
  clockSec: g.clockSec,
  score: g.score,
});

function spotlightOf(c: Candidate, ctx: SpotlightContext): Spotlight {
  const p = ctx.players.get(c.playerId);
  const m = c.match;
  const team = c.side === "home" ? m.home : m.away;
  const name = p?.name ?? "Unknown player";
  return {
    kind: c.kind,
    player: p
      ? { id: p.id, name: p.name, shirtNumber: p.shirtNumber, position: p.position }
      : { id: c.playerId, name, shirtNumber: 0, position: "FW" },
    team,
    opponent: c.side === "home" ? m.away : m.home,
    season: m.season,
    round: m.round,
    matchId: m.matchId,
    fixtureId: m.fixtureId,
    headline: headlineFor(c, name),
    detail: detailFor(c, ctx, name),
    goals: c.goals.map(toGoal),
    replay: m.replay,
    action: actionFor(c, name),
    next: ctx.next.get(team.id) ?? null,
  };
}

/** The best moment in these matches (one club's or player's goals only, if given), or null with no scorer. */
export function pickMoment(
  matches: readonly MatchInput[],
  ctx: SpotlightContext,
  only: { teamId?: string; playerId?: string } = {},
): Spotlight | null {
  const names = (id: string) => ctx.players.get(id)?.name ?? "";
  const { teamId, playerId } = only;
  const all = matches
    .flatMap((m) =>
      candidates(m, teamId ? (m.home.id === teamId ? "home" : m.away.id === teamId ? "away" : undefined) : undefined),
    )
    .filter((c) => !playerId || c.playerId === playerId);
  const best = all.sort((a, b) => rank(a, b, names))[0];
  return best ? spotlightOf(best, ctx) : null;
}

/** The lead for a round: its best moment, else (a goalless round) the quiet-round lead. */
export function pickLead(
  round: { round: number; season: { slug: string; name: string }; matches: readonly MatchInput[] },
  ctx: SpotlightContext,
  teams: ReadonlyMap<string, Team>,
): Spotlight | null {
  const best = pickMoment(round.matches, ctx);
  if (best) return best;
  // Quiet round: the season's leading scorer, else the all-time leader.
  const table = [...ctx.season].some(([, v]) => v.goals > 0) ? ctx.season : ctx.allTime;
  const names = (id: string) => ctx.players.get(id)?.name ?? "";
  const top = [...table]
    .filter(([id, v]) => v.goals > 0 && ctx.players.has(id))
    .sort(([a, x], [b, y]) => y.goals - x.goals || x.starts - y.starts || names(a).localeCompare(names(b)))[0];
  if (!top) return null;
  const [id, rec] = top;
  const p = ctx.players.get(id)!;
  const team = teams.get(p.teamId);
  if (!team) return null;
  const all = ctx.allTime.get(id) ?? rec;
  const allTop = leaders(ctx.allTime);
  const where = table === ctx.season ? `the ${round.season.name} scoring` : "the all-time scorers";
  const next = ctx.next.get(team.id) ?? null;
  const detail =
    allTop.ids.has(id) && table === ctx.season
      ? `${p.name} is also the league's all-time top scorer: ${all.goals} goals in ${all.starts} starts.`
      : `${rec.goals} goals in ${rec.starts} starts${table === ctx.season ? ` in ${round.season.name}` : ""}; ${all.goals} in all.`;
  return {
    kind: "quiet",
    player: { id: p.id, name: p.name, shirtNumber: p.shirtNumber, position: p.position },
    team,
    opponent: next?.opponent ?? null,
    season: round.season,
    round: round.round,
    matchId: null,
    fixtureId: null,
    headline: `Round ${round.round} ended without a goal. ${p.name} still leads ${where} with ${rec.goals}.`,
    detail,
    goals: [],
    replay: false,
    action: next ? `See ${possessive(surname(p.name))} next match` : `See ${possessive(surname(p.name))} career`,
    next,
  };
}
