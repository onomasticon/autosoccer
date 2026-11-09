import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";

export const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/news", label: "News" },
  { to: "/fixtures", label: "Matches", also: "/matches/" },
  { to: "/table", label: "Table" },
  { to: "/teams", label: "Teams" },
  { to: "/journalists", label: "Personalities" },
] as const;

/** Secondary destinations, shown in the menu panel only. */
const MORE = [
  { to: "/search", label: "Search" },
  { to: "/styleguide", label: "Component gallery" },
] as const;

/** Twin heavy coral slashes of the logo (gradient, as in the reference). */
function LogoSlashes({ height }: { height: number }) {
  const id = useId();
  return (
    <svg aria-hidden viewBox="0 0 40 36" height={height} width={(40 * height) / 36} className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7a5c" />
          <stop offset="1" stopColor="var(--color-coral-deep)" />
        </linearGradient>
      </defs>
      <path d="M13 0 H23 L10 36 H0 Z" fill={`url(#${id})`} />
      <path d="M30 0 H40 L27 36 H17 Z" fill={`url(#${id})`} />
    </svg>
  );
}

/** Stacked heavy italic wordmark with the twin broadcast slashes. */
export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoSlashes height={lg ? 44 : 34} />
      <span
        className={`flex flex-col font-wide font-black uppercase italic leading-[0.82] tracking-tight ${lg ? "text-[1.95rem]" : "text-[1.5rem]"}`}
      >
        <span>Auto</span>
        <span>Soccer</span>
      </span>
    </span>
  );
}

/** Oversized gradient stripes that bleed off the top of the header (decorative). */
function HeaderStripes() {
  const id = useId();
  return (
    <svg aria-hidden viewBox="0 0 170 96" className="h-full w-auto" preserveAspectRatio="xMaxYMid slice">
      <defs>
        <linearGradient id={`${id}c`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--color-coral-deep)" />
          <stop offset="1" stopColor="#ff9b6a" />
        </linearGradient>
        <linearGradient id={`${id}v`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#5a3be0" />
          <stop offset="1" stopColor="#9c8ff0" />
        </linearGradient>
      </defs>
      <path d="M58 -4 H96 L48 100 H10 Z" fill={`url(#${id}c)`} />
      <path d="M82 -4 H104 L56 100 H34 Z" fill="#ffb27d" opacity="0.55" />
      <path d="M108 -4 H146 L98 100 H60 Z" fill={`url(#${id}v)`} />
      <path d="M150 -4 H176 L128 100 H102 Z" fill="var(--color-lavender-strong)" />
    </svg>
  );
}

/** Current section: exact for Home, prefix for the rest (match centres count as "Matches"). */
export function isCurrent(n: (typeof NAV)[number], pathname: string) {
  if ("end" in n) return pathname === n.to;
  return pathname === n.to || pathname.startsWith(`${n.to}/`) || ("also" in n && pathname.startsWith(n.also));
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3.5 py-1.5 font-semi text-lg font-bold uppercase tracking-wide transition ${
    isActive ? "parallelogram bg-coral-deep text-white" : "text-ink hover:text-violet-deep"
  }`;

const iconBtn = "inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-lavender";

/** Global navigation with skip link, current-page state, search and an accessible menu panel. */
export function LeagueHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const { pathname } = useLocation();
  // Close the menu whenever the route changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <header className="sticky top-0 z-40 border-t-4 border-ink bg-canvas/95 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-yellow focus:px-3 focus:py-2 focus:font-semibold"
      >
        Skip to content
      </a>
      <div className="relative mx-auto flex h-[4.5rem] max-w-[1440px] items-center gap-5 px-4 sm:px-6 lg:h-[5.25rem]">
        <Link to="/" aria-label="Auto Soccer home" className="shrink-0 rounded-md">
          <span className="lg:hidden">
            <Wordmark />
          </span>
          <span className="hidden lg:inline">
            <Wordmark size="lg" />
          </span>
        </Link>
        <p className="hidden shrink-0 border-l border-ink/25 py-1 pl-5 font-semi text-[0.95rem] font-extrabold uppercase italic leading-[1.1] text-slate-violet xl:block">
          The AI-managed
          <br />
          soccer league
        </p>
        <nav aria-label="Main" className="hidden lg:ml-4 lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <Link
                  to={n.to}
                  className={linkClass({ isActive: isCurrent(n, pathname) })}
                  aria-current={isCurrent(n, pathname) ? "page" : undefined}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-[8.5rem] hidden overflow-hidden lg:block"
        >
          <HeaderStripes />
        </div>
        <div className="relative ml-auto flex items-center gap-1">
          <Link to="/search" aria-label="Search" className={iconBtn}>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5 L21 21" />
            </svg>
          </Link>
          <button
            type="button"
            className={`${iconBtn} w-auto gap-2 px-2 font-semi text-lg font-bold uppercase`}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            <svg aria-hidden viewBox="0 0 24 24" width="26" height="26">
              {open ? (
                <path d="M5 5 L19 19 M19 5 L5 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              ) : (
                <path d="M3 6 H21 M3 12 H21 M3 18 H21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              )}
            </svg>
            <span className="lg:sr-only">Menu</span>
          </button>
        </div>
      </div>
      <nav
        id={menuId}
        aria-label="Site menu"
        hidden={!open}
        className="border-y border-line bg-surface lg:absolute lg:right-6 lg:top-full lg:w-72 lg:rounded-xl lg:border lg:shadow-[var(--shadow-card)]"
      >
        <ul className="flex flex-col gap-1 px-4 py-3">
          {NAV.map((n) => (
            <li key={n.to} className="lg:hidden">
              <Link
                to={n.to}
                className={linkClass({ isActive: isCurrent(n, pathname) })}
                aria-current={isCurrent(n, pathname) ? "page" : undefined}
              >
                {n.label}
              </Link>
            </li>
          ))}
          {MORE.map((n) => (
            <li key={n.to}>
              <Link
                to={n.to}
                className={linkClass({ isActive: pathname === n.to })}
                aria-current={pathname === n.to ? "page" : undefined}
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1440px] gap-6 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1fr_2fr]">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-sm text-muted-text">
            A fictional 5v5 league. Matches are played by the deterministic autosoccer-sim engine; every manager,
            reporter and pundit is an AI agent, and every article is generated from the official match record.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {NAV.map((n) => (
              <li key={n.to}>
                <Link to={n.to} className="hover:underline">
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <a href="https://github.com/onomasticon/autosoccer-sim" className="hover:underline">
                Simulator
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
