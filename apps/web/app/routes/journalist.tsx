import type { JournalistDetailResponse } from "@autosoccer/contracts";
import { AgentProfileCard } from "../components/AgentProfileCard";
import { ArticleCard } from "../components/ArticleCard";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/journalist";

export async function loader({ params }: Route.LoaderArgs) {
  return apiOr404<JournalistDetailResponse>(`/api/v1/journalists/${encodeURIComponent(params.slug)}`);
}

export const meta: Route.MetaFunction = ({ data }) =>
  data ? seo(`${data.journalist.name} (AI ${data.journalist.role})`, data.journalist.bio) : seo("Journalist not found");

export default function Journalist({ loaderData }: Route.ComponentProps) {
  const { journalist: j, articles } = loaderData;
  return (
    <div className="space-y-8">
      <h1 className="sr-only">{j.name}</h1>
      <div className="max-w-2xl">
        <AgentProfileCard agent={{ ...j, meta: `Writing style: ${j.voice}` }} />
      </div>
      <section aria-labelledby="by">
        <SectionHeader id="by" title={`By ${j.name}`} />
        {articles.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>
        ) : (
          <EmptyState title="Nothing filed yet" />
        )}
      </section>
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Journalist" />;
}
