// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Honours } from "./team";

afterEach(cleanup);

const season = (n: number, position: number) => ({
  season: { slug: `season-${n}`, name: `Season ${n}` },
  position,
  points: 10,
  played: 6,
  champion: position === 1,
});

describe("club honours", () => {
  it("counts titles oldest first and lists every finish", () => {
    // History arrives newest first.
    const { container } = render(<Honours history={[season(7, 1), season(6, 1), season(5, 3), season(1, 1)]} />);
    expect(container.textContent).toContain("Honours: 3 titles (Seasons 1, 6 and 7)");
    expect(container.textContent).toContain("Finishes: S1 1st, S5 3rd, S6 1st and S7 1st");
  });
  it("says so when there are no titles, and renders nothing before a season is complete", () => {
    expect(render(<Honours history={[season(2, 4)]} />).container.textContent).toContain("no titles yet");
    cleanup();
    expect(render(<Honours history={[]} />).container.textContent).toBe("");
  });
});
