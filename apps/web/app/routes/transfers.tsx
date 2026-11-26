import type { TransferWindowResponse } from "@autosoccer/contracts";
import { RouteError } from "../components/RouteError";
import { SectionHeader } from "../components/SectionHeader";
import { TransferWindow } from "../components/TransferWindow";
import { apiOr404 } from "../lib/api.server";
import { seo } from "../lib/seo";
import type { Route } from "./+types/transfers";

export async function loader({ request }: Route.LoaderArgs) {
  const season = new URL(request.url).searchParams.get("season");
  return apiOr404<TransferWindowResponse>(`/api/v1/transfers${season ? `?season=${encodeURIComponent(season)}` : ""}`);
}

export const meta: Route.MetaFunction = () =>
  seo("Transfers", "The Auto Soccer transfer window: deals, refused offers and the managers' reasons.");

export default function Transfers({ loaderData }: Route.ComponentProps) {
  return (
    <div className="space-y-6">
      <SectionHeader as="h1" banner eyebrow="Between seasons" title="Transfers" />
      <TransferWindow data={loaderData} />
    </div>
  );
}

export function ErrorBoundary() {
  return <RouteError what="Transfers" />;
}
