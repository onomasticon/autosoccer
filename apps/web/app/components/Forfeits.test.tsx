// @vitest-environment jsdom
import type { FixtureStory, FixtureView } from "@autosoccer/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { featuredFixture, nextMatchStatus, STAGE_INFO, watchNote } from "../lib/matchday";
import { mockFixtures, mockStandings } from "../lib/mocks";
import { FormerNames } from "../routes/team";
import { FixtureCard, forfeitText } from "./MatchScoreCard";
import { forfeitNotes, StandingsTable } from "./StandingsTable";

afterEach(cleanup);

function renderIn(ui: React.ReactNode) {
  const router = createMemoryRouter([{ path: "/", element: ui }]);
  return render(<RouterProvider router={router} />);
}

const fixture = mockFixtures[0]!;
const walkover: FixtureView = {
  ...fixture,
  status: "completed",
  matchId: null,
  score: null,
  forfeit: { kind: "walkover", awardedTo: fixture.away.id, withdrawn: [fixture.home.id] },
};

describe("forfeits (insolvency/1)", () => {
  it("the table marks a withdrawn club, places it last and explains the walkovers", async () => {
    const [a, b, c, d] = mockStandings;
    const rows = [
      { ...a!, walkovers: 1 },
      { ...b!, walkovers: 1 },
      c!,
      { ...d!, position: 4, withdrawn: { round: 4 }, forfeits: 2 },
    ];
    renderIn(<StandingsTable rows={rows} caption="League table" />);
    const table = screen.getByTestId("standings-table");
    expect(table.textContent).toContain("Withdrawn");
    const notes = screen.getByTestId("forfeit-notes").textContent!;
    expect(notes).toContain(`${d!.team.name} withdrew before round 4 (bankrupt)`);
    expect(notes).toContain(`Includes walkovers (3 points each, no goals): ${a!.team.name} 1, ${b!.team.name} 1.`);
    expect((await axe.run(table)).violations.map((v) => v.id)).toEqual([]);
    expect(forfeitNotes(mockStandings)).toEqual([]);
  });

  it("a walkover fixture says who is awarded it and links to its matchday, not a match centre", async () => {
    renderIn(<FixtureCard fixture={walkover} />);
    const card = screen.getByTestId("fixture-card");
    expect(card.textContent).toContain("W/O");
    expect(card.textContent).toContain(`Walkover to ${fixture.away.name}: 3 points, no goals.`);
    expect(card.getAttribute("href")).toBe(`/matchday/${fixture.id}`);
    expect((await axe.run(card)).violations.map((v) => v.id)).toEqual([]);
    expect(
      forfeitText({
        ...walkover,
        forfeit: { kind: "void", awardedTo: null, withdrawn: [fixture.home.id, fixture.away.id] },
      })?.mark,
    ).toBe("Void");
    expect(forfeitText(fixture)).toBeNull();
  });

  it("a forfeited fixture is never the featured matchday, and Matchday is honest about it", () => {
    const open = { ...fixture, status: "scheduled" as const, forfeit: walkover.forfeit };
    const next = { ...mockFixtures[1]!, status: "scheduled" as const };
    expect(featuredFixture([open, next])?.id).toBe(next.id);
    expect(STAGE_INFO.forfeited.label).toBe("Walkover");
    expect(watchNote({ stage: "forfeited" } as FixtureStory, false)?.title).toBe("Not played");
    expect(nextMatchStatus(open, { stage: "forfeited" } as FixtureStory).label).toBe("Walkover");
  });

  it("a renamed club shows its former name and why", () => {
    renderIn(
      <FormerNames
        identities={[
          { name: "Harbour City", shortName: "HBC", fromSeason: null, reason: "founding", memo: "" },
          {
            name: "Harbour City Phoenix",
            shortName: "HCP",
            fromSeason: { slug: "season-3", name: "Season 3" },
            reason: "takeover",
            memo: "Taken over after withdrawing from Season 2 in round 4.",
          },
        ]}
      />,
    );
    const el = screen.getByTestId("former-names");
    expect(el.textContent).toContain("Formerly Harbour City (renamed from Season 3).");
    expect(el.textContent).toContain("Taken over after withdrawing from Season 2");
  });
});
