import type { ArticleListResponse, JournalistListResponse, SeasonResponse } from "@autosoccer/contracts";
import { Form, Link } from "react-router";
import { AgentProfileCard } from "../components/AgentProfileCard";
import { ArticleCard } from "../components/ArticleCard";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { TeamBadge } from "../components/TeamBadge";
import { apiMaybe, apiOptional } from "../lib/api.server";
import { NO_STORE } from "../lib/cache";
import { searchLeague } from "../lib/search";
import { seo } from "../lib/seo";
import type { Route } from "./+types/search";

export async function loader({ request }: Route.LoaderArgs) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return { q, results: null };
  const [season, articles, journalists] = await Promise.all([
    apiOptional<SeasonResponse>("/api/v1/seasons/current"),
    apiMaybe<ArticleListResponse>("/api/v1/articles?limit=50"),
    apiMaybe<JournalistListResponse>("/api/v1/journalists"),
  ]);
  return {
    q,
    results: searchLeague(q, {
      teams: season?.teams ?? [],
      articles: articles?.items ?? [],
      journalists: journalists?.items ?? [],
    }),
  };
}

/** Results depend on the query string: never cache at the edge. */
export const headers: Route.HeadersFunction = () => ({ "Cache-Control": NO_STORE });

export const meta: Route.MetaFunction = ({ data }) => seo(data?.q ? `Search: ${data.q}` : "Search");

export default function Search({ loaderData }: Route.ComponentProps) {
  const { q, results } = loaderData;
  const total = results ? results.teams.length + results.articles.length + results.journalists.length : 0;
  return (
    <div className="space-y-8">
      <SectionHeader as="h1" banner eyebrow="Teams, stories, personalities" title="Search" />
      <Form method="get" role="search" className="flex max-w-2xl gap-2">
        <label htmlFor="q" className="sr-only">
          Search the league
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Try “Rovers”, “high press” or “Nia”"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-lg shadow-[var(--shadow-card)]"
        />
        <button type="submit" className="parallelogram grad-violet font-semi text-lg font-bold uppercase text-white">
          Search
        </button>
      </Form>
      {results &&
        (total === 0 ? (
          <EmptyState title={`Nothing found for “${q}”`}>
            Search covers club names, story headlines and the league's journalists.
          </EmptyState>
        ) : (
          <p className="text-sm text-muted-text" role="status">
            {total} result{total === 1 ? "" : "s"} for “{q}”
          </p>
        ))}
      {results && results.teams.length > 0 && (
        <section aria-labelledby="r-teams">
          <SectionHeader id="r-teams" title="Teams" />
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {results.teams.map((t) => (
              <li key={t.id}>
                <Link to={`/teams/${t.slug}`} className="card-surface flex items-center gap-3 p-4 hover:border-violet">
                  <TeamBadge team={t} size="md" decorative />
                  <span className="font-semi text-xl font-bold">{t.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {results && results.articles.length > 0 && (
        <section aria-labelledby="r-stories">
          <SectionHeader id="r-stories" title="Stories" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.articles.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>
        </section>
      )}
      {results && results.journalists.length > 0 && (
        <section aria-labelledby="r-people">
          <SectionHeader id="r-people" title="Personalities" />
          <div className="grid gap-4 md:grid-cols-3">
            {results.journalists.map((j) => (
              <AgentProfileCard key={j.id} agent={{ ...j, href: `/journalists/${j.slug}` }} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Search" />;
}
