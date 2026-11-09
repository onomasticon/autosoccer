import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { Slashes } from "./SectionHeader";

export const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/news", label: "News" },
  { to: "/fixtures", label: "Matches", also: "/matches/" },
  { to: "/table", label: "Table" },
  { to: "/teams", label: "Teams" },
  { to: "/journalists", label: "Personalities" },
] as const;

/** Stacked italic wordmark with the twin broadcast slashes. */
export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span className="inline-flex items-center gap-2">
      <Slashes colors={["coral", "coral"]} height={lg ? 46 : 36} />
      <span
        className={`flex flex-col font-display font-extrabold uppercase italic leading-[0.8] tracking-tight ${lg ? "text-[2.1rem]" : "text-[1.6rem]"}`}
      >
        <span>Auto</span>
        <span>Soccer</span>
      </span>
    </span>
  );
}

/** Current section: exact for Home, prefix for the rest (match centres count as "Matches"). */
export function isCurrent(n: (typeof NAV)[number], pathname: string) {
  if ("end" in n) return pathname === n.to;
  return pathname === n.to || pathname.startsWith(`${n.to}/`) || ("also" in n && pathname.startsWith(n.also));
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-1.5 font-display text-lg font-extrabold uppercase italic tracking-wide transition ${
    isActive ? "parallelogram bg-coral-deep text-white" : "text-ink hover:text-violet"
  }`;

/** Global navigation with skip link, current-page state and an accessible mobile disclosure menu. */
export function LeagueHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const { pathname } = useLocation();
  // Close the mobile menu whenever the route changes.
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
    <header className="sticky top-0 z-40 bg-canvas/95 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-yellow focus:px-3 focus:py-2 focus:font-semibold"
      >
        Skip to content
      </a>
      <div className="relative mx-auto flex h-[4.5rem] max-w-[1440px] items-center gap-5 overflow-hidden px-4 sm:px-6 lg:h-[5.5rem]">
        <Link to="/" aria-label="Auto Soccer home" className="shrink-0 rounded-md">
          <span className="lg:hidden">
            <Wordmark />
          </span>
          <span className="hidden lg:inline">
            <Wordmark size="lg" />
          </span>
        </Link>
        <p className="hidden shrink-0 border-l-2 border-line pl-4 font-display text-base font-bold uppercase italic leading-[1.05] text-violet-deep xl:block">
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
        <div aria-hidden className="pointer-events-none ml-auto hidden h-full items-center 2xl:flex">
          <Slashes colors={["coral", "violet", "violet"]} height={88} className="opacity-90" />
        </div>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-2 rounded-md px-2 py-2 font-display text-lg font-extrabold uppercase italic lg:hidden"
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
          Menu
        </button>
      </div>
      <nav id={menuId} aria-label="Main mobile" hidden={!open} className="border-y border-line bg-surface lg:hidden">
        <ul className="flex flex-col gap-1 px-4 py-3">
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
