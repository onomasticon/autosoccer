// @vitest-environment jsdom
import { ClubFinancesResponse } from "@autosoccer/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { ClubFinances, credits } from "./ClubFinances";

afterEach(cleanup);

const rules = {
  opening: 12_000_000,
  distribution: 6_000_000,
  result: { win: 600_000, draw: 250_000, loss: 0 },
  prize: [4_000_000, 2_500_000, 1_500_000, 800_000],
  wage: { base: 30_000, perPoint: 3_000, floor: 45, min: 20_000 },
};
const active = ClubFinancesResponse.parse({
  contract: "club-finances/1",
  team: mockTeams[0],
  active: true,
  rule: "finance/1",
  balance: 14_350_000,
  payroll: { perRound: 1_300_000, players: 16, roundsToPay: 5, remaining: 6_500_000 },
  headroom: 7_850_000,
  seasons: [
    {
      season: { slug: "season-1", name: "Season 1" },
      bySource: { distribution: 6_000_000, results: 1_700_000, prize: 2_500_000, payroll: -7_800_000 },
      net: 2_400_000,
    },
  ],
  entries: [
    {
      kind: "payroll",
      season: { slug: "season-1", name: "Season 1" },
      round: 6,
      amount: -1_300_000,
      memo: "Wages, round 6 (16 players)",
      at: "2026-11-20T12:00:00Z",
    },
  ],
  rules,
});

describe("ClubFinances", () => {
  it("shows cash, wages still due and headroom, then earnings and spending by source", async () => {
    render(<ClubFinances finances={active} />);
    const el = screen.getByTestId("club-finances");
    expect(within(el).getByText("14.35m cr")).toBeTruthy();
    expect(within(el).getByText("−6.5m cr")).toBeTruthy();
    expect(within(el).getByText("7.85m cr")).toBeTruthy();
    expect(within(el).getByRole("row", { name: /Wages −7.8m cr/ })).toBeTruthy();
    expect(within(el).getByRole("row", { name: /Net 2.4m cr/ })).toBeTruthy();
    const r = await axe.run(el);
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it("before the club's first finance season, explains when money starts", () => {
    render(<ClubFinances finances={{ ...active, active: false, seasons: [], entries: [] }} />);
    expect(screen.getByTestId("club-finances").textContent).toContain("opening balance of 12m cr");
  });

  it("formats credits compactly", () => {
    expect([credits(999), credits(45_000), credits(-1_000_000)]).toEqual(["999 cr", "45k cr", "−1m cr"]);
  });
});
