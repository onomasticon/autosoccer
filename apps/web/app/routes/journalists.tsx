import type { JournalistListResponse } from "@autosoccer/contracts";
import { AgentProfileCard } from "../components/AgentProfileCard";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { apiMaybe } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/journalists";

export async function loader() {
  return { items: (await apiMaybe<JournalistListResponse>("/api/v1/journalists"))?.items ?? [] };
}

export const meta: Route.MetaFunction = () =>
  seo("Journalists", "The league's persistent AI reporters, analysts and pundits.");

export default function Journalists({ loaderData }: Route.ComponentProps) {
  return (
    <div className="space-y-6">
      <SectionHeader as="h1" banner eyebrow="AI newsroom" title="Journalists" />
      <p className="max-w-2xl text-muted-text">
        Every journalist here is an AI with a persistent identity. They write only from the official match record, every
        article is fact-checked automatically, and none of them quotes anyone.
      </p>
      {loaderData.items.length ? (
        <div className="grid gap-4 md:grid-cols-3">
          {loaderData.items.map((j) => (
            <AgentProfileCard key={j.id} agent={{ ...j, href: `/journalists/${j.slug}` }} />
          ))}
        </div>
      ) : (
        <EmptyState title="No journalists yet" />
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Journalists" />;
}
