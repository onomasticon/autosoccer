import { z } from "zod";

/**
 * Tactical config schema v1 ("tactics/1"). Deliberately discrete: every field is a small
 * enum so a manager (human or LLM) can only express choices the controller mapping
 * understands, and every valid config maps to exactly one simulator controller.
 */
export const TACTICS_SCHEMA_VERSION = "tactics/1";

export const Formation = z
  .enum(["2-1-1", "1-2-1", "2-2", "1-1-2", "3-1"])
  .describe("outfield shape, back to front (four outfield players)");

export const TacticalConfigV1 = z
  .object({
    formation: Formation,
    lineHeight: z.enum(["deep", "mid", "high"]).describe("how far up the pitch the block holds"),
    width: z.enum(["narrow", "balanced", "wide"]),
    pressing: z.enum(["low", "mid", "high"]).describe("where a second player joins the press"),
    tempo: z.enum(["patient", "balanced", "direct"]).describe("pass selection: retain vs. go forward"),
    passingRisk: z.enum(["safe", "balanced", "risky"]).describe("how open a lane must be to pass"),
    shooting: z.enum(["selective", "balanced", "early"]).describe("shooting range"),
    dribbling: z.enum(["rarely", "sometimes", "often"]).describe("carry the ball when unpressured"),
    keeperDistribution: z.enum(["short", "long"]),
  })
  .strict();
export type TacticalConfigV1 = z.infer<typeof TacticalConfigV1>;

export const DEFAULT_TACTICS: TacticalConfigV1 = {
  formation: "2-1-1",
  lineHeight: "mid",
  width: "balanced",
  pressing: "mid",
  tempo: "balanced",
  passingRisk: "balanced",
  shooting: "balanced",
  dribbling: "sometimes",
  keeperDistribution: "short",
};

/** Plain-language summary used in UIs and prompts. */
export function describeTactics(t: TacticalConfigV1): string {
  return `${t.formation} formation, ${t.lineHeight} line, ${t.width} width, ${t.pressing} press, ${t.tempo} tempo, ${t.passingRisk} passing, ${t.shooting} shooting, dribbles ${t.dribbling}, keeper plays ${t.keeperDistribution}`;
}
