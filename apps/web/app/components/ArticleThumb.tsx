import { useId } from "react";

/**
 * Flat geometric editorial illustration in the site palette, chosen deterministically from
 * a seed string. Tactics board / chart / supporters motifs — never fake match footage.
 */
/** Tinted backdrops (light → deeper), as in the reference thumbnails: lilac, peach, butter. */
const BACKDROPS = [
  ["#ece8fb", "#cfc6fa"],
  ["#ffe7dc", "#ffc4ad"],
  ["#fff3cc", "#ffdc80"],
] as const;

const P = ["var(--color-coral)", "var(--color-violet)", "var(--color-yellow)", "var(--color-match-blue)"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function ArticleThumb({ seed, kind, className = "" }: { seed: string; kind: string; className?: string }) {
  const h = hash(seed);
  const a = P[h % 4]!;
  const b = P[(h >>> 3) % 4 === h % 4 ? ((h % 4) + 1) % 4 : (h >>> 3) % 4]!;
  const motif = kind === "analysis" ? "chart" : kind === "column" ? "crowd" : "board";
  const gid = useId();
  const [light, deep] = BACKDROPS[(h >>> 7) % BACKDROPS.length]!;
  return (
    <svg
      viewBox="0 0 320 180"
      className={`block h-auto w-full ${className}`}
      aria-hidden
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#${gid})`} />
      <path d="M0 180 L120 0 H190 L70 180 Z" fill={a} opacity="0.9" />
      <path d="M210 180 L320 30 V180 Z" fill={b} opacity="0.85" />
      {motif === "board" && (
        <g fill="none" stroke="var(--color-ink)" strokeWidth="3">
          <rect x="150" y="40" width="130" height="90" rx="6" fill="var(--color-surface)" />
          <line x1="215" y1="40" x2="215" y2="130" />
          <circle cx="215" cy="85" r="14" />
          <circle cx="180" cy="70" r="5" fill="var(--color-coral)" stroke="none" />
          <circle cx="245" cy="100" r="5" fill="var(--color-violet)" stroke="none" />
          <path d="M180 70 Q 210 50 245 100" strokeDasharray="6 5" />
        </g>
      )}
      {motif === "chart" && (
        <g>
          <rect
            x="150"
            y="40"
            width="130"
            height="100"
            rx="6"
            fill="var(--color-surface)"
            stroke="var(--color-ink)"
            strokeWidth="3"
          />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={166 + i * 28}
              y={120 - ((h >>> (i * 4)) % 5) * 14 - 14}
              width="16"
              height={((h >>> (i * 4)) % 5) * 14 + 14}
              fill={i % 2 ? "var(--color-violet)" : "var(--color-coral)"}
            />
          ))}
        </g>
      )}
      {motif === "crowd" && (
        <g>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i} transform={`translate(${150 + i * 28} ${70 + (i % 2) * 14})`}>
              <circle cx="12" cy="12" r="11" fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth="3" />
              <rect
                x="0"
                y="26"
                width="24"
                height="40"
                rx="10"
                fill={P[(h + i) % 4]}
                stroke="var(--color-ink)"
                strokeWidth="3"
              />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
