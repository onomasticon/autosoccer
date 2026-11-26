// @vitest-environment jsdom
import { TransferWindowResponse } from "@autosoccer/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { TransferWindow } from "./TransferWindow";

afterEach(cleanup);

const [harbour, rovers, northgate] = mockTeams;
const moon = { id: "00000000-0000-4000-8000-000000000010", name: "Jae Moon", position: "FW" as const, overall: 74 };
const bid = (over: Record<string, unknown>) => ({
  id: "00000000-0000-4000-8000-000000000101",
  player: moon,
  seller: harbour,
  buyer: northgate,
  fee: 3_250_000,
  wage: 117_000,
  status: "completed",
  buyerReason: "Jae Moon scored most of Harbour's goals last season.",
  sellerReason: "3,250,000 cr is too good to refuse, and we have cover up front.",
  outcome: null,
  createdAt: "2026-11-26T10:00:00Z",
  settledAt: "2026-11-26T11:45:00Z",
  ...over,
});
const data = TransferWindowResponse.parse({
  contract: "transfer-window/1",
  window: {
    season: { slug: "season-2", name: "Season 2" },
    rule: "transfer/1",
    phase: "closed",
    opensAt: "2026-11-26T10:00:00Z",
    deadline: "2026-11-26T11:45:00Z",
    phaseEndsAt: "2026-11-26T11:45:00Z",
    closedAt: "2026-11-26T11:45:00Z",
  },
  listings: [],
  bids: [
    bid({}),
    bid({
      id: "00000000-0000-4000-8000-000000000102",
      buyer: rovers,
      fee: 2_750_000,
      status: "outbid",
      sellerReason: "We accepted a higher offer for Jae Moon.",
    }),
  ],
  rules: {
    maxListings: 2,
    maxBids: 2,
    minFee: 100_000,
    minSquad: 9,
    maxSquad: 18,
    goalkeepers: 1,
    closeBeforeKickoffMin: 15,
  },
});

function renderIn(ui: React.ReactNode) {
  const router = createMemoryRouter([{ path: "/", element: ui }]);
  return render(<RouterProvider router={router} />);
}

describe("TransferWindow", () => {
  it("shows each deal with both clubs' reasons and a career link, then the other bids", async () => {
    renderIn(<TransferWindow data={data} />);
    const deal = screen.getByTestId("transfer-deal");
    expect(within(deal).getByRole("link", { name: "Jae Moon" }).getAttribute("href")).toMatch(
      /^\/players\/.+\/jae-moon$/,
    );
    expect(within(deal).getByText("3.25m cr")).toBeTruthy();
    expect(within(deal).getByText(/too good to refuse/)).toBeTruthy();
    const other = screen.getByTestId("transfer-bid");
    expect(other.textContent).toContain("Outbid");
    expect(other.textContent).toContain("2.75m cr");
    const r = await axe.run(screen.getByTestId("transfer-window"));
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it("before any window, says when the first one opens", () => {
    renderIn(<TransferWindow data={{ ...data, window: null, bids: [] }} />);
    expect(screen.getByTestId("transfer-window").textContent).toContain("No transfer window yet");
  });
});
