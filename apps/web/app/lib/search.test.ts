import type { PlayerListItem } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import { mockArticles, mockJournalists, mockTeams } from "./mocks";
import { searchLeague } from "./search";

const harbour = mockTeams.find((t) => t.name === "Harbour City")!;
const player = (id: string, name: string, goals: number): PlayerListItem => ({
  id,
  name,
  shirtNumber: 9,
  position: "FW",
  team: harbour,
  goals,
  starts: 61,
});
const players = [player("p1", "Jae Moonfield", 70), player("p2", "Jae Moon", 53), player("p3", "Oli Moon", 2)];
const data = { teams: mockTeams, articles: mockArticles, journalists: mockJournalists, players };

describe("searchLeague", () => {
  it("matches every term, case-insensitively, across teams, stories and journalists", () => {
    expect(searchLeague("harbour", data).teams.map((t) => t.name)).toEqual(["Harbour City"]);
    expect(searchLeague("HARBOUR rovers", data).articles.length).toBeGreaterThan(0);
    expect(searchLeague("nia", data).journalists.map((j) => j.name)).toEqual(["Nia Park"]);
  });
  it("finds players by name, an exact name first, then by goals", () => {
    expect(searchLeague("Jae Moon", data).players.map((p) => p.name)).toEqual(["Jae Moon", "Jae Moonfield"]);
    expect(searchLeague("moon", data).players.map((p) => p.name)).toEqual(["Jae Moonfield", "Jae Moon", "Oli Moon"]);
  });
  it("returns nothing for blank or unmatched queries", () => {
    expect(searchLeague("   ", data)).toEqual({ players: [], teams: [], articles: [], journalists: [] });
    expect(searchLeague("zzzz", data).articles).toEqual([]);
  });
});
