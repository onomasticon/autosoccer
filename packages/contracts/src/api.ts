/**
 * Public read API (v1) response contracts. Route handlers must return data that
 * parses with these schemas; the web app consumes them as types.
 */
import { z } from "zod";
import { ErrorEnvelope, Id, MicroUsd, Slug } from "./common.ts";
import {
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
});

export const SeasonResponse = z.object({ season: Season, teams: z.array(Team), rounds: z.number().int() });
export const StandingsResponse = z.object({
  season: Season,
  afterRound: z.number().int().nonnegative(),
  rows: z.array(StandingRow),
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
export type TeamListResponse = z.infer<typeof TeamListResponse>;
export type TeamDetailResponse = z.infer<typeof TeamDetailResponse>;
export type MatchDetailResponse = z.infer<typeof MatchDetailResponse>;
export type ArticleListResponse = z.infer<typeof ArticleListResponse>;
export type ArticleDetailResponse = z.infer<typeof ArticleDetailResponse>;
export type JournalistListResponse = z.infer<typeof JournalistListResponse>;
export type JournalistDetailResponse = z.infer<typeof JournalistDetailResponse>;
export type BudgetResponse = z.infer<typeof BudgetResponse>;
