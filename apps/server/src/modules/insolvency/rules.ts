/**
 * insolvency/1: when a club goes bankrupt, what happens to its season, and how it is rescued.
 * Fan-facing explanation: docs/platform/bankruptcy.md. Money is whole credits (Ȼ), as in finance/1.
 */
import { RULES } from "../finance/rules.ts";

export const INSOLVENCY_RULE = "insolvency/1";

export const INSOLVENCY = {
  version: INSOLVENCY_RULE,
  /**
   * The check: before a round is released, a club must be able to pay that round's wages from its
   * cash plus any money due as the round kicks off (the league distribution in round 1). A club
   * that can't is declared bankrupt, withdrawn from that round on.
   */
  check: "before each round is released",
  /** Points for the opponent of a withdrawn club; goals and goal difference are unchanged. */
  walkoverPoints: 3,
  takeover: {
    /** The new owners bring the club's cash back up to this (the opening balance). */
    capitalTo: RULES.opening,
    /** New names, tried in order after the club's city (a name the league has used is skipped). */
    names: ["Phoenix", "United", "Albion", "Athletic", "Town", "Rangers"],
  },
} as const;

/** "Harbour City" + "Phoenix" → "Harbour City Phoenix" (a city already ending in the suffix isn't doubled). */
export function rebrandName(city: string, suffix: string): string {
  return city.endsWith(` ${suffix}`) ? city : `${city} ${suffix}`;
}

/** Initials of a club name, 3 letters where possible: "Harbour City Phoenix" → "HCP", "Northgate Phoenix" → "NOP". */
export function shortNameFor(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  let s = words.map((w) => w[0]!.toUpperCase()).join("");
  if (s.length < 3 && words[0])
    s =
      words[0].slice(0, 2).toUpperCase() +
      words
        .slice(1)
        .map((w) => w[0]!.toUpperCase())
        .join("");
  return s.slice(0, 4).padEnd(2, "X");
}
