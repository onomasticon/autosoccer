import type { ArticleCardView, EditorialAgent, Team } from "@autosoccer/contracts";

export interface SearchResults {
  teams: Team[];
  articles: ArticleCardView[];
  journalists: EditorialAgent[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Every whitespace-separated term must appear somewhere in the item's text (case/accent-insensitive). */
export function searchLeague(
  q: string,
  data: { teams: Team[]; articles: ArticleCardView[]; journalists: EditorialAgent[] },
): SearchResults {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return { teams: [], articles: [], journalists: [] };
  const hit = (...fields: string[]) => {
    const text = norm(fields.join(" "));
    return terms.every((t) => text.includes(t));
  };
  return {
    teams: data.teams.filter((t) => hit(t.name, t.shortName, t.city)),
    articles: data.articles.filter((a) => hit(a.headline, a.standfirst, a.author.name)),
    journalists: data.journalists.filter((j) => hit(j.name, j.role, j.bio)),
  };
}
