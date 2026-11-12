import { z } from "zod";

/**
 * Tactical config schema v1 ("tactics/1"). Deliberately discrete: every field is a small
 * enum so a manager (human or LLM) can only express choices the controller mapping
 * understands, and every valid config maps to exactly one simulator controller.
 */
export const TACTICS_SCHEMA_VERSION = "tactics/1";

/** Players per side. 5-a-side was the launch format; new seasons play 7-a-side. */
export const TeamSize = z.union([z.literal(5), z.literal(7)]);
export type TeamSize = z.infer<typeof TeamSize>;

/** Outfield shapes, back to front. 5-a-side shapes have four outfield players, 7-a-side six. */
export const FORMATIONS_5 = ["2-1-1", "1-2-1", "2-2", "1-1-2", "3-1"] as const;
export const FORMATIONS_7 = ["2-3-1", "3-2-1", "2-2-2", "3-1-2", "2-1-2-1"] as const;

export const Formation = z
  .enum([...FORMATIONS_5, ...FORMATIONS_7])
  .describe("outfield shape, back to front (four outfield players in 5-a-side, six in 7-a-side)");
export type Formation = z.infer<typeof Formation>;

export const formationsFor = (size: TeamSize): readonly Formation[] => (size === 7 ? FORMATIONS_7 : FORMATIONS_5);
/** Outfield players a formation fields: "2-1-2-1" → 6. */
export const outfieldPlayers = (f: Formation): number => f.split("-").reduce((n, x) => n + Number(x), 0);
/** Team size a formation belongs to. */
export const formationTeamSize = (f: Formation): TeamSize => (outfieldPlayers(f) === 6 ? 7 : 5);

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

/** Default setup for a team size (same choices, size-appropriate shape). */
export function defaultTactics(size: TeamSize): TacticalConfigV1 {
  return size === 7 ? { ...DEFAULT_TACTICS, formation: "2-3-1" } : DEFAULT_TACTICS;
}

/** tactics/1 restricted to one team size's formations (for manager prompts and structured output). */
export function tacticsSchemaFor(size: TeamSize) {
  return TacticalConfigV1.extend({
    formation: z
      .enum(formationsFor(size) as [Formation, ...Formation[]])
      .describe(`outfield shape, back to front (${size - 1} outfield players)`),
  }).strict();
}

/** Plain-language summary used in UIs and prompts. */
export function describeTactics(t: TacticalConfigV1): string {
  return `${t.formation} formation, ${t.lineHeight} line, ${t.width} width, ${t.pressing} press, ${t.tempo} tempo, ${t.passingRisk} passing, ${t.shooting} shooting, dribbles ${t.dribbling}, keeper plays ${t.keeperDistribution}`;
}
