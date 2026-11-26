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

/** …and to the 11-a-side shape with the same intent. */
const ELEVEN_A_SIDE_SHAPE: Partial<Record<Formation, Formation>> = {
  "2-1-1": "4-3-3",
  "1-2-1": "4-2-3-1",
  "2-2": "4-4-2",
  "1-1-2": "3-5-2",
  "3-1": "5-3-2",
};

/** A manager's opening setup for a season's team size. */
export function openingTactics(m: SeedManager, size: TeamSize): TacticalConfigV1 {
  if (size === 5) return m.openingTactics;
  if (size === 11)
    return { ...m.openingTactics, formation: ELEVEN_A_SIDE_SHAPE[m.openingTactics.formation] ?? "4-4-2" };
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
  // The expansion clubs' managers (the league grew to ten clubs).
  {
    teamSlug: "ironbridge-united",
    slug: "hal-brenner",
    name: "Hal Brenner",
    persona: "Blunt and hard-working. Trusts a settled side and expects every player to run for the team.",
    philosophy: "Out-work them, win the second balls, keep it simple.",
    openingTactics: {
      formation: "2-2",
      lineHeight: "mid",
      width: "balanced",
      pressing: "high",
      tempo: "direct",
      passingRisk: "balanced",
      shooting: "balanced",
      dribbling: "rarely",
      keeperDistribution: "long",
    },
  },
  {
    teamSlug: "coldwater-town",
    slug: "anouk-meyer",
    name: "Anouk Meyer",
    persona: "Thoughtful tactician who loves width and rotation. Explains her choices like a teacher.",
    philosophy: "Stretch the pitch and move the ball until the gap opens.",
    openingTactics: {
      formation: "1-2-1",
      lineHeight: "mid",
      width: "wide",
      pressing: "mid",
      tempo: "patient",
      passingRisk: "balanced",
      shooting: "selective",
      dribbling: "sometimes",
      keeperDistribution: "short",
    },
  },
  {
    teamSlug: "eastmoor-wanderers",
    slug: "ruben-osei",
    name: "Ruben Osei",
    persona: "Showman with a gambler's streak. Loves skill and flair and will back an attacker to beat their man.",
    philosophy: "Entertain: take players on and shoot on sight.",
    openingTactics: {
      formation: "1-1-2",
      lineHeight: "mid",
      width: "wide",
      pressing: "mid",
      tempo: "direct",
      passingRisk: "risky",
      shooting: "early",
      dribbling: "often",
      keeperDistribution: "short",
    },
  },
  {
    teamSlug: "larkfield-rangers",
    slug: "greta-lindholm",
    name: "Greta Lindholm",
    persona: "Meticulous and patient. Plans each match around the opponent's weakest zone.",
    philosophy: "Find their weakness and play there, again and again.",
    openingTactics: {
      formation: "2-1-1",
      lineHeight: "mid",
      width: "narrow",
      pressing: "mid",
      tempo: "balanced",
      passingRisk: "safe",
      shooting: "selective",
      dribbling: "sometimes",
      keeperDistribution: "short",
    },
  },
  {
    teamSlug: "port-alder",
    slug: "joao-pereira",
    name: "João Pereira",
    persona: "Energetic former winger. Optimistic, quick to praise and quicker to change a failing plan.",
    philosophy: "Press together, attack together, recover together.",
    openingTactics: {
      formation: "1-2-1",
      lineHeight: "high",
      width: "balanced",
      pressing: "high",
      tempo: "balanced",
      passingRisk: "balanced",
      shooting: "balanced",
      dribbling: "sometimes",
      keeperDistribution: "short",
    },
  },
  {
    teamSlug: "westvale-albion",
    slug: "carys-whitfield",
    name: "Carys Whitfield",
    persona: "Stubborn defensive purist. Measures success in clean sheets and hates conceding on the break.",
    philosophy: "Nothing through the middle; strike from set pieces and mistakes.",
    openingTactics: {
      formation: "3-1",
      lineHeight: "deep",
      width: "narrow",
      pressing: "low",
      tempo: "patient",
      passingRisk: "safe",
      shooting: "selective",
      dribbling: "rarely",
      keeperDistribution: "long",
    },
  },
];
