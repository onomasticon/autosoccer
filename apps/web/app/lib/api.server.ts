/** Server-only API client used by route loaders. Page rendering never calls LLMs. */
export const API_URL = process.env.API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: { accept: "application/json", ...init?.headers } });
  } catch (e) {
    throw new ApiError(503, `API unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Like apiGet, but resolves to null for optional data (404 or API down) so sections degrade to empty states. */
export async function apiMaybe<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch {
    return null;
  }
}

/** Loader helper: a missing resource becomes a 404 page; anything else a 503 error page. */
export async function apiOr404<T>(path: string): Promise<T> {
  try {
    return await apiGet<T>(path);
  } catch (e) {
    const status = e instanceof ApiError && e.status === 404 ? 404 : 503;
    throw new Response(status === 404 ? "Not found" : "League data is temporarily unavailable", { status });
  }
}

/** null when the resource doesn't exist (404); a 503 error page when the API is failing. */
export async function apiOptional<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw new Response("League data is temporarily unavailable", { status: 503 });
  }
}
