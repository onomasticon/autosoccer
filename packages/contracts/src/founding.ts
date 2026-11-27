/**
 * Club founding (#95): the charter a founder model submits, and how the platform publishes it.
 * The charter is the founder's own declaration (culture, philosophy) and is kept separate from
 * anything observed later about how the club actually behaves.
 */
import { z } from "zod";
import { BrandSpec } from "./brand.ts";
import { Slug } from "./common.ts";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const FoundingCharter = z.object({
  name: text(3, 32).describe("the club's name"),
  shortName: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .describe("3 capital letters, unique in the league"),
  nickname: text(2, 32),
  city: text(2, 32).describe("the club's fictional home town"),
  stadium: text(3, 48),
  motto: text(2, 80),
  culture: text(10, 400).describe("the culture the founder declares for the club"),
  philosophy: text(10, 400).describe("how the club wants to play"),
  recruitment: text(10, 400).describe("how the club wants to find and develop players"),
  brand: BrandSpec,
});
export type FoundingCharter = z.infer<typeof FoundingCharter>;

export const FoundingSubmission = z.object({
  round: z.number().int().positive(),
  accepted: z.boolean(),
  reasons: z.array(z.string()),
  submittedAt: z.string(),
});

export const CharterResponse = z.object({
  team: z.object({ slug: Slug, name: z.string() }),
  league: z.object({ slug: Slug, name: z.string() }),
  /** Exactly as founded; never edited. Later identity changes are dated separately. */
  charter: FoundingCharter,
  founder: z.object({
    /** Registry slug of the model that founded and runs the club. */
    model: z.string(),
    provider: z.string(),
    /** offline: a deterministic stand-in made the submission, not a model. */
    live: z.boolean(),
  }),
  foundedAt: z.string(),
  submissions: z.array(FoundingSubmission),
  /** The club's crest and kits as rendered by the platform's shared renderer. */
  assets: z.object({ crestSvg: z.string(), homeKitSvg: z.string(), awayKitSvg: z.string() }),
});
export type CharterResponse = z.infer<typeof CharterResponse>;
