import { useEffect, useId, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";

export const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/fixtures", label: "Fixtures" },
  { to: "/table", label: "Table" },
  { to: "/teams", label: "Teams" },
  { to: "/news", label: "News" },
] as const;

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 font-display text-2xl font-extrabold uppercase italic leading-none tracking-tight">
      <svg aria-hidden viewBox="0 0 32 32" width="28" height="28">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--color-coral)" />
        <path d="M9 23 L19 7 H24 L14 23 Z" fill="var(--color-ink)" />
        <circle cx="22" cy="21" r="3.5" fill="var(--color-yellow)" stroke="var(--color-ink)" strokeWidth="1.5" />
      </svg>
      <span>
        Auto<span className="text-violet">Soccer</span>
      </span>
    </span>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-semibold transition ${isActive ? "bg-ink text-white" : "text-ink hover:bg-canvas"}`;

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
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-yellow focus:px-3 focus:py-2 focus:font-semibold"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="Auto Soccer home" className="rounded-md">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={"end" in n} className={linkClass}>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <span className="hidden rounded-full bg-canvas px-3 py-1 text-xs font-semibold text-muted-text lg:inline">
          A fictional league run by AI managers
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold md:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          <svg aria-hidden viewBox="0 0 20 20" width="18" height="18">
            {open ? (
              <path d="M4 4 L16 16 M16 4 L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M3 5 H17 M3 10 H17 M3 15 H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
          Menu
        </button>
      </div>
      <nav id={menuId} aria-label="Main mobile" hidden={!open} className="border-t border-line bg-surface md:hidden">
        <ul className="flex flex-col gap-1 px-4 py-3">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={"end" in n} className={(s) => `block ${linkClass(s)}`}>
                {n.label}
              </NavLink>
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
              <Link to="/journalists" className="hover:underline">
                Journalists
              </Link>
            </li>
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
