import { z } from "zod";
import { Id, Position, Sha256, Side, Timestamp } from "./common.ts";
import { ControllerDeployment } from "./deployment.ts";

/** Versions that fully identify how a match was produced. */
export const SimVersionInfo = z.object({
  /** Pinned autosoccer-sim git commit. */
  simCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
  engineVersion: z.string(),
  sdkVersion: z.string(),
  adapterVersion: z.string(),
  replayFormatVersion: z.number().int().positive(),
});
export type SimVersionInfo = z.infer<typeof SimVersionInfo>;

export const MatchTeamEntry = z.object({
  teamId: Id,
  name: z.string(),
  /** Exactly five starters in simulator slot order: [GK, DF, DF, MF, FW]. */
  starters: z
    .array(z.object({ playerId: Id, name: z.string(), shirtNumber: z.number().int(), position: Position }))
    .length(5),
  tacticalRevisionId: Id.nullable(),
  deployment: ControllerDeployment,
});
export type MatchTeamEntry = z.infer<typeof MatchTeamEntry>;

/** Everything the simulator adapter needs. A pure function of this request yields the MatchResult. */
export const MatchRequest = z.object({
  contract: z.literal("match-request/1"),
  fixtureId: Id,
  seed: z.number().int().nonnegative().max(0xffffffff),
  simVersion: z.string().describe("required pinned sim commit; adapter refuses a mismatch"),
  home: MatchTeamEntry,
  away: MatchTeamEntry,
  config: z
    .object({
      halfDurationSec: z.number().positive().optional(),
    })
    .default({}),
});
export type MatchRequest = z.infer<typeof MatchRequest>;

export const Period = z.enum(["firstHalf", "secondHalf"]);

const EventBase = z.object({
  tick: z.number().int().nonnegative(),
  period: Period,
  /** Seconds elapsed on the match clock in this half (simulator time, not real minutes). */
  clockSec: z.number().nonnegative(),
});
/** Official, persisted match events — the only source for standings and editorial facts. */
export const OfficialEvent = z.discriminatedUnion("type", [
  EventBase.extend({
    type: z.literal("goal"),
    side: Side,
    scorerId: Id.nullable(),
    ownGoal: z.boolean(),
    score: z.object({ home: z.number().int(), away: z.number().int() }),
  }),
  EventBase.extend({ type: z.literal("foul"), side: Side, playerId: Id, againstId: Id }),
  EventBase.extend({
    type: z.literal("restart"),
    side: Side,
    restart: z.enum(["kickoff", "kickIn", "corner", "goalKick", "freeKick"]),
    takerId: Id,
  }),
  EventBase.extend({ type: z.literal("periodStart") }),
  EventBase.extend({ type: z.literal("periodEnd") }),
]);
export type OfficialEvent = z.infer<typeof OfficialEvent>;

/** Mirrors autosoccer-sim match-runner `TeamStats` (derived from the event log). */
export const TeamMatchStats = z.object({
  goals: z.number().int(),
  passes: z.number().int(),
  passesCompleted: z.number().int(),
  passesIntercepted: z.number().int(),
  avgPassLength: z.number(),
  forwardPassShare: z.number(),
  shots: z.number().int(),
  shotsOnTarget: z.number().int(),
  avgShotDistance: z.number(),
  dribbleTouches: z.number().int(),
  tackles: z.number().int(),
  tacklesWon: z.number().int(),
  interceptions: z.number().int(),
  keeperCatches: z.number().int(),
  keeperReleases: z.number().int(),
  fouls: z.number().int(),
  restartsTaken: z.number().int(),
  restartFallbacks: z.number().int(),
  possession: z.number().min(0).max(1),
  avgTeamHeight: z.number(),
});
export type TeamMatchStats = z.infer<typeof TeamMatchStats>;

export const MatchResult = z.object({
  contract: z.literal("match-result/1"),
  fixtureId: Id,
  seed: z.number().int().nonnegative(),
  versions: SimVersionInfo,
  /** sha256 of the canonical MatchRequest JSON; same request ⇒ same result. */
  requestHash: Sha256,
  finalHash: z.string().describe("simulator final world-state hash"),
  score: z.object({ home: z.number().int().nonnegative(), away: z.number().int().nonnegative() }),
  events: z.array(OfficialEvent),
  stats: z.object({ home: TeamMatchStats, away: TeamMatchStats }),
  ticks: z.number().int().positive(),
  replay: z.object({
    uri: z.string(),
    sha256: Sha256,
    byteSize: z.number().int().positive(),
    verified: z.boolean(),
  }),
  diagnostics: z.object({
    controllerFailures: z.array(z.string()),
    invariantViolations: z.array(z.string()),
    wallMs: z.number().nonnegative(),
  }),
});
export type MatchResult = z.infer<typeof MatchResult>;

export const MatchStatus = z.enum(["pending", "running", "completed", "failed"]);
export const Match = z.object({
  id: Id,
  fixtureId: Id,
  status: MatchStatus,
  seed: z.number().int().nonnegative(),
  requestHash: Sha256,
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  finalHash: z.string().nullable(),
  versions: SimVersionInfo,
  homeRevisionId: Id.nullable(),
  awayRevisionId: Id.nullable(),
  startedAt: Timestamp.nullable(),
  completedAt: Timestamp.nullable(),
});
export type Match = z.infer<typeof Match>;
