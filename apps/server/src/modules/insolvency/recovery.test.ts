import { describe, expect, it } from "vitest";
import { runLeague } from "../economy/engine.ts";
import { CANDIDATE, RULESETS, SCENARIOS } from "../economy/rulesets.ts";
import { finance3, finance3Prizes, rulesFor } from "../finance/rules.ts";
import {
  auctionWinner,
  canExitAdministration,
  collateralValue,
  debtCap,
  emergencyFinancing,
  INSOLVENCY_2,
  instalment,
  type LoanLike,
  securedCapacity,
  waterfall,
} from "./recovery.ts";

const loan = (id: string, kind: LoanLike["kind"], balance: number, dueSeason = 3): LoanLike => ({
  id,
  kind,
  balance,
  dueSeason,
  collateral: [],
});

describe("finance/3", () => {
  it("pays every place in a 20-club league, falling from the top, and leaves older rules alone", () => {
    const p = finance3Prizes(20);
    expect(p).toHaveLength(20);
    expect(p[0]).toBe(4_000_000);
    expect(p[19]).toBe(300_000);
    for (let i = 1; i < 20; i++) expect(p[i]!).toBeLessThanOrEqual(p[i - 1]!);
    expect(rulesFor("finance/3", 38)).toEqual(finance3(38));
    expect(rulesFor("finance/2", 38).prize).toHaveLength(10);
    expect(finance3(38).result.win).toBe(126_000);
  });
});

describe("insolvency/2 rules", () => {
  it("values collateral conservatively, and never past contract expiry or twice", () => {
    expect(collateralValue({ guideFee: 1_000_000, contractUntil: 5, pledged: false }, 4)).toBe(600_000);
    expect(collateralValue({ guideFee: 1_000_000, contractUntil: 3, pledged: false }, 4)).toBe(0);
    expect(collateralValue({ guideFee: 1_000_000, contractUntil: 9, pledged: true }, 4)).toBe(0);
  });

  it("lends at most the loan-to-value and never beyond the debt cap", () => {
    expect(debtCap(8_000_000)).toBe(6_000_000);
    expect(securedCapacity(4_000_000, 0, 8_000_000)).toBe(2_000_000);
    expect(securedCapacity(40_000_000, 5_000_000, 8_000_000)).toBe(1_000_000);
    expect(securedCapacity(40_000_000, 7_000_000, 8_000_000)).toBe(0);
  });

  it("finances an essential shortfall only within the cap and outside administration", () => {
    expect(emergencyFinancing(0, 0, 8_000_000, false)).toBe(0);
    expect(emergencyFinancing(500_000, 1_000_000, 8_000_000, false)).toBe(500_000);
    expect(emergencyFinancing(500_000, 5_800_000, 8_000_000, false)).toBeNull();
    expect(emergencyFinancing(500_000, 0, 8_000_000, true)).toBeNull();
  });

  it("repays senior facilities first and returns the surplus", () => {
    const r = waterfall(1_000_000, [
      loan("a", "secured", 600_000),
      loan("b", "support", 300_000),
      loan("c", "emergency", 200_000),
    ]);
    expect(r.repaid).toEqual([
      { id: "b", amount: 300_000 },
      { id: "c", amount: 200_000 },
      { id: "a", amount: 500_000 },
    ]);
    expect(r.surplus).toBe(0);
    expect(waterfall(100, [loan("x", "secured", 40)]).surplus).toBe(60);
    expect(waterfall(-5, [loan("x", "secured", 40)]).repaid).toEqual([]);
  });

  it("spreads instalments over the rounds left until the loan is due", () => {
    expect(instalment(loan("a", "secured", 3_800, 1), 1, 38, 38)).toBe(100);
    expect(instalment(loan("a", "secured", 7_600, 2), 1, 38, 38)).toBe(100);
    expect(instalment(loan("a", "secured", 50, 1), 3, 1, 38)).toBe(50); // overdue: all of it now
  });

  it("awards a sealed-bid auction to the highest valid bid, ties by club, never below the reserve", () => {
    const reserve = INSOLVENCY_2.auction.reserve * 1_000_000;
    expect(
      auctionWinner(
        [
          { club: "c2", amount: 500_000 },
          { club: "c1", amount: 500_000 },
        ],
        1_000_000,
      ),
    ).toEqual({
      club: "c1",
      amount: 500_000,
    });
    expect(auctionWinner([{ club: "c1", amount: reserve - 1 }], 1_000_000)).toBeNull();
    expect(auctionWinner([], 1_000_000)).toBeNull();
  });

  it("leaves administration only with debt well under the cap and cash in hand", () => {
    expect(canExitAdministration(2_000_000, 1_000_000, 200_000, 8_000_000)).toBe(true);
    expect(canExitAdministration(4_000_000, 1_000_000, 200_000, 8_000_000)).toBe(false);
    expect(canExitAdministration(0, 100_000, 200_000, 8_000_000)).toBe(false);
  });
});

describe("insolvency/2 in the economy harness", () => {
  const run = (scenario: keyof typeof SCENARIOS, seed: number, seasons = 6) =>
    runLeague({ clubs: 20, seasons, seed, ruleset: CANDIDATE, scenario: SCENARIOS[scenario]! });

  it("plays every fixture with viable squads, even when every club starts short of money", () => {
    for (const seed of [1, 2, 3]) {
      const r = run("simultaneous-defaults", seed);
      expect(r.failures).toEqual([]);
      expect(r.events.filter((e) => e.kind === "withdrawal" || e.kind === "takeover")).toEqual([]);
      expect(r.seasons.every((s) => s.withdrawals === 0)).toBe(true);
    }
  });

  it("uses the lender's tools: emergency loans, defaults, compulsory auctions and administration", () => {
    const r = run("simultaneous-defaults", 1, 10);
    const kinds = new Set(r.events.map((e) => e.kind));
    for (const k of ["emergency", "default", "forced_sale", "administration"]) expect(kinds, k).toContain(k);
  });

  it("clubs recover from administration", () => {
    const r = run("simultaneous-defaults", 2, 20);
    expect(r.events.some((e) => e.kind === "recovery")).toBe(true);
  });

  it("regression: forced sales never take a club's last keeper (candidate-lean, seed 3, season 35)", () => {
    const r = runLeague({
      clubs: 20,
      seasons: 40,
      seed: 3,
      ruleset: RULESETS["candidate-lean"]!,
      scenario: SCENARIOS.baseline!,
    });
    expect(r.failures).toEqual([]);
  });

  it("known risk: on lean income with the launch's running costs, a weak club's debt isn't bounded", () => {
    // Recorded in recovery.md. If a change to the lender bounds it, this test should be flipped to
    // expect no failures.
    const r = runLeague({
      clubs: 20,
      seasons: 40,
      seed: 3,
      ruleset: RULESETS["lean-ops11"]!,
      scenario: SCENARIOS.baseline!,
    });
    expect(new Set(r.failures.map((f) => f.invariant))).toEqual(new Set(["bounded-debt"]));
  });

  it("the launch ruleset (finance/3 at Ȼ1.1m running costs) holds every invariant on the same seed", () => {
    const r = runLeague({
      clubs: 20,
      seasons: 40,
      seed: 3,
      ruleset: RULESETS["candidate-t2"]!,
      scenario: SCENARIOS.baseline!,
    });
    expect(r.failures).toEqual([]);
  });

  it("is deterministic for a seed", () => {
    const strip = (x: ReturnType<typeof run>) => JSON.stringify({ ...x, ms: 0 });
    expect(strip(run("extreme-leverage", 4, 4))).toBe(strip(run("extreme-leverage", 4, 4)));
  });
});
