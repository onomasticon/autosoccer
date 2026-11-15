// @vitest-environment jsdom
import { PlayerCareer as CareerSchema } from "@autosoccer/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { PlayerCareer } from "./PlayerCareer";

afterEach(cleanup);

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const attrs = {
  pace: 70,
  acceleration: 68,
  agility: 64,
  stamina: 62,
  control: 66,
  passing: 58,
  shooting: 74,
  power: 70,
  tackling: 40,
  goalkeeping: 30,
};
const career = CareerSchema.parse({
  playerId: id(1),
  name: "Eli Moreau",
  shirtNumber: 9,
  position: "FW",
  seasons: [
    {
      season: { slug: "season-4", name: "Season 4" },
      source: "baseline",
      rule: null,
      overall: 69,
      attributes: attrs,
      changes: [],
      teamMatches: 6,
      starts: 6,
      goals: 4,
    },
    {
      season: { slug: "season-5", name: "Season 5" },
      source: "snapshot",
      rule: "develop/1",
      overall: 70,
      attributes: { ...attrs, shooting: 76, control: 67 },
      changes: [
        { attribute: "control", delta: 1, reasons: ["regular starter (6/6)"] },
        { attribute: "shooting", delta: 2, reasons: ["regular starter (6/6)", "4 goals in 6 starts"] },
      ],
      teamMatches: 2,
      starts: 1,
      goals: 0,
    },
  ],
  form: [
    { matchId: id(11), round: 1, started: true, goals: 0 },
    { matchId: id(12), round: 2, started: false, goals: 0 },
  ],
});

describe("PlayerCareer", () => {
  it("shows the record and the derived ratings apart, with what the rule changed and why", async () => {
    const Stub = createRoutesStub([{ path: "*", Component: () => <PlayerCareer career={career} /> }]);
    const { container } = render(<Stub initialEntries={["/"]} />);
    const el = screen.getByTestId("player-career");
    const rows = within(el).getAllByRole("row");
    expect(rows[1]!.textContent).toContain("Season 4(baseline)");
    expect(rows[1]!.textContent).toContain("6/6");
    expect(rows[2]!.textContent).toContain("1/2");
    expect(el.textContent).toContain("Shooting +2 (regular starter (6/6), 4 goals in 6 starts)");
    expect(
      within(el)
        .getByRole("link", { name: /R1 started/ })
        .getAttribute("href"),
    ).toBe(`/matches/${id(11)}`);
    expect(within(el).getByRole("link", { name: /R2 didn't start/ })).toBeTruthy();
    expect(el.textContent).toMatch(/Starts and goals are from the official record\. Ratings are derived/);
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
