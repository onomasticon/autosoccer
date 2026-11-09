import { Link } from "react-router";

export interface SectionHeaderProps {
  title: string;
  id?: string;
  eyebrow?: string;
  action?: { to: string; label: string };
  /** Angular slash banner, for top-level page sections only. */
  banner?: boolean;
  as?: "h1" | "h2" | "h3";
}

export function SectionHeader({ title, id, eyebrow, action, banner = false, as: H = "h2" }: SectionHeaderProps) {
  return (
    <div
      className={`mb-4 flex items-end justify-between gap-4 ${banner ? "relative overflow-hidden rounded-xl bg-violet px-5 py-4 text-white" : ""}`}
    >
      {banner && (
        <div aria-hidden className="banner-slash pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-90" />
      )}
      <div className="relative">
        {eyebrow && (
          <p
            className={`mb-1 text-xs font-bold uppercase tracking-[0.14em] ${banner ? "inline-block rounded bg-yellow px-1.5 py-0.5 text-ink" : "text-violet"}`}
          >
            {eyebrow}
          </p>
        )}
        <H
          id={id}
          className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight sm:text-4xl"
        >
          {title}
        </H>
      </div>
      {action && (
        <Link
          to={action.to}
          className={`relative shrink-0 text-sm font-semibold underline-offset-4 hover:underline ${banner ? "text-white" : "text-violet"}`}
        >
          {action.label} <span aria-hidden>→</span>
        </Link>
      )}
    </div>
  );
}
