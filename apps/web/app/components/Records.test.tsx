// @vitest-environment jsdom
import type { RecordsResponse } from "@autosoccer/contracts";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { Records } from "./Records";

afterEach(cleanup);

const [a, b] = mockTeams as [(typeof mockTeams)[number], (typeof mockTeams)[number]];
const s9 = { slug: "season-9", name: "Season 9" };
const records = (over: Partial<RecordsResponse> = {}): RecordsResponse => ({
  mostPoints: [{ season: s9, team: a, points: 18, played: 6 }],
  perfectSeasons: [{ season: s9, team: a, won: 6 }],
  mostGoalsInSeason: [{ season: { slug: "season-7", name: "Season 7" }, name: "Sol Achebe", team: b, goals: 8 }],
  biggestWin: [
    {
      season: { slug: "season-6", name: "Season 6" },
      round: 1,
      matchId: "00000000-0000-4000-8000-000000000123",
      winner: a,
      loser: b,
      score: "0–5",
      margin: 5,
    },
  ],
  ...over,
});
const show = (r: RecordsResponse) => {
  const Stub = createRoutesStub([{ path: "/", Component: () => <Records records={r} /> }]);
  return render(<Stub />);
};

describe("league records", () => {
  it("lists each record with its season, linking the biggest win", async () => {
    const { container, getByRole } = show(records());
    const text = container.textContent ?? "";
    expect(text).toContain(`Most points in a season18: ${a.name} (Season 9)`);
    expect(text).toContain(`${a.name}, Season 9 (won all 6)`);
    expect(text).toContain(`8: Sol Achebe, ${b.name} (Season 7)`);
    expect(getByRole("link", { name: `${a.name} over ${b.name}, 0–5` }).getAttribute("href")).toBe(
      "/matches/00000000-0000-4000-8000-000000000123",
    );
    const r = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
  it("says when nobody has had a perfect season", () => {
    expect(show(records({ perfectSeasons: [] })).container.textContent).toContain("None yet");
  });
});
