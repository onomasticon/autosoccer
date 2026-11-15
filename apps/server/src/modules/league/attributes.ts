/**
 * Player ratings. Every player's ten attributes are fixed and derived deterministically from who
 * they are (name, shirt number) and where they play: a position profile, a shared "quality" offset
 * of up to ±7, and up to ±10 per attribute. The same player has the same ratings in every
 * environment, with nothing to migrate. Ratings run 25–95 here; the scale is 1–99.
 */
import { createHash } from "node:crypto";
import { ATTRIBUTE_NAMES, type AttributeName, type PlayerAttributes, type Position } from "@autosoccer/contracts";

/** The typical player in each position (before quality and individual variation). */
const PROFILES: Record<Position, PlayerAttributes> = {
  GK: {
    pace: 48,
    acceleration: 52,
    agility: 62,
    stamina: 56,
    control: 50,
    passing: 56,
    shooting: 30,
    power: 58,
    tackling: 34,
    goalkeeping: 72,
  },
  DF: {
    pace: 60,
    acceleration: 58,
    agility: 56,
    stamina: 66,
    control: 56,
    passing: 58,
    shooting: 42,
    power: 62,
    tackling: 72,
    goalkeeping: 20,
  },
  MF: {
    pace: 62,
    acceleration: 62,
    agility: 66,
    stamina: 72,
    control: 68,
    passing: 72,
    shooting: 58,
    power: 60,
    tackling: 58,
    goalkeeping: 20,
  },
  FW: {
    pace: 72,
    acceleration: 70,
    agility: 68,
    stamina: 62,
    control: 68,
    passing: 58,
    shooting: 72,
    power: 70,
    tackling: 38,
    goalkeeping: 20,
  },
};

/** What the overall rating weighs, by position. */
const WEIGHTS: Record<Position, Partial<Record<AttributeName, number>>> = {
  GK: { goalkeeping: 5, agility: 1, passing: 1, control: 1 },
  DF: { tackling: 3, pace: 1.5, stamina: 1, passing: 1, control: 1, acceleration: 1, power: 0.5 },
  MF: { passing: 3, control: 2, stamina: 1.5, agility: 1, tackling: 1, shooting: 1, pace: 1 },
  FW: { shooting: 3, pace: 2, control: 2, acceleration: 1.5, power: 1, agility: 1, passing: 0.5 },
};

/**
 * Hash salt. Chosen (by searching salts) so the four founding clubs come out evenly matched: their
 * first elevens average 65.5–65.9 overall and their squads 66.1–66.6. Changing it re-rates everyone.
 */
const SALT = "autosoccer-player-1186";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function playerAttributes(p: { name: string; shirtNumber: number; position: Position }): PlayerAttributes {
  const h = createHash("sha256").update(`${SALT}:${p.name}#${p.shirtNumber}`).digest();
  const quality = (h[0]! / 255 - 0.5) * 14;
  const base = PROFILES[p.position];
  return Object.fromEntries(
    ATTRIBUTE_NAMES.map((n, i) => {
      // Outfield players never get keeping ability from the shared quality offset.
      const shared = n === "goalkeeping" && p.position !== "GK" ? 0 : quality;
      const noise = (h[i + 1]! / 255 - 0.5) * 20;
      return [n, Math.round(clamp(base[n] + shared + noise, 25, 95))];
    }),
  ) as PlayerAttributes;
}

/** Position-weighted average of a player's attributes. */
export function overallRating(a: PlayerAttributes, position: Position): number {
  const w = WEIGHTS[position];
  let sum = 0;
  let total = 0;
  for (const [n, k] of Object.entries(w) as Array<[AttributeName, number]>) {
    sum += a[n] * k;
    total += k;
  }
  return Math.round(sum / total);
}
