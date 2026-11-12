// @vitest-environment jsdom
import type { SeasonSummary, StandingRow } from "@autosoccer/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { SeasonCard, scorersLine } from "./history";

afterEach(cleanup);

const [a, b] = mockTeams;
const row = (team: typeof a, points: number, position: number): StandingRow => ({
  position,
  team: team!,
  played: 6,
  won: 3,
  drawn: 1,
  lost: 2,
  goalsFor: 6,
  goalsAgainst: 3,
  goalDifference: 3,
  points,
  form: ["W", "W", "W", "D", "L"],
});
const summary = (over: Partial<SeasonSummary> = {}): SeasonSummary => ({
  season: {
    id: "00000000-0000-4000-8000-000000000003",
    slug: "season-3",
    name: "Season 3",
    status: "completed",
    seed: 1,
    simVersion: "0bc52c0",
    playersPerTeam: 7,
    budgetPerTeamMicroUsd: 1_000_000,
    startsAt: "2026-11-21T15:00:00.000Z",
    completedAt: "2026-12-26T16:00:00.000Z",
  },
  roundsPlayed: 6,
  rounds: 6,
  leader: row(a, 10, 1),
  runnerUp: row(b, 8, 2),
  margin: 2,
  topScorers: [{ playerId: "00000000-0000-4000-8000-000000000101", name: "Max Ruiz", team: b!, goals: 4 }],
  goalsPerMatch: 1.58,
  decidedAfterRound: 5,
  ...over,
});

const show = (s: SeasonSummary) => {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <ol>
          <SeasonCard s={s} />
        </ol>
      ),
    },
  ]);
  return render(<Stub />);
};

describe("roll of honour", () => {
  it("names the champion, the margin, the top scorer and links the final table", async () => {
    const { container } = show(summary());
    expect(screen.getByRole("heading", { name: `${a!.name}, champions` })).toBeTruthy();
    expect(container.textContent).toMatch(`10 pts, 2 pts clear of ${b!.name}`);
    expect(container.textContent).toMatch(`Max Ruiz (${b!.name}), 4 goals`);
    expect(screen.getByRole("link", { name: "Final table" }).getAttribute("href")).toBe("/table?season=season-3");
    expect(container.textContent).toMatch("after round 5, with 1 round to spare");
    const r = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it("calls an unfinished season's leader the leader, not the champion", () => {
    show(summary({ season: { ...summary().season, status: "active" }, roundsPlayed: 3 }));
    expect(screen.getByRole("heading", { name: `${a!.name} lead` })).toBeTruthy();
    expect(screen.getByText(/after round 3 of 6/)).toBeTruthy();
  });

  it("lists shared top scorers", () => {
    expect(
      scorersLine([
        { playerId: "1", name: "A", team: a!, goals: 2 },
        { playerId: "2", name: "B", team: b!, goals: 2 },
      ]),
    ).toBe(`A (${a!.name}) and B (${b!.name}), 2 goals each`);
    expect(scorersLine([])).toBe("No goals yet");
  });
});
