import type { SeasonMarketResponse } from "@autosoccer/contracts";
import { RouteError } from "../components/RouteError";
import { SeasonMarket } from "../components/SeasonMarket";
import { SectionHeader } from "../components/SectionHeader";
import { apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/market";

export async function loader({ params }: Route.LoaderArgs) {
  return apiOr404<SeasonMarketResponse>(`/api/v1/seasons/${encodeURIComponent(params.season)}/market`);
}

export const meta: Route.MetaFunction = ({ data }) =>
  seo(
    data ? `${data.season.name} player market` : "Player market",
    data ? `${data.season.name}: recruitment, contracts, free agents and forced auctions.` : "",
  );

export default function Market({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SectionHeader as="h1" banner eyebrow={loaderData.season.name} title="Player market" />
      <SeasonMarket data={loaderData} />
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Player market" />;
}
