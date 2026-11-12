import type { Formation, TacticalConfigV1, TeamSize } from "@autosoccer/contracts";

/** The four persistent AI managers: one per club, with a stable identity and opening tactics. */
export interface SeedManager {
  teamSlug: string;
  slug: string;
  name: string;
  persona: string;
  philosophy: string;
  openingTactics: TacticalConfigV1;
}

/** Each manager's 5-a-side opening shape, translated to the 7-a-side shape with the same intent. */
const SEVEN_A_SIDE_SHAPE: Partial<Record<Formation, Formation>> = {
  "2-1-1": "2-3-1",
  "1-2-1": "2-1-2-1",
  "2-2": "2-2-2",
  "1-1-2": "3-1-2",
  "3-1": "3-2-1",
};

/** A manager's opening setup for a season's team size. */
export function openingTactics(m: SeedManager, size: TeamSize): TacticalConfigV1 {
  if (size === 5) return m.openingTactics;
  return { ...m.openingTactics, formation: SEVEN_A_SIDE_SHAPE[m.openingTactics.formation] ?? "2-3-1" };
}

export const SEED_MANAGERS: SeedManager[] = [
  {
    teamSlug: "harbour-city",
    slug: "marta-sol",
    name: "Marta Sol",
    persona:
      "Calm, methodical and data-minded. Speaks in short, precise sentences and changes one thing at a time so she can measure the effect.",
    philosophy: "Control the ball and the tempo; patience creates the chance.",
    openingTactics: {
      formation: "2-1-1",
      lineHeight: "mid",
      width: "balanced",
      pressing: "mid",
      tempo: "patient",
      passingRisk: "safe",
      shooting: "balanced",
      dribbling: "sometimes",
      keeperDistribution: "short",
    },
  },
  {
    teamSlug: "red-rock-rovers",
    slug: "dex-okoro",
    name: "Dex Okoro",
    persona: "Restless and fiery. Believes in pressure and momentum, and is quick to react after a bad result.",
    philosophy: "Win it back high and go straight for goal.",
    openingTactics: {
      formation: "1-1-2",
      lineHeight: "high",
      width: "wide",
      pressing: "high",
      tempo: "direct",
      passingRisk: "risky",
      shooting: "early",
      dribbling: "often",
      keeperDistribution: "long",
    },
  },
  {
    teamSlug: "northgate-comets",
    slug: "ines-varga",
    name: "Ines Varga",
    persona: "Pragmatic counter-puncher. Studies opponents closely and is happy to concede the ball to exploit space.",
    philosophy: "Stay compact, then break fast into the space behind.",
    openingTactics: {
      formation: "2-2",
      lineHeight: "deep",
      width: "narrow",
      pressing: "low",
      tempo: "direct",
      passingRisk: "balanced",
      shooting: "early",
      dribbling: "sometimes",
      keeperDistribution: "long",
    },
  },
  {
    teamSlug: "saltmarsh-athletic",
    slug: "theo-lambert",
    name: "Theo Lambert",
    persona: "Cautious veteran. Values structure and clean sheets, and dislikes unnecessary risk.",
    philosophy: "Defend first; a point is never a bad result.",
    openingTactics: {
      formation: "3-1",
      lineHeight: "mid",
      width: "balanced",
      pressing: "mid",
      tempo: "balanced",
      passingRisk: "safe",
      shooting: "selective",
      dribbling: "rarely",
      keeperDistribution: "short",
    },
  },
];
