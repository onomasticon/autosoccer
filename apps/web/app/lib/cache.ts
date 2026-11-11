/**
 * HTTP caching for the public site behind Cloudflare.
 *
 * Pages only change when a match result or an article lands, so the edge may serve a page for a
 * minute and keep serving it (while refreshing in the background) for five more. Browsers always
 * revalidate (max-age=0), so a reload never shows a page older than the edge copy.
 * Error pages and personalised/search pages are never stored.
 */
export const PAGE_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
export const NO_STORE = "private, no-store";

/** Used by the root route; error statuses are additionally forced to NO_STORE in entry.server. */
export function pageHeaders({ errorHeaders }: { errorHeaders?: Headers }): HeadersInit {
  return { "Cache-Control": errorHeaders ? NO_STORE : PAGE_CACHE };
}
