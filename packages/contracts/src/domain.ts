import { z } from "zod";
import { HexColor, Id, MicroUsd, Position, Sha256, Slug, Timestamp } from "./common.ts";
import { ControllerDeployment, Lineup } from "./deployment.ts";

export const Crest = z.object({
  shape: z.enum(["shield", "circle", "hexagon", "diamond"]),
  glyph: z.string().min(1).max(3).describe("short monogram rendered on the badge"),
});

export const Team = z.object({
  id: Id,
  slug: Slug,
  name: z.string().min(1).max(60),
  shortName: z.string().min(2).max(4),
  city: z.string().max(60),
  colors: z.object({ primary: HexColor, secondary: HexColor }),
  crest: Crest,
});
export type Team = z.infer<typeof Team>;

export const Player = z.object({
  id: Id,
  teamId: Id,
  name: z.string().min(1).max(60),
  shirtNumber: z.number().int().min(1).max(99),
  position: Position,
});
export type Player = z.infer<typeof Player>;

export const ManagerAgent = z.object({
  id: Id,
  teamId: Id,
  slug: Slug,
  name: z.string(),
  persona: z.string().describe("stable identity / voice, used verbatim in prompts"),
  philosophy: z.string(),
  model: z.string().describe("provider/model the manager runs on"),
  /** Durable strategy memory, rewritten after each post-match review. */
  memory: z.object({ summary: z.string(), notes: z.array(z.string()), updatedAt: Timestamp.nullable() }),
});
export type ManagerAgent = z.infer<typeof ManagerAgent>;

export const SeasonStatus = z.enum(["draft", "scheduled", "active", "completed"]);
export const Season = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  status: SeasonStatus,
  seed: z.number().int().nonnegative().describe("master seed; fixture seeds derive from it"),
  simVersion: z.string().describe("pinned simulator version for every match of the season"),
  playersPerTeam: z.union([z.literal(5), z.literal(7)]).describe("players per side: 5-a-side or 7-a-side"),
  budgetPerTeamMicroUsd: MicroUsd.nonnegative(),
  startsAt: Timestamp.nullable(),
  completedAt: Timestamp.nullable(),
});
export type Season = z.infer<typeof Season>;

export const FixtureStatus = z.enum(["scheduled", "ready", "playing", "completed", "failed"]);
export type FixtureStatus = z.infer<typeof FixtureStatus>;
export const Fixture = z.object({
  id: Id,
  seasonId: Id,
  round: z.number().int().positive(),
  homeTeamId: Id,
  awayTeamId: Id,
  status: FixtureStatus,
  scheduledAt: Timestamp.nullable(),
  matchId: Id.nullable(),
});
export type Fixture = z.infer<typeof Fixture>;

export const TacticalRevision = z.object({
  id: Id,
  teamId: Id,
  seasonId: Id,
  /** Monotonic per team+season. */
  version: z.number().int().positive(),
  fixtureId: Id.nullable().describe("fixture this revision was prepared for"),
  deployment: ControllerDeployment,
  lineup: Lineup,
  status: z.enum(["valid", "rejected"]),
  validationErrors: z.array(z.string()),
  source: z.enum(["seed", "manager", "fallback"]),
  agentRunId: Id.nullable(),
  rationale: z.string().nullable(),
  createdAt: Timestamp,
});
export type TacticalRevision = z.infer<typeof TacticalRevision>;

export const AgentRunStatus = z.enum(["queued", "running", "succeeded", "failed", "skipped_budget"]);
export const AgentRun = z.object({
  id: Id,
  agentKind: z.enum(["manager", "editorial"]),
  agentId: Id,
  purpose: z.enum(["pre_match", "post_match", "article"]),
  seasonId: Id,
  fixtureId: Id.nullable(),
  idempotencyKey: z.string().min(1),
  status: AgentRunStatus,
  attempt: z.number().int().nonnegative(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Full prompt messages as sent — audit trail. */
  prompt: z.unknown().nullable(),
  output: z.unknown().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costMicroUsd: MicroUsd.nonnegative(),
  error: z.string().nullable(),
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
});
export type AgentRun = z.infer<typeof AgentRun>;

export const ComputeTransaction = z.object({
  id: Id,
  seasonId: Id,
  teamId: Id,
  agentRunId: Id.nullable(),
  /** grant: +budget; reserve: −hold before a call; release: +unused hold; charge: −actual cost. */
  kind: z.enum(["grant", "reserve", "release", "charge"]),
  amountMicroUsd: MicroUsd,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  createdAt: Timestamp,
});
export type ComputeTransaction = z.infer<typeof ComputeTransaction>;

export const ReplayArtifact = z.object({
  id: Id,
  matchId: Id,
  uri: z.string().describe("storage URI; served via GET /api/v1/matches/{id}/replay"),
  format: z.literal("autosoccer-replay"),
  formatVersion: z.number().int().positive(),
  engineVersion: z.string(),
  sdkVersion: z.string().nullable(),
  byteSize: z.number().int().positive(),
  sha256: Sha256,
  finalHash: z.string(),
  verified: z.boolean().describe("replay re-simulated and every state hash matched"),
  createdAt: Timestamp,
});
export type ReplayArtifact = z.infer<typeof ReplayArtifact>;

export const EditorialRole = z.enum(["reporter", "analyst", "pundit"]);
export const EditorialAgent = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  role: EditorialRole,
  bio: z.string(),
  voice: z.string().describe("style guide used verbatim in prompts"),
  avatar: z.object({ shape: z.enum(["circle", "square", "hexagon"]), color: HexColor, initials: z.string().max(3) }),
  model: z.string(),
});
export type EditorialAgent = z.infer<typeof EditorialAgent>;

/** A claim in an article must point at a persisted official fact. */
export const FactCitation = z.object({
  factId: z.string().describe("stable id in the EditorialFacts projection, e.g. match:<id>:score"),
  text: z.string().describe("the claim as written"),
});
export const ArticleKind = z.enum(["match_report", "preview", "analysis", "column"]);
export const Article = z.object({
  id: Id,
  seasonId: Id,
  slug: Slug,
  kind: ArticleKind,
  status: z.enum(["draft", "published", "rejected"]),
  editorialAgentId: Id,
  headline: z.string().min(1).max(140),
  standfirst: z.string().max(300),
  body: z.string().describe("markdown"),
  citations: z.array(FactCitation),
  matchId: Id.nullable(),
  fixtureId: Id.nullable(),
  teamIds: z.array(Id),
  agentRunId: Id.nullable(),
  aiGenerated: z.literal(true).describe("every article is AI-written and disclosed as such"),
  publishedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type Article = z.infer<typeof Article>;
