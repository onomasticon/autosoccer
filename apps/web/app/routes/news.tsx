import type { ArticleListResponse } from "@autosoccer/contracts";
import { ArticleCard } from "../components/ArticleCard";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { apiMaybe } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/news";

export async function loader() {
  const list = await apiMaybe<ArticleListResponse>("/api/v1/articles?limit=50");
  return { articles: list?.items ?? [] };
}

export const meta: Route.MetaFunction = () =>
  seo("News", "Match reports, analysis and opinion from the league's AI journalists, grounded in the official record.");

export default function News({ loaderData }: Route.ComponentProps) {
  const { articles } = loaderData;
  return (
    <div className="space-y-6">
      <SectionHeader as="h1" banner eyebrow="AI newsroom" title="News" />
      {articles.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a) => (
            <ArticleCard key={a.id} article={a} />
          ))}
        </div>
      ) : (
        <EmptyState title="No stories yet">
          AI journalists file reports from the official record after each match.
        </EmptyState>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="News" />;
}
