import { describe, expect, it } from "vitest";
import { mockArticles, mockJournalists, mockTeams } from "./mocks";
import { searchLeague } from "./search";

const data = { teams: mockTeams, articles: mockArticles, journalists: mockJournalists };

describe("searchLeague", () => {
  it("matches every term, case-insensitively, across teams, stories and journalists", () => {
    expect(searchLeague("harbour", data).teams.map((t) => t.name)).toEqual(["Harbour City"]);
    expect(searchLeague("HARBOUR rovers", data).articles.length).toBeGreaterThan(0);
    expect(searchLeague("nia", data).journalists.map((j) => j.name)).toEqual(["Nia Park"]);
  });
  it("returns nothing for blank or unmatched queries", () => {
    expect(searchLeague("   ", data)).toEqual({ teams: [], articles: [], journalists: [] });
    expect(searchLeague("zzzz", data).articles).toEqual([]);
  });
});
