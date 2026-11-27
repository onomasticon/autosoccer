/**
 * Fixture story read model ("fixture-story/1"): why a fixture matters beforehand and what changed
 * afterwards, assembled only from persisted official records.
 *
 * - `prematch` is built from what was known before kickoff: the table and title race after the
 *   previous round, earlier meetings, form and scorers through the previous round, league history
 *   and any tactics the managers have already committed for this fixture. It never contains this
 *   fixture's result or any later round, however late it is read.
 * - `postmatch` exists once the official result is persisted: the score and goals, the table
 *   movement from before to after the round, the title race, and each club's next fixture.
 * - Each line says what kind of information it is (official record, manager's interpretation) and
 *   cites the fact ids that support it. Manager rationale and lessons are AI-written opinion.
 */
import { z } from "zod";
import { Id, Slug, Timestamp } from "./common.ts";
import { ArticleKind, Team } from "./domain.ts";
import { DugoutDecision, DugoutReflection } from "./dugout.ts";
import { Fact } from "./editorial.ts";
import { TeamSize } from "./tactics.ts";

export const STORY_CONTRACT = "fixture-story/1";

/**
 * Where the fixture is, from official fixture, job and decision state (never a guess):
 * scheduled → awaiting_decisions (managers deciding) → prepared (both lineups committed or the
 * round released) → playing → completed. `delayed`: kickoff time has passed and the match hasn't
 * started; `failed`: the match failed and is waiting for an operator; `forfeited`: a club withdrew
 * (bankrupt), so the fixture is a walkover or void and is never played.
 */
export const StoryStage = z.enum([
  "scheduled",
  "awaiting_decisions",
  "prepared",
  "playing",
  "completed",
  "delayed",
  "failed",
  "forfeited",
]);
export type StoryStage = z.infer<typeof StoryStage>;

export const StoryLine = z.object({
  kind: z.enum([
    "fixture",
    "stakes",
    "table",
    "race",
    "form",
    "meeting",
    "history",
    "scorers",
    "tactics",
    "result",
    "goals",
    "next",
    "transfer",
    "takeover",
  ]),
  /** record: official facts. interpretation: the manager's own words (AI-written, not fact-checked). */
  source: z.enum(["record", "interpretation"]),
  text: z.string(),
  /** Fact ids (from `facts`) that support the line; empty only for interpretation lines. */
  factIds: z.array(z.string()),
});
export type StoryLine = z.infer<typeof StoryLine>;

export const StandingSnapshot = z.object({
  afterRound: z.number().int().nonnegative(),
  position: z.number().int().positive(),
  points: z.number().int().nonnegative(),
  played: z.number().int().nonnegative(),
});
export type StandingSnapshot = z.infer<typeof StandingSnapshot>;

export const StoryNextFixture = z.object({
  fixtureId: Id,
  round: z.number().int().positive(),
  venue: z.enum(["home", "away"]),
  opponent: Team,
  scheduledAt: Timestamp.nullable(),
});
export type StoryNextFixture = z.infer<typeof StoryNextFixture>;

export const StorySide = z.object({
  team: Team,
  manager: z.object({ slug: Slug, name: z.string() }).nullable(),
  /** The table before this round (null in round 1). */
  before: StandingSnapshot.nullable(),
  /** The table after this round (null until the result is in). */
  after: StandingSnapshot.nullable(),
  /** The manager's decision for this fixture (from the dugout record; `pending` until made). */
  decision: DugoutDecision.nullable(),
  /** The manager's post-match review (interpretation), once the match is played. */
  reflection: DugoutReflection.nullable(),
  /** The club's next fixture after this one (null at the end of the season). */
  next: StoryNextFixture.nullable(),
});
export type StorySide = z.infer<typeof StorySide>;

export const StoryArticle = z.object({ slug: Slug, kind: ArticleKind, headline: z.string() });
export type StoryArticle = z.infer<typeof StoryArticle>;

export const FixtureStory = z.object({
  contract: z.literal(STORY_CONTRACT),
  fixtureId: Id,
  season: z.object({ id: Id, slug: Slug, name: z.string(), playersPerTeam: TeamSize, rounds: z.number().int() }),
  round: z.number().int().positive(),
  scheduledAt: Timestamp.nullable(),
  /** Kickoff times are stored and served in UTC; clients choose how to display them. */
  timezone: z.literal("UTC"),
  stage: StoryStage,
  home: StorySide,
  away: StorySide,
  /** The official match, once it exists (score once completed). */
  match: z
    .object({ id: Id, score: z.object({ home: z.number().int(), away: z.number().int() }).nullable() })
    .nullable(),
  prematch: z.object({ asOfRound: z.number().int().nonnegative(), lines: z.array(StoryLine), facts: z.array(Fact) }),
  postmatch: z
    .object({ afterRound: z.number().int().positive(), lines: z.array(StoryLine), facts: z.array(Fact) })
    .nullable(),
  articles: z.object({ preview: StoryArticle.nullable(), report: StoryArticle.nullable() }),
  /** Set when the fixture is forfeited: who withdrew, why, and who is awarded the walkover. */
  forfeit: z
    .object({
      kind: z.enum(["walkover", "void"]),
      awardedTo: Team.nullable(),
      withdrawn: z.array(z.object({ team: Team, round: z.number().int().positive(), reason: z.string() })).min(1),
    })
    .nullable()
    .optional(),
});
export type FixtureStory = z.infer<typeof FixtureStory>;
