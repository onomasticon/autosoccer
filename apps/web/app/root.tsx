import type { FixturesResponse, SeasonResponse } from "@autosoccer/contracts";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigation } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { LeagueHeader, SiteFooter } from "./components/LeagueHeader";
import { ScoreTicker } from "./components/ScoreTicker";
import { apiGet } from "./lib/api.server";
import { tickerFixtures } from "./lib/ticker";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800&family=Barlow+Semi+Condensed:ital,wght@0,600;0,700;1,800&family=Barlow:ital,wght@1,800;1,900&family=Inter:wght@400;500;600;700&display=swap",
  },
];

/** Shell data: the matchweek ticker. Failures degrade to an empty ticker, never a broken page. */
export async function loader() {
  try {
    const { season } = await apiGet<SeasonResponse>("/api/v1/seasons/current");
    const { rounds } = await apiGet<FixturesResponse>(`/api/v1/seasons/${season.slug}/fixtures`);
    return { ticker: tickerFixtures(rounds) };
  } catch {
    return { ticker: { matchweek: null, fixtures: [], next: null } };
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="autosoccer-pop">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#FDFAF7" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-canvas text-ink">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const nav = useNavigation();
  return (
    <>
      <LeagueHeader />
      <ScoreTicker {...loaderData.ticker} />
      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto max-w-[1440px] px-4 py-8 outline-none sm:px-6 ${nav.state === "loading" ? "opacity-70 transition-opacity" : ""}`}
      >
        <Outlet />
      </main>
      <SiteFooter />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const title = status === 404 ? "Page not found" : "Something went wrong";
  return (
    <>
      <LeagueHeader />
      <main id="main" className="mx-auto max-w-2xl px-4 py-16">
        <p className="font-display text-7xl font-extrabold italic text-coral">{status}</p>
        <h1 className="mt-2 font-display text-4xl font-extrabold uppercase">{title}</h1>
        <p className="mt-3 text-muted-text">
          {status === 404
            ? "That page isn't part of the league."
            : "The page couldn't be loaded. Please try again shortly."}
        </p>
        <a href="/" className="mt-6 inline-block rounded-md bg-ink px-4 py-2 font-semibold text-white">
          Back to the homepage
        </a>
      </main>
    </>
  );
}
