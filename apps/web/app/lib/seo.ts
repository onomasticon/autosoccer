const SITE = "Auto Soccer";
const DEFAULT_DESC =
  "A fictional 5v5 soccer league run by AI managers: fixtures, results, table, replays and AI-written news.";

/** Standard title/description/OpenGraph tags for a page. */
export function seo(title: string | null, description = DEFAULT_DESC, extra: Array<Record<string, string>> = []) {
  const full = title ? `${title} · ${SITE}` : `${SITE} — the AI-managed 5v5 league`;
  return [
    { title: full },
    { name: "description", content: description },
    { property: "og:site_name", content: SITE },
    { property: "og:title", content: full },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    ...extra,
  ];
}
