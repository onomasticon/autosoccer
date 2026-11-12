/**
 * Public read API (v1) response contracts. Route handlers must return data that
 * parses with these schemas; the web app consumes them as types.
 */
import { z } from "zod";
import { ErrorEnvelope, Id, MicroUsd, Slug } from "./common.ts";
import {
  AgentRun,
  Article,
  EditorialAgent,
  Fixture,
  ManagerAgent,
  Player,
  ReplayArtifact,
  Season,
  TacticalRevision,
  Team,
} from "./domain.ts";
import { DugoutResponse, TeamDugoutResponse } from "./dugout.ts";
import { Match, OfficialEvent, TeamMatchStats } from "./match.ts";

export const FormResult = z.enum(["W", "D", "L"]);

export const StandingRow = z.object({
  position: z.number().int().positive(),
  team: Team,
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  drawn: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  goalsFor: z.number().int().nonnegative(),
  goalsAgainst: z.number().int().nonnegative(),
  goalDifference: z.number().int(),
  points: z.number().int().nonnegative(),
  /** Most recent last. */
  form: z.array(FormResult).max(5),
});
export type StandingRow = z.infer<typeof StandingRow>;

export const FixtureView = Fixture.extend({
  home: Team,
  away: Team,
  score: z.object({ home: z.number().int(), away: z.number().int() }).nullable(),
});
export type FixtureView = z.infer<typeof FixtureView>;

export const PublicManager = ManagerAgent.pick({
  id: true,
  slug: true,
  name: true,
  persona: true,
  philosophy: true,
  model: true,
  memory: true,
});

export const SeasonResponse = z.object({ season: Season, teams: z.array(Team), rounds: z.number().int() });
/** Who can still win the league after the last completed round, and whether it's settled. */
export const TitleRace = z.object({
  roundsLeft: z.number().int().nonnegative(),
  /** Teams that can still finish first, leader first (just the champion once it's settled). */
  contenders: z.array(Team),
  /** Set once nobody can catch the leader, before or at the end of the season. */
  clinched: Team.nullable(),
});
export type TitleRace = z.infer<typeof TitleRace>;

export const StandingsResponse = z.object({
  season: Season,
  afterRound: z.number().int().nonnegative(),
  rows: z.array(StandingRow),
  race: TitleRace,
});
/** One line of the roll of honour: a season and, once played, who won it and who scored most. */
export const SeasonSummary = z.object({
  season: Season,
  /** Rounds completed so far, and in total. */
  roundsPlayed: z.number().int().nonnegative(),
  rounds: z.number().int().nonnegative(),
  /** First in the table: the champion once the season is completed, the leader before that. */
  leader: StandingRow.nullable(),
  runnerUp: StandingRow.nullable(),
  /** Points between first and second. */
  margin: z.number().int().nonnegative().nullable(),
  /** Players level on the most goals (own goals excluded). Empty before the first goal. */
  topScorers: z.array(z.object({ playerId: Id, name: z.string(), team: Team, goals: z.number().int().positive() })),
  /** Round after which the title could no longer change hands (null while it's open). */
  decidedAfterRound: z.number().int().positive().nullable(),
  goalsPerMatch: z.number().nonnegative(),
});
export const SeasonListResponse = z.object({ items: z.array(SeasonSummary) });

/** Goals per player (own goals excluded), most first; ties share a rank. */
export const ScorerRow = z.object({
  rank: z.number().int().positive(),
  playerId: Id,
  name: z.string(),
  team: Team,
  goals: z.number().int().positive(),
  /** Matches the player started (from the official lineups). */
  matches: z.number().int().nonnegative(),
});
export const ScorersResponse = z.object({
  /** The season, or null for all seasons together. */
  season: Season.nullable(),
  items: z.array(ScorerRow),
});

const SeasonRef = Season.pick({ slug: true, name: true });
/** League records across every completed season (ties listed together). */
export const RecordsResponse = z.object({
  mostPoints: z.array(z.object({ season: SeasonRef, team: Team, points: z.number().int(), played: z.number().int() })),
  perfectSeasons: z.array(z.object({ season: SeasonRef, team: Team, won: z.number().int() })),
  mostGoalsInSeason: z.array(z.object({ season: SeasonRef, name: z.string(), team: Team, goals: z.number().int() })),
  biggestWin: z.array(
    z.object({
      season: SeasonRef,
      round: z.number().int(),
      matchId: Id,
      winner: Team,
      loser: Team,
      score: z.string(),
      margin: z.number().int(),
    }),
  ),
});

export const FixturesResponse = z.object({
  season: Season,
  rounds: z.array(z.object({ round: z.number().int().positive(), fixtures: z.array(FixtureView) })),
});
export const TeamListResponse = z.object({ items: z.array(Team) });
export const TeamDetailResponse = z.object({
  team: Team,
  players: z.array(Player),
  manager: PublicManager.nullable(),
  standing: StandingRow.nullable(),
  fixtures: z.array(FixtureView),
  currentRevision: TacticalRevision.pick({
    id: true,
    version: true,
    deployment: true,
    rationale: true,
    createdAt: true,
  }).nullable(),
  /** Final position in every completed season, newest first. */
  history: z.array(
    z.object({
      season: Season.pick({ slug: true, name: true }),
      position: z.number().int().positive(),
      points: z.number().int().nonnegative(),
      played: z.number().int().nonnegative(),
      champion: z.boolean(),
    }),
  ),
  /** Goals per squad player: this season and all seasons (own goals excluded). */
  goals: z.array(
    z.object({ playerId: Id, season: z.number().int().nonnegative(), allTime: z.number().int().nonnegative() }),
  ),
  /** When the manager last rewrote their notebook, so stale notes read as last season's. */
  memoryWrittenAfter: z.object({ season: z.string(), round: z.number().int().positive() }).nullable(),
});
export const MatchDetailResponse = z.object({
  match: Match,
  fixture: FixtureView,
  events: z.array(OfficialEvent),
  stats: z.object({ home: TeamMatchStats, away: TeamMatchStats }).nullable(),
  lineups: z.object({ home: z.array(Player), away: z.array(Player) }),
  replay: ReplayArtifact.nullable(),
  revisions: z.object({
    home: TacticalRevision.pick({ id: true, version: true, deployment: true, rationale: true }).nullable(),
    away: TacticalRevision.pick({ id: true, version: true, deployment: true, rationale: true }).nullable(),
  }),
});
export const ArticleCardView = Article.pick({
  id: true,
  slug: true,
  kind: true,
  headline: true,
  standfirst: true,
  matchId: true,
  teamIds: true,
  aiGenerated: true,
  publishedAt: true,
}).extend({ author: EditorialAgent.pick({ slug: true, name: true, role: true, avatar: true }) });
export const ArticleListResponse = z.object({ items: z.array(ArticleCardView), total: z.number().int() });
export const ArticleDetailResponse = z.object({
  article: Article,
  author: EditorialAgent,
  related: z.array(ArticleCardView),
});
export const JournalistListResponse = z.object({ items: z.array(EditorialAgent) });
export const JournalistDetailResponse = z.object({ journalist: EditorialAgent, articles: z.array(ArticleCardView) });
export const BudgetRow = z.object({
  teamId: Id,
  grantedMicroUsd: MicroUsd,
  spentMicroUsd: MicroUsd,
  reservedMicroUsd: MicroUsd,
  remainingMicroUsd: MicroUsd,
  runs: z.number().int().nonnegative(),
  exhausted: z.boolean(),
});
export const BudgetResponse = z.object({ seasonId: Id, rows: z.array(BudgetRow) });

export interface RouteDef {
  method: "get";
  path: string;
  operationId: string;
  summary: string;
  params?: Record<string, z.ZodType>;
  query?: Record<string, z.ZodType>;
  response: z.ZodType;
  responseName: string;
  /** Non-JSON responses (e.g. replay file download). */
  contentType?: string;
}

const SeasonSlugParam = { season: Slug };
export const ROUTES: RouteDef[] = [
  {
    method: "get",
    path: "/seasons",
    operationId: "listSeasons",
    summary: "Every season, newest first: champion (or leader), runner-up, margin, top scorers",
    response: SeasonListResponse,
    responseName: "SeasonListResponse",
  },
  {
    method: "get",
    path: "/records",
    operationId: "getRecords",
    summary: "League records across completed seasons: most points, perfect seasons, most goals, biggest win",
    response: RecordsResponse,
    responseName: "RecordsResponse",
  },
  {
    method: "get",
    path: "/scorers",
    operationId: "listAllTimeScorers",
    summary: "All-time top scorers across every season",
    response: ScorersResponse,
    responseName: "ScorersResponse",
  },
  {
    method: "get",
    path: "/seasons/{season}/scorers",
    operationId: "listScorers",
    summary: "A season's top scorers (own goals excluded)",
    params: SeasonSlugParam,
    response: ScorersResponse,
    responseName: "ScorersResponse",
  },
  {
    method: "get",
    path: "/seasons/current",
    operationId: "getCurrentSeason",
    summary: "Current season with its teams",
    response: SeasonResponse,
    responseName: "SeasonResponse",
  },
  {
    method: "get",
    path: "/seasons/{season}/standings",
    operationId: "getStandings",
    summary: "League table (points, GD, GF, head-to-head tie-breaks)",
    params: SeasonSlugParam,
    response: StandingsResponse,
    responseName: "StandingsResponse",
  },
  {
    method: "get",
    path: "/seasons/{season}/fixtures",
    operationId: "getFixtures",
    summary: "Fixtures and results grouped by round",
    params: SeasonSlugParam,
    response: FixturesResponse,
    responseName: "FixturesResponse",
  },
  {
    method: "get",
    path: "/seasons/{season}/budget",
    operationId: "getBudget",
    summary: "Per-team compute budget ledger summary",
    params: SeasonSlugParam,
    response: BudgetResponse,
    responseName: "BudgetResponse",
  },
  {
    method: "get",
    path: "/teams",
    operationId: "listTeams",
    summary: "All teams",
    response: TeamListResponse,
    responseName: "TeamListResponse",
  },
  {
    method: "get",
    path: "/teams/{team}",
    operationId: "getTeam",
    summary: "Team profile: roster, manager, form, fixtures",
    params: { team: Slug },
    response: TeamDetailResponse,
    responseName: "TeamDetailResponse",
  },
  {
    method: "get",
    path: "/matches/{match}",
    operationId: "getMatch",
    summary: "Match centre: result, events, stats, lineups, replay",
    params: { match: Id },
    response: MatchDetailResponse,
    responseName: "MatchDetailResponse",
  },
  {
    method: "get",
    path: "/matches/{match}/replay",
    operationId: "getMatchReplay",
    summary: "Replay file (autosoccer-replay v1, gzip JSON)",
    params: { match: Id },
    response: z.unknown(),
    responseName: "ReplayFile",
    contentType: "application/gzip",
  },
  {
    method: "get",
    path: "/articles",
    operationId: "listArticles",
    summary: "Published articles, newest first",
    query: { limit: z.coerce.number().int().min(1).max(50).optional(), team: Slug.optional(), match: Id.optional() },
    response: ArticleListResponse,
    responseName: "ArticleListResponse",
  },
  {
    method: "get",
    path: "/articles/{article}",
    operationId: "getArticle",
    summary: "Article with author and related stories",
    params: { article: Slug },
    response: ArticleDetailResponse,
    responseName: "ArticleDetailResponse",
  },
  {
    method: "get",
    path: "/journalists",
    operationId: "listJournalists",
    summary: "Persistent AI journalists",
    response: JournalistListResponse,
    responseName: "JournalistListResponse",
  },
  {
    method: "get",
    path: "/journalists/{journalist}",
    operationId: "getJournalist",
    summary: "Journalist profile with articles",
    params: { journalist: Slug },
    response: JournalistDetailResponse,
    responseName: "JournalistDetailResponse",
  },
];

export { ErrorEnvelope };

export type ArticleCardView = z.infer<typeof ArticleCardView>;
export type SeasonResponse = z.infer<typeof SeasonResponse>;
export type StandingsResponse = z.infer<typeof StandingsResponse>;
export type FixturesResponse = z.infer<typeof FixturesResponse>;
export type SeasonSummary = z.infer<typeof SeasonSummary>;
export type SeasonListResponse = z.infer<typeof SeasonListResponse>;
export type ScorerRow = z.infer<typeof ScorerRow>;
export type ScorersResponse = z.infer<typeof ScorersResponse>;
export type RecordsResponse = z.infer<typeof RecordsResponse>;
export type TeamListResponse = z.infer<typeof TeamListResponse>;
export type TeamDetailResponse = z.infer<typeof TeamDetailResponse>;
export type MatchDetailResponse = z.infer<typeof MatchDetailResponse>;
export type ArticleListResponse = z.infer<typeof ArticleListResponse>;
export type ArticleDetailResponse = z.infer<typeof ArticleDetailResponse>;
export type JournalistListResponse = z.infer<typeof JournalistListResponse>;
export type JournalistDetailResponse = z.infer<typeof JournalistDetailResponse>;
export type BudgetResponse = z.infer<typeof BudgetResponse>;

export const RevisionHistoryResponse = z.object({ team: Team, seasonId: Id, items: z.array(TacticalRevision) });
export type RevisionHistoryResponse = z.infer<typeof RevisionHistoryResponse>;
ROUTES.push({
  method: "get",
  path: "/teams/{team}/revisions",
  operationId: "getTeamRevisions",
  summary: "Tactical revision history for the current season (valid and rejected, for audit)",
  params: { team: Slug },
  response: RevisionHistoryResponse,
  responseName: "RevisionHistoryResponse",
});

export const AgentRunListResponse = z.object({ team: Team, items: z.array(AgentRun) });
export type AgentRunListResponse = z.infer<typeof AgentRunListResponse>;
ROUTES.push({
  method: "get",
  path: "/teams/{team}/agent-runs",
  operationId: "getTeamAgentRuns",
  summary: "Manager agent runs for the current season: prompts, outputs, model, tokens and cost (audit trail)",
  params: { team: Slug },
  response: AgentRunListResponse,
  responseName: "AgentRunListResponse",
});

ROUTES.push(
  {
    method: "get",
    path: "/seasons/{season}/dugout",
    operationId: "getDugout",
    summary:
      "Inside the Dugout: each AI manager's decision → match → reflection chain, and two managers' readings of the same result",
    params: SeasonSlugParam,
    response: DugoutResponse,
    responseName: "DugoutResponse",
  },
  {
    method: "get",
    path: "/teams/{team}/dugout",
    operationId: "getTeamDugout",
    summary: "One club's manager story for the current season (decisions, results, lessons, next fixture)",
    params: { team: Slug },
    response: TeamDugoutResponse,
    responseName: "TeamDugoutResponse",
  },
);
