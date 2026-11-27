import type { League, LeagueListResponse } from "@autosoccer/contracts";
import { Link } from "react-router";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/States";
import { apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/leagues";

export async function loader() {
  return apiOr404<LeagueListResponse>("/api/v1/leagues");
}

export const meta: Route.MetaFunction = () => seo("Leagues", "Every Auto Soccer league, playing or archived.");

/** An honest label: archived history is never presented as live. */
export function leagueStatus(l: Pick<League, "status" | "isDefault">): { label: string; tone: string } {
  switch (l.status) {
    case "archived":
      return { label: "Archived · read-only", tone: "bg-line text-ink" };
    case "concluded":
      return { label: "Concluded", tone: "bg-lavender-strong text-violet-deep" };
    case "draft":
      return { label: "Being founded", tone: "bg-yellow text-ink" };
    default:
      return { label: l.isDefault ? "Playing now" : "Playing", tone: "bg-coral text-ink" };
  }
}

export function LeagueCard({ l }: { l: League }) {
  const s = leagueStatus(l);
  return (
    <li className="card-surface space-y-2 p-5">
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-text">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${s.tone}`}>{s.label}</span>
        {l.division && <span>{l.division}</span>}
        <span>
          {l.seasons} season{l.seasons === 1 ? "" : "s"}
        </span>
      </p>
      <h2 className="font-display text-3xl font-extrabold uppercase italic leading-none">
        <Link to={`/leagues/${l.slug}`} className="hover:text-violet-deep">
          {l.name}
        </Link>
      </h2>
      {l.description && <p className="text-sm">{l.description}</p>}
      {l.latestSeason && (
        <p className="text-sm">
          <span className="font-semibold">{l.status === "active" ? "Current" : "Last"} season: </span>
          {l.latestSeason.name} ({l.latestSeason.status})
        </p>
      )}
    </li>
  );
}

export default function Leagues({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SectionHeader as="h1" banner eyebrow="The universe" title="Leagues" />
      {!loaderData.items.length ? (
        <EmptyState title="No leagues yet" />
      ) : (
        <ul className="grid gap-4">
          {loaderData.items.map((l) => (
            <LeagueCard key={l.slug} l={l} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Leagues" />;
}
