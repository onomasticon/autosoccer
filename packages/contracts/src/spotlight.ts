/**
 * Player spotlight ("spotlight/1") and player profiles ("player-profile/1").
 *
 * The spotlight is the homepage's lead: one named player from the latest completed round, what
 * they did, one verified detail that gives it significance, and the clip to watch. It is chosen
 * by a fixed, documented rule (docs/spotlight.md) from official events only; every sentence is
 * built from the record, never from AI-written text.
 */
import { z } from "zod";
import { PlayerCareer } from "./careers.ts";
import { Id, Position, Slug, Timestamp } from "./common.ts";
import { DealView } from "./deals.ts";
import { Team } from "./domain.ts";
import { Period } from "./match.ts";

export const SPOTLIGHT_CONTRACT = "spotlight/1";
export const PLAYER_PROFILE_CONTRACT = "player-profile/1";

/** One official goal, enough to find it in the replay and name it. */
export const SpotlightGoal = z.object({
  tick: z.number().int().nonnegative(),
  period: Period,
  clockSec: z.number().nonnegative(),
  score: z.object({ home: z.number().int(), away: z.number().int() }),
});
export type SpotlightGoal = z.infer<typeof SpotlightGoal>;

export const SpotlightPlayer = z.object({
  id: Id,
  name: z.string(),
  shirtNumber: z.number().int(),
  position: Position,
});
export type SpotlightPlayer = z.infer<typeof SpotlightPlayer>;

export const SpotlightNext = z.object({
  fixtureId: Id,
  round: z.number().int().positive(),
  venue: z.enum(["home", "away"]),
  opponent: Team,
  scheduledAt: Timestamp.nullable(),
});
export type SpotlightNext = z.infer<typeof SpotlightNext>;

/**
 * A standout performance, or `quiet` when the round had no goals (the lead is then the season's
 * leading scorer, and the action is their next match).
 */
export const SpotlightKind = z.enum(["hat_trick", "brace", "winner", "equaliser", "goal", "quiet"]);
export type SpotlightKind = z.infer<typeof SpotlightKind>;

export const Spotlight = z.object({
  kind: SpotlightKind,
  player: SpotlightPlayer,
  team: Team,
  opponent: Team.nullable(),
  season: z.object({ slug: Slug, name: z.string() }),
  round: z.number().int().positive(),
  /** The match the moment happened in (null for a quiet round's lead). */
  matchId: Id.nullable(),
  fixtureId: Id.nullable(),
  /** "Tove Nyberg scored three as Northgate beat Saltmarsh Athletic 4–1." */
  headline: z.string(),
  /** One verified detail that gives it significance. */
  detail: z.string(),
  /** The player's goals in that match, in order (empty for a quiet round). */
  goals: z.array(SpotlightGoal),
  /** Whether the match has a stored replay (the clip is playable). */
  replay: z.boolean(),
  /** "Watch Nyberg's three goals" (or the fallback action's label). */
  action: z.string(),
  /** The club's next fixture in the current season, if one is scheduled. */
  next: SpotlightNext.nullable(),
});
export type Spotlight = z.infer<typeof Spotlight>;

/** A club's latest meaningful moment: the same rule, applied to the club's latest match. */
export const ClubMoment = z.object({
  teamId: Id,
  /** Null when the club hasn't played, or scored, in its latest match. */
  moment: Spotlight.nullable(),
});
export type ClubMoment = z.infer<typeof ClubMoment>;

export const SpotlightResponse = z.object({
  contract: z.literal(SPOTLIGHT_CONTRACT),
  /** The rule that chose it (docs/spotlight.md). */
  rule: z.string(),
  lead: Spotlight.nullable(),
  clubs: z.array(ClubMoment),
});
export type SpotlightResponse = z.infer<typeof SpotlightResponse>;

/** A player's own page: career, distinction, recent moment and the club's next fixture. */
export const PlayerProfileResponse = z.object({
  contract: z.literal(PLAYER_PROFILE_CONTRACT),
  team: Team,
  career: PlayerCareer,
  /** All seasons: goals (own goals excluded) and starts, from the official record. */
  allTime: z.object({
    goals: z.number().int().nonnegative(),
    starts: z.number().int().nonnegative(),
    /** Rank among the league's all-time scorers (ties share a rank); null with no goals. */
    rank: z.number().int().positive().nullable(),
  }),
  /** Record-derived distinctions, most notable first ("The league's all-time top scorer: …"). */
  distinctions: z.array(z.string()),
  /** The player's latest goal(s) in a match, across seasons. */
  recent: Spotlight.nullable(),
  next: SpotlightNext.nullable(),
  /** The player's completed transfers, newest first: both clubs, the fee and each manager's reason. */
  transfers: z.array(DealView).optional(),
});
export type PlayerProfileResponse = z.infer<typeof PlayerProfileResponse>;

/** A searchable player: name, club and record. */
export const PlayerListItem = z.object({
  id: Id,
  name: z.string(),
  shirtNumber: z.number().int(),
  position: Position,
  team: Team,
  goals: z.number().int().nonnegative(),
  starts: z.number().int().nonnegative(),
});
export type PlayerListItem = z.infer<typeof PlayerListItem>;
export const PlayerListResponse = z.object({ items: z.array(PlayerListItem) });
export type PlayerListResponse = z.infer<typeof PlayerListResponse>;

/** "/players/<id>/jae-moon": the id is the address, the name part is only for people. */
export function playerHref(p: { id: string; name: string }): string {
  const name = p.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `/players/${p.id}${name ? `/${name}` : ""}`;
}
