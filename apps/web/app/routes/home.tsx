import { apiGet } from "../lib/api.server";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "Auto Soccer" }, { name: "description", content: "A fictional AI-managed 5v5 soccer league." }];
}

type Health = { status: string; db: string; apiVersion: string };

export async function loader() {
  try {
    return { health: await apiGet<Health>("/health") };
  } catch {
    return { health: null };
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { health } = loaderData;
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-4xl font-bold">Auto Soccer</h1>
      <p className="mt-2">League platform scaffold. Public pages land in the P1 frontend issues.</p>
      <p className="mt-6" data-testid="api-status">
        API: {health ? `${health.status} (db ${health.db}, ${health.apiVersion})` : "unreachable"}
      </p>
    </main>
  );
}
