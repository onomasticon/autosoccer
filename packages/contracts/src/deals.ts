/**
 * Consequences of club decisions (#80, increment 4): completed deals and rescue takeovers, as the
 * club page, player pages and Matchday show them. From the official record; managers' reasons are
 * their own recorded words (AI-written), attributed by name.
 */
import { z } from "zod";
import { Id, Slug } from "./common.ts";
import { Team } from "./domain.ts";

const SeasonRef = z.object({ slug: Slug, name: z.string() });

export const DealView = z.object({
  id: Id,
  /** The season the window fed (the player registered for it). */
  season: SeasonRef,
  player: z.object({ id: Id, name: z.string(), position: z.string() }),
  from: Team,
  to: Team,
  fee: z.number().int(),
  buyer: z.object({ manager: z.string().nullable(), reason: z.string() }),
  seller: z.object({ manager: z.string().nullable(), reason: z.string().nullable() }),
});
export type DealView = z.infer<typeof DealView>;

export const TakeoverView = z.object({
  withdrew: z.object({ season: SeasonRef, round: z.number().int(), reason: z.string() }),
  /** Cash plus money due, and the round's wages, when the club was declared bankrupt. */
  basis: z.object({ available: z.number().int().nullable(), wages: z.number().int().nullable() }),
  /** The new owners' capital. */
  capital: z.number().int(),
  from: z.string(),
  to: z.string(),
  returned: SeasonRef,
  memo: z.string(),
});
export type TakeoverView = z.infer<typeof TakeoverView>;
