// @vitest-environment jsdom
import type { ScorerRow } from "@autosoccer/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { ScorersTable } from "./ScorersTable";

afterEach(cleanup);

const row = (rank: number, name: string, goals: number, t = 0): ScorerRow => ({
  rank,
  playerId: `00000000-0000-4000-8000-00000000000${rank}${t}`,
  name,
  team: mockTeams[t]!,
  goals,
  matches: 6,
});

describe("top scorers", () => {
  it("ranks players, marks ties with '=' and passes axe", async () => {
    const rows = [row(1, "Yusuf Demir", 7), row(2, "Faye Burke", 2, 1), row(2, "Lia Sorn", 2, 2)];
    const Stub = createRoutesStub([{ path: "/", Component: () => <ScorersTable rows={rows} caption="Top scorers" /> }]);
    const { container } = render(<Stub />);
    const cells = [...container.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent);
    expect(cells).toEqual(["1", "2", "="]);
    expect(screen.getByText("Yusuf Demir")).toBeTruthy();
    const r = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it("says so when nobody has scored", () => {
    render(<ScorersTable rows={[]} caption="Top scorers" />);
    expect(screen.getByText("No goals yet.")).toBeTruthy();
  });
});
