import { z } from "zod";
import { Id } from "./common.ts";

/**
 * How a team is controlled in a match. Union kept stable so LLM-authored
 * scripted controllers can be added later without a contract break.
 *  - tactical: a validated structured tactical config (schema in tactics.ts, #22),
 *    mapped deterministically to a simulator controller.
 *  - scripted: a stored controller artifact written against a simulator SDK version.
 */
export const TacticalDeployment = z.object({
  kind: z.literal("tactical"),
  /** Tactical config schema version, e.g. "tactics/1". */
  schemaVersion: z.string().regex(/^tactics\/\d+$/),
  config: z.record(z.string(), z.unknown()),
});
export const ScriptedDeployment = z.object({
  kind: z.literal("scripted"),
  sdkVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  artifactId: Id,
});
export const ControllerDeployment = z.discriminatedUnion("kind", [TacticalDeployment, ScriptedDeployment]);
export type ControllerDeployment = z.infer<typeof ControllerDeployment>;

/** Five (5-a-side) or seven (7-a-side) starters, slot 1 is the goalkeeper; remaining squad members are reserves. */
export const Lineup = z
  .object({
    starters: z.array(Id).min(5).max(7),
    reserves: z.array(Id).max(6),
  })
  .refine((l) => new Set([...l.starters, ...l.reserves]).size === l.starters.length + l.reserves.length, {
    message: "a player can appear only once in a lineup",
  });
export type Lineup = z.infer<typeof Lineup>;
