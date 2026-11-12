import type { Fact } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import { checkClaims } from "./claims.ts";
import { columnHeadline } from "./offline.ts";

const standing = (name: string, position: number, points: number): Fact => ({
  id: `standing:s:r6:${name}`,
  kind: "standing",
  statement: `${name} are ${position}`,
  value: { team: { id: name, name }, afterRound: 6, teams: 2, position, points, played: 6, won: 0, drawn: 0, lost: 0 },
  source: { table: "matches", id: "season:s" },
});

describe("template column headline", () => {
  it("says who leads and by how much, and passes the claim checks", () => {
    const table = [standing("Saltmarsh Athletic", 1, 10), standing("Northgate Comets", 2, 8)];
    const h = columnHeadline(table, 6);
    expect(h).toBe("Saltmarsh Athletic lead by 2 points after round 6");
    const facts = {
      contract: "editorial-facts/1" as const,
      seasonId: "s",
      matchId: null,
      generatedFrom: { resultFinalHash: null, standingsAfterRound: 6 },
      match: null,
      facts: table,
    };
    expect(checkClaims(h, facts)).toEqual([]);
  });
  it("calls a tie at the top a tie", () => {
    expect(columnHeadline([standing("A", 1, 8), standing("B", 2, 8)], 3)).toBe(
      "A and B level on points at the top after round 3",
    );
  });
});
