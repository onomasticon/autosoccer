// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { OverallBadge, PlayerRatings } from "./PlayerRatings";

afterEach(cleanup);

const attributes = {
  pace: 48,
  acceleration: 52,
  agility: 64,
  stamina: 55,
  control: 50,
  passing: 57,
  shooting: 30,
  power: 60,
  tackling: 33,
  goalkeeping: 74,
};
const gk = { position: "GK" as const, attributes };
const fw = { position: "FW" as const, attributes: { ...attributes, goalkeeping: 20 } };

describe("PlayerRatings", () => {
  it("lists every rating for a goalkeeper, and leaves goalkeeping out for outfield players", async () => {
    const { container } = render(<PlayerRatings player={gk} />);
    const list = screen.getByTestId("player-ratings");
    expect(within(list).getAllByRole("term")).toHaveLength(10);
    expect(within(list).getByText("Goalkeeping")).toBeTruthy();
    expect(within(list).getByText(String(gk.attributes.goalkeeping))).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    cleanup();
    render(<PlayerRatings player={fw} />);
    expect(within(screen.getByTestId("player-ratings")).getAllByRole("term")).toHaveLength(9);
    expect(screen.queryByText("Goalkeeping")).toBeNull();
  });

  it("labels the overall rating for screen readers", () => {
    render(<OverallBadge overall={78} />);
    expect(screen.getByText("Overall rating")).toBeTruthy();
    expect(screen.getByText("78")).toBeTruthy();
  });
});
