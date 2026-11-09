import type { ReactNode } from "react";
import { Link } from "react-router";

const FILL = {
  coral: "var(--color-coral)",
  violet: "var(--color-violet)",
  yellow: "var(--color-yellow)",
  blue: "var(--color-match-blue)",
  "violet-light": "#a796f5",
  "violet-pale": "#d4ccfa",
  "coral-light": "#ff9b7a",
  "coral-pale": "#ffcdb8",
} as const;
type Tone = keyof typeof FILL;
export type SlashTone = Tone;

/** Decorative broadcast slashes (the angular stripe motif). Never carries meaning. */
export function Slashes({
  colors = ["violet", "coral"],
  height = 28,
  className = "",
}: {
  colors?: Tone[];
  height?: number;
  className?: string;
}) {
  const w = 14 + colors.length * 11;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${w} 28`}
      height={height}
      width={(w * height) / 28}
      className={`shrink-0 ${className}`}
      data-decorative
    >
      {colors.map((c, i) => (
        <path key={i} d={`M${11 + i * 11} 0 H${18 + i * 11} L${7 + i * 11} 28 H${i * 11} Z`} fill={FILL[c]} />
      ))}
    </svg>
  );
}

export interface SectionHeaderProps {
  title: string;
  id?: string;
  eyebrow?: string;
  action?: { to: string; label: string };
  /** Plain text shown on the right instead of (or as well as) an action. */
  meta?: ReactNode;
  /** Tab colour. Coral uses the deep coral so white type stays readable. */
  tone?: "violet" | "coral";
  /** Page title treatment (h1): oversized italic headline with an underline bar. */
  banner?: boolean;
  as?: "h1" | "h2" | "h3";
  /** Tab sits flush against a card edge (straight left side). */
  flush?: boolean;
  className?: string;
}

/**
 * Broadcast section header: a skewed colour tab with slash accents (mockup "LATEST STORIES"),
 * or, with `banner`, the oversized page title.
 */
export function SectionHeader({
  title,
  id,
  eyebrow,
  action,
  meta,
  tone = "violet",
  banner = false,
  as: H = "h2",
  className = "",
  flush = false,
}: SectionHeaderProps) {
  const right = (action || meta) && (
    <div className="ml-auto flex shrink-0 items-center gap-3 text-sm">
      {meta && <span className="font-semibold text-muted-text">{meta}</span>}
      {action && (
        <Link
          to={action.to}
          className="inline-flex items-center gap-1 font-semibold text-ink underline-offset-4 hover:underline"
        >
          {action.label} <span aria-hidden>→</span>
        </Link>
      )}
    </div>
  );
  if (banner)
    return (
      <div className={`mb-6 flex flex-wrap items-end justify-between gap-4 ${className}`}>
        <div>
          {eyebrow && (
            <p className="parallelogram mb-2 inline-block bg-yellow py-1 font-semi text-sm font-extrabold uppercase italic tracking-wide text-ink">
              {eyebrow}
            </p>
          )}
          <div className="flex items-start gap-3">
            <H
              id={id}
              className="font-wide text-4xl font-black uppercase italic leading-[0.9] tracking-tight sm:text-[3.4rem]"
            >
              {title}
            </H>
            <Slashes colors={["violet", "violet-light", "coral"]} height={40} className="mt-1" />
          </div>
          <div aria-hidden className="mt-2 h-2 w-28 -skew-x-[20deg] rounded-sm bg-coral" />
        </div>
        {right}
      </div>
    );
  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${className}`}>
      <div className="flex min-w-0 items-center">
        <H
          id={id}
          className={`${flush ? "parallelogram-start pl-4 pr-[1.2em]" : "parallelogram pr-[1.2em]"} py-1.5 font-semi text-2xl font-extrabold uppercase italic leading-none tracking-tight text-white sm:text-[1.7rem] ${tone === "coral" ? "grad-coral" : "grad-violet"}`}
        >
          {eyebrow && <span className="sr-only">{eyebrow}: </span>}
          {title}
        </H>
        <Slashes
          colors={tone === "coral" ? ["coral-light", "coral-pale"] : ["violet-light", "violet-pale"]}
          height={38}
          className="-ml-[0.95rem]"
        />
      </div>
      {right}
    </div>
  );
}

/**
 * Card whose header tab sits flush on its top-left corner (mockup homepage panels).
 */
export function Panel({
  children,
  className = "",
  bodyClassName = "p-3 sm:p-4",
  ...header
}: SectionHeaderProps & { children: ReactNode; bodyClassName?: string }) {
  return (
    <section
      aria-labelledby={header.id}
      className={`flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)] ${className}`}
    >
      <SectionHeader {...header} flush className="mb-0 pr-4 [&>div:last-child]:pl-4" />
      <div className={`m-2 mt-2 rounded-xl border border-line bg-surface sm:m-3 sm:mt-2 ${bodyClassName}`}>
        {children}
      </div>
    </section>
  );
}
