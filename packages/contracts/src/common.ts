import { z } from "zod";

/** API contract version. Breaking changes bump the major and the `/api/vN` prefix. */
export const CONTRACTS_VERSION = "1.0.0";

export const Id = z.uuid().describe("UUID primary key");
export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase-kebab slug")
  .max(80);
export const Timestamp = z.iso.datetime({ offset: true }).describe("ISO-8601 timestamp");
export const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "#RRGGBB colour");
/** Money is stored as integer micro-USD (1 USD = 1_000_000) to avoid float drift. */
export const MicroUsd = z.number().int().describe("USD-equivalent amount in micro-dollars");
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "hex sha256");

export const Position = z.enum(["GK", "DF", "MF", "FW"]);
export type Position = z.infer<typeof Position>;

/** Which side of a fixture. The simulator's "blue" is always home, "red" always away. */
export const Side = z.enum(["home", "away"]);
export type Side = z.infer<typeof Side>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().nonnegative() });
