import type { ArticleCardView, EditorialAgent, PlayerListItem, Team } from "@autosoccer/contracts";

export interface SearchResults {
  players: PlayerListItem[];
  teams: Team[];
  articles: ArticleCardView[];
  journalists: EditorialAgent[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Every whitespace-separated term must appear somewhere in the item's text (case/accent-insensitive). */
export function searchLeague(
  q: string,
  data: { players?: PlayerListItem[]; teams: Team[]; articles: ArticleCardView[]; journalists: EditorialAgent[] },
): SearchResults {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return { players: [], teams: [], articles: [], journalists: [] };
  const exact = norm(q).trim().replace(/\s+/g, " ");
  const hit = (...fields: string[]) => {
    const text = norm(fields.join(" "));
    return terms.every((t) => text.includes(t));
  };
  return {
    // Players by name (or club): an exact name first, then the most goals.
    players: (data.players ?? [])
      .filter((p) => hit(p.name, p.team.name, p.team.shortName))
      .sort(
        (a, b) =>
          Number(norm(b.name) === exact) - Number(norm(a.name) === exact) ||
          b.goals - a.goals ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 12),
    teams: data.teams.filter((t) => hit(t.name, t.shortName, t.city)),
    articles: data.articles.filter((a) => hit(a.headline, a.standfirst, a.author.name)),
    journalists: data.journalists.filter((j) => hit(j.name, j.role, j.bio)),
  };
}
