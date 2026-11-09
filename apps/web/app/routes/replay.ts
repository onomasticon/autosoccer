import { API_URL } from "../lib/api.server";
import type { Route } from "./+types/replay";

/** Same-origin proxy for replay files so the browser viewer never needs CORS. */
export async function loader({ params, request }: Route.LoaderArgs) {
  const upstream = await fetch(`${API_URL}/api/v1/matches/${encodeURIComponent(params.id)}/replay`, {
    headers: { "if-none-match": request.headers.get("if-none-match") ?? "" },
  });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "etag", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
