import type { Team } from "@autosoccer/contracts";
import { onColor } from "../lib/format";

const SIZES = { xs: 20, sm: 28, md: 40, lg: 72, xl: 112 } as const;

const SHAPES: Record<Team["crest"]["shape"], string> = {
  shield: "M50 4 L92 16 V48 C92 74 74 90 50 98 C26 90 8 74 8 48 V16 Z",
  circle: "M50 4 A46 46 0 1 1 49.99 4 Z",
  hexagon: "M50 4 L90 27 V73 L50 96 L10 73 V27 Z",
  diamond: "M50 3 L97 50 L50 97 L3 50 Z",
};

export interface TeamBadgeProps {
  team: Pick<Team, "name" | "colors" | "crest">;
  size?: keyof typeof SIZES;
  /** Decorative when the team name is printed next to it (hidden from assistive tech). */
  decorative?: boolean;
  className?: string;
}

/** Flat vector crest. Team colours override only the badge itself, never site tokens. */
export function TeamBadge({ team, size = "md", decorative = false, className = "" }: TeamBadgeProps) {
  const px = SIZES[size];
  const glyphColor = onColor(team.colors.primary);
  return (
    <svg
      viewBox="0 0 100 100"
      width={px}
      height={px}
      className={`shrink-0 ${className}`}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${team.name} crest`}
      data-testid="team-badge"
    >
      <path d={SHAPES[team.crest.shape]} fill={team.colors.primary} stroke={team.colors.secondary} strokeWidth="5" />
      <path d={SHAPES[team.crest.shape]} fill="none" stroke="rgb(32 32 59 / 0.18)" strokeWidth="1.5" />
      <text
        x="50"
        y="53"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Barlow Condensed, Arial Narrow, sans-serif"
        fontWeight="800"
        fontStyle="italic"
        fontSize={team.crest.glyph.length > 1 ? 38 : 50}
        fill={glyphColor}
      >
        {team.crest.glyph}
      </text>
    </svg>
  );
}
