/**
 * Player careers ("player-careers/1"): each player's ratings season by season and what the official
 * record shows they did. Two kinds of information, kept apart:
 *  - record: starts and goals, from each match's frozen lineup and the official events;
 *  - derived: ratings (a deterministic baseline, then a fixed development rule per season) and the
 *    recent-form window. Nothing else (assists, xG, ages, injuries) is tracked or implied.
 */
import { z } from "zod";
import { Id, Position, Slug } from "./common.ts";
import { ATTRIBUTE_NAMES, PlayerAttributes, Team } from "./domain.ts";

export const CAREERS_CONTRACT = "player-careers/1";

export const CareerSeason = z.object({
  season: z.object({ slug: Slug, name: z.string() }),
  /** snapshot: written for this season (develop/1 or baseline); baseline: from before snapshots. */
  source: z.enum(["snapshot", "baseline"]),
  rule: z.string().nullable(),
  overall: z.number().int(),
  attributes: PlayerAttributes,
  /** Changes from the previous season's ratings, with the rule's reasons. */
  changes: z.array(
    z.object({ attribute: z.enum(ATTRIBUTE_NAMES), delta: z.number().int(), reasons: z.array(z.string()) }),
  ),
  /** Official record for the season (so far). */
  teamMatches: z.number().int().nonnegative(),
  starts: z.number().int().nonnegative(),
  goals: z.number().int().nonnegative(),
});
export type CareerSeason = z.infer<typeof CareerSeason>;

export const PlayerCareer = z.object({
  playerId: Id,
  name: z.string(),
  shirtNumber: z.number().int(),
  position: Position,
  /** Oldest season first; only seasons the club played. */
  seasons: z.array(CareerSeason),
  /** The club's last five matches this season: did the player start, and goals scored. */
  form: z.array(
    z.object({ matchId: Id, round: z.number().int(), started: z.boolean(), goals: z.number().int().nonnegative() }),
  ),
});
export type PlayerCareer = z.infer<typeof PlayerCareer>;

export const PlayerCareersResponse = z.object({
  contract: z.literal(CAREERS_CONTRACT),
  team: Team,
  players: z.array(PlayerCareer),
});
export type PlayerCareersResponse = z.infer<typeof PlayerCareersResponse>;
