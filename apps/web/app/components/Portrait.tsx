/**
 * Flat illustrated portrait for a persistent AI personality (design system: "consistent
 * illustrated avatars"). Fully deterministic from the agent's avatar data, so the same
 * journalist always looks the same and no image assets are needed.
 */
import type { EditorialAgent } from "@autosoccer/contracts";

type Avatar = EditorialAgent["avatar"];

const SKIN = ["#F3C9A6", "#DDA27C", "#B57650", "#7E4E31"];
const HAIR = ["#20203B", "#4A2E1F", "#8A5A2B", "#20203B"];
const SHIRT = ["#20203B", "#FFFFFF", "#FFCB45", "#FF654F"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function Portrait({
  avatar,
  size = 40,
  rounded = "rounded-lg",
  className = "",
}: {
  avatar: Avatar;
  size?: number;
  rounded?: string;
  className?: string;
}) {
  const h = hash(`${avatar.initials}${avatar.color}`);
  const skin = SKIN[h % SKIN.length]!;
  const hair = HAIR[(h >>> 3) % HAIR.length]!;
  const shirt = SHIRT[(h >>> 6) % SHIRT.length]!;
  // Hairstyle follows the avatar's shape so the three journalists read as distinct people.
  const style = avatar.shape === "circle" ? "long" : avatar.shape === "square" ? "short" : "cap";
  const glasses = style === "long";
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden
      className={`shrink-0 overflow-hidden ${rounded} ${className}`}
      data-testid="portrait"
    >
      <rect width="100" height="100" fill={avatar.color} />
      <path d="M58 0 H80 L36 100 H14 Z" fill="#FFFFFF" opacity="0.14" />
      <path d="M84 0 H96 L52 100 H40 Z" fill="var(--color-yellow)" opacity="0.55" />
      {style === "long" && <path d="M28 44 C26 22 38 14 50 14 C63 14 74 22 72 44 L74 76 H26 Z" fill={hair} />}
      <path d="M12 100 C14 80 30 71 50 71 C70 71 86 80 88 100 Z" fill={shirt} stroke="#20203B" strokeWidth="2" />
      <path d="M43 71 L50 82 L57 71" fill="none" stroke="#20203B" strokeWidth="2" strokeLinejoin="round" />
      <rect x="43" y="56" width="14" height="16" rx="3" fill={skin} />
      <circle cx="32.5" cy="46" r="4" fill={skin} />
      <circle cx="67.5" cy="46" r="4" fill={skin} />
      <ellipse cx="50" cy="44" rx="17" ry="20" fill={skin} />
      {style === "short" && (
        <path d="M33 43 C30 22 42 17 52 18 C65 18 71 28 67 43 C65 33 58 29 50 29 C42 29 36 33 33 43 Z" fill={hair} />
      )}
      {style === "long" && <path d="M33 40 C34 26 44 22 52 23 C60 24 66 30 67 40 C58 36 46 33 33 40 Z" fill={hair} />}
      {style === "cap" && (
        <>
          <path d="M36 52 C38 64 45 67 50 67 C55 67 62 64 64 52 C60 59 40 59 36 52 Z" fill={hair} />
          <path d="M32 37 C32 22 43 17 50 17 C59 17 68 22 68 37 Z" fill="var(--color-match-blue)" />
          <path d="M30 37 H77 C77 41 71 42 66 41.5 H30 Z" fill="#20203B" />
        </>
      )}
      <path d="M42 39 H46.5 M53.5 39 H58" stroke={hair} strokeWidth="2" strokeLinecap="round" />
      <circle cx="44" cy="45" r="2" fill="#20203B" />
      <circle cx="56" cy="45" r="2" fill="#20203B" />
      {glasses && (
        <g fill="none" stroke="#20203B" strokeWidth="1.6">
          <circle cx="44" cy="45" r="5" />
          <circle cx="56" cy="45" r="5" />
          <path d="M49 45 H51" />
        </g>
      )}
      <path d="M44.5 54 Q50 58.5 55.5 54" fill="none" stroke="#20203B" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
