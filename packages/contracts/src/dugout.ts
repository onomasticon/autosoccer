/**
 * "Inside the Dugout" read model: each AI manager's decision → match → reflection chain,
 * assembled from persisted tactical revisions, agent runs and official results.
 *
 * Every field says which kind of information it is:
 *  - decision:    what the manager actually deployed (official: the tactical revision used)
 *  - observation: what happened (official: result and statistics from the match record)
 *  - speculation: what the manager *thinks* (AI-written rationale and lessons, not verified)
 * Prompts and other private run payloads are never part of this model.
 */
import { z } from "zod";
import { Id, Slug, Timestamp } from "./common.ts";
import { Team } from "./domain.ts";
import { TacticalConfigV1 } from "./tactics.ts";

export const DUGOUT_CONTRACT = "dugout/1";

export const TacticChange = z.object({
  field: z.enum([...(Object.keys(TacticalConfigV1.shape) as [keyof TacticalConfigV1, ...(keyof TacticalConfigV1)[]])]),
  label: z.string(),
  from: z.string(),
  to: z.string(),
});
export type TacticChange = z.infer<typeof TacticChange>;

export const DugoutPlayer = z.object({ id: Id, name: z.string(), shirtNumber: z.number().int(), position: z.string() });

/** What the club played with, and how it got there. Official (decision). */
export const DugoutDecision = z.object({
  /**
   * new: the manager deployed a new revision for this match.
   * opening: the club's pre-season plan (no manager decision yet).
   * kept: the manager decided not to change anything (re-deployed the same setup).
   * skipped_budget: no decision — compute budget exhausted, last valid tactics kept.
   * rejected: the manager's proposal failed validation; last valid tactics kept.
   * failed: the decision run errored; last valid tactics kept.
   * pending: the decision for an upcoming match hasn't been made yet.
   */
  status: z.enum(["new", "opening", "kept", "skipped_budget", "rejected", "failed", "pending"]),
  revisionVersion: z.number().int().positive().nullable(),
  tactics: TacticalConfigV1.nullable(),
  summary: z.string().describe("plain-language summary of the deployed setup"),
  /** Differences from the setup used in the club's previous match (empty for the first). */
  changes: z.array(TacticChange),
  lineupIn: z.array(DugoutPlayer),
  lineupOut: z.array(DugoutPlayer),
  /** The manager's own stated reasoning (speculation: AI-written, not fact-checked). */
  rationale: z.string().nullable(),
  decidedAt: Timestamp.nullable(),
});
export type DugoutDecision = z.infer<typeof DugoutDecision>;

/** Official result and the numbers that matter for the story (observation). */
export const DugoutResult = z.object({
  matchId: Id,
  goalsFor: z.number().int().nonnegative(),
  goalsAgainst: z.number().int().nonnegative(),
  outcome: z.enum(["W", "D", "L"]),
  possession: z.number().min(0).max(1).nullable(),
  shots: z.number().int().nonnegative().nullable(),
  shotsAgainst: z.number().int().nonnegative().nullable(),
});
export type DugoutResult = z.infer<typeof DugoutResult>;

/** The manager's post-match review (speculation: AI-written, not fact-checked). */
export const DugoutReflection = z.object({
  status: z.enum(["reviewed", "skipped_budget", "failed", "pending"]),
  lesson: z.string().nullable(),
  summary: z.string().nullable(),
  reviewedAt: Timestamp.nullable(),
});
export type DugoutReflection = z.infer<typeof DugoutReflection>;

export const DugoutChapter = z.object({
  fixtureId: Id,
  round: z.number().int().positive(),
  venue: z.enum(["home", "away"]),
  opponent: Team,
  scheduledAt: Timestamp.nullable(),
  status: z.enum(["completed", "upcoming"]),
  decision: DugoutDecision,
  result: DugoutResult.nullable(),
  reflection: DugoutReflection.nullable(),
});
export type DugoutChapter = z.infer<typeof DugoutChapter>;

export const ManagerStory = z.object({
  team: Team,
  manager: z.object({ slug: Slug, name: z.string(), philosophy: z.string() }).nullable(),
  /** Played chapters in order, then the next upcoming one (if any). */
  chapters: z.array(DugoutChapter),
  seasonComplete: z.boolean(),
});
export type ManagerStory = z.infer<typeof ManagerStory>;

/** Two managers' readings of the same official result. */
export const SharedResult = z.object({
  matchId: Id,
  fixtureId: Id,
  round: z.number().int().positive(),
  home: z.object({ team: Team, score: z.number().int() }),
  away: z.object({ team: Team, score: z.number().int() }),
  sides: z.object({ home: DugoutChapter, away: DugoutChapter }),
});
export type SharedResult = z.infer<typeof SharedResult>;

export const DugoutResponse = z.object({
  contract: z.literal(DUGOUT_CONTRACT),
  seasonId: Id,
  /** The latest completed match where both managers have reviewed it (or the latest at all). */
  featured: SharedResult.nullable(),
  stories: z.array(ManagerStory),
});
export type DugoutResponse = z.infer<typeof DugoutResponse>;

export const TeamDugoutResponse = z.object({ contract: z.literal(DUGOUT_CONTRACT), seasonId: Id, story: ManagerStory });
export type TeamDugoutResponse = z.infer<typeof TeamDugoutResponse>;

// ——— Manager profile (manager-profile/1) ————————————————————————————————————————————

export const MANAGER_PROFILE_CONTRACT = "manager-profile/1";

/** One match a manager prepared for, as evidence: where it is on record. */
export const ChapterRef = z.object({
  season: z.object({ slug: Slug, name: z.string() }),
  round: z.number().int().positive(),
  fixtureId: Id,
  matchId: Id.nullable(),
  opponent: Team,
  venue: z.enum(["home", "away"]),
  score: z.object({ for: z.number().int(), against: z.number().int() }).nullable(),
  outcome: z.enum(["W", "D", "L"]).nullable(),
  /** The tactical revision that actually played. */
  revisionVersion: z.number().int().positive().nullable(),
});
export type ChapterRef = z.infer<typeof ChapterRef>;

/**
 * A behavioural pattern derived by a fixed rule from the manager's recorded decisions (observed
 * behaviour, not their stated intent). Only given once the sample is big enough, and always with
 * the decisions that support it.
 */
export const ManagerTrait = z.object({
  key: z.enum(["tinkerer", "settled", "reacts_to_defeat", "holds_after_defeat", "front_foot", "cautious", "rotates"]),
  label: z.string(),
  /** The rule and the numbers, in words ("changed the setup in 5 of 6 decisions"). */
  basis: z.string(),
  evidence: z.array(ChapterRef).min(2),
});
export type ManagerTrait = z.infer<typeof ManagerTrait>;

/** A decision worth knowing about: what changed, what happened before and after. */
export const NotableDecision = z.object({
  at: ChapterRef,
  /** The match before it (what the manager was reacting to), if any. */
  before: ChapterRef.nullable(),
  changes: z.array(TacticChange),
  summary: z.string().describe("official: what the deployed revision changed, in words"),
  /** The manager's own stated reason (AI-written, unverified). */
  rationale: z.string().nullable(),
});
export type NotableDecision = z.infer<typeof NotableDecision>;

export const ManagerProfile = z.object({
  contract: z.literal(MANAGER_PROFILE_CONTRACT),
  team: Team,
  manager: z.object({ slug: Slug, name: z.string(), philosophy: z.string() }).nullable(),
  /** The seasons the evidence comes from, oldest first. */
  seasons: z.array(z.object({ slug: Slug, name: z.string() })),
  /** profiled: enough decisions to describe patterns; too_early: not yet. */
  verdict: z.enum(["profiled", "too_early"]),
  counts: z.object({
    /** Matches played in scope. */
    matches: z.number().int().nonnegative(),
    /** Decisions the manager actually made: a new or a deliberately kept setup. */
    decisions: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    formationChanges: z.number().int().nonnegative(),
    /** Not autonomous decisions: the pre-season plan, budget skips, failed or rejected runs. */
    opening: z.number().int().nonnegative(),
    skippedBudget: z.number().int().nonnegative(),
    failedOrRejected: z.number().int().nonnegative(),
    record: z.object({ W: z.number().int(), D: z.number().int(), L: z.number().int() }),
    /** Decisions right after a defeat, and how many of them changed the setup. */
    afterDefeat: z.object({ decisions: z.number().int(), changed: z.number().int() }),
    afterWinOrDraw: z.object({ decisions: z.number().int(), changed: z.number().int() }),
    /** Mean starters brought in per decision. */
    lineupTurnover: z.number().nonnegative(),
  }),
  traits: z.array(ManagerTrait),
  notable: z.array(NotableDecision).max(3),
  /** Where things stand now. */
  current: z.object({
    summary: z.string().describe("the setup that played most recently (or the opening plan)"),
    /** The latest post-match lesson (AI-written, not fact-checked). */
    lesson: z.string().nullable(),
    lessonAt: ChapterRef.nullable(),
    next: z
      .object({ fixtureId: Id, round: z.number().int(), opponent: Team, status: DugoutDecision.shape.status })
      .nullable(),
  }),
});
export type ManagerProfile = z.infer<typeof ManagerProfile>;
