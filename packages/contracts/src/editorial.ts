import { z } from "zod";
import { Id, Side } from "./common.ts";
import { OfficialEvent, TeamMatchStats } from "./match.ts";

/** A fact has a stable id so articles can cite it, and a source pointing to the official record. */
export const Fact = z.object({
  id: z.string(),
  kind: z.enum(["score", "goal", "stat", "standing", "lineup", "tactics", "form", "fixture"]),
  statement: z.string().describe("canonical plain-language statement of the fact"),
  value: z.unknown(),
  source: z.object({ table: z.string(), id: z.string() }),
});
export type Fact = z.infer<typeof Fact>;

/**
 * EditorialFacts: the only material an editorial agent may write from. Built from
 * persisted official events, standings, rosters, tactical revisions and verified results —
 * never invented quotes or results.
 */
export const EditorialFacts = z.object({
  contract: z.literal("editorial-facts/1"),
  seasonId: Id,
  matchId: Id.nullable(),
  generatedFrom: z.object({ resultFinalHash: z.string().nullable(), standingsAfterRound: z.number().int().nullable() }),
  match: z
    .object({
      round: z.number().int(),
      home: z.object({ teamId: Id, name: z.string(), score: z.number().int() }),
      away: z.object({ teamId: Id, name: z.string(), score: z.number().int() }),
      events: z.array(OfficialEvent),
      stats: z.object({ home: TeamMatchStats, away: TeamMatchStats }),
      lineups: z.record(Side, z.array(z.object({ playerId: Id, name: z.string(), position: z.string() }))),
    })
    .nullable(),
  facts: z.array(Fact),
});
export type EditorialFacts = z.infer<typeof EditorialFacts>;
