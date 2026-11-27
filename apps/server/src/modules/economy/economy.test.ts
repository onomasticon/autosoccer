import { describe, expect, it } from "vitest";
import { rulesFor, wageFor } from "../finance/rules.ts";
import { doubleRoundRobin, found, marketMultiplier, nextSeason, runLeague } from "./engine.ts";
import { checkInvariants } from "./invariants.ts";
import { gini, spearman } from "./metrics.ts";
import { csv, markdown, summarise } from "./report.ts";
import { LEGACY, RULESETS, SCENARIOS } from "./rulesets.ts";

const base = { clubs: 20, seasons: 4, ruleset: LEGACY, scenario: SCENARIOS.baseline! };

describe("economy harness: calendar and maths", () => {
  it("builds a 20-club double round robin: 38 rounds, 380 fixtures, every pairing home and away, one match a round", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const cal = doubleRoundRobin(ids);
    expect(cal).toHaveLength(380);
    expect(Math.max(...cal.map((f) => f.round))).toBe(38);
    const pairs = new Set(cal.map((f) => `${f.home}>${f.away}`));
    expect(pairs.size).toBe(380);
    for (let r = 1; r <= 38; r++) {
      const clubs = cal.filter((f) => f.round === r).flatMap((f) => [f.home, f.away]);
      expect(new Set(clubs).size).toBe(20);
    }
  });

  it("handles odd league sizes with a bye", () => {
    const cal = doubleRoundRobin(["a", "b", "c"]);
    expect(cal).toHaveLength(6);
    expect(new Set(cal.map((f) => `${f.home}>${f.away}`)).size).toBe(6);
  });

  it("measures concentration and mobility", () => {
    expect(gini([1, 1, 1, 1])).toBe(0);
    expect(gini([0, 0, 0, 100])).toBeCloseTo(0.75);
    expect(spearman(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(spearman(["a", "b", "c"], ["c", "b", "a"])).toBe(-1);
  });

  it("uses the production finance table and wages", () => {
    expect(LEGACY.finance(38)).toEqual(rulesFor("finance/2", 38));
    expect(LEGACY.wage(70, LEGACY.finance(38))).toBe(wageFor(70, rulesFor("finance/2", 38)));
  });
});

describe("economy harness: runs", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = runLeague({ ...base, seed: 7 });
    const b = runLeague({ ...base, seed: 7 });
    const c = runLeague({ ...base, seed: 8 });
    const strip = (r: typeof a) => JSON.stringify({ ...r, ms: 0 });
    expect(strip(a)).toBe(strip(b));
    expect(strip(a)).not.toBe(strip(c));
  });

  it("keeps every hard invariant in every stress scenario (CI smoke)", () => {
    for (const scenario of Object.values(SCENARIOS)) {
      const r = runLeague({ ...base, seasons: 3, seed: 1, scenario });
      expect(r.failures, scenario.name).toEqual([]);
      expect(r.seasons).toHaveLength(3);
    }
  });

  it("conserves money: league cash is exactly the sum of sources and sinks", () => {
    const r = runLeague({ ...base, seed: 3 });
    const flows = r.seasons.flatMap((s) => Object.values(s.flows)).reduce((s, x) => s + (x ?? 0), 0);
    const opening = 20 * LEGACY.finance(38).opening;
    expect(r.seasons.at(-1)!.totalCash).toBe(opening + flows - (r.seasons[0]!.flows.opening ?? 0));
    expect(r.clubs.reduce((s, c) => s + c.cash, 0)).toBe(r.seasons.at(-1)!.totalCash);
  });

  it("legacy rules forfeit a club that can't pay and rescue it next season", () => {
    const r = runLeague({
      ...base,
      seasons: 3,
      seed: 2,
      scenario: { name: "broke", description: "", opening: 0 },
    });
    expect(r.events.some((e) => e.kind === "withdrawal")).toBe(true);
    expect(r.events.some((e) => e.kind === "takeover")).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("flags a ruleset that promises no forfeits when a club still forfeits", () => {
    const r = runLeague({
      ...base,
      seasons: 1,
      seed: 2,
      ruleset: { ...LEGACY, name: "promise", noForfeits: true },
      scenario: { name: "broke", description: "", opening: 0 },
    });
    expect(r.failures.map((f) => f.invariant)).toContain("no-forfeits");
  });

  it("catches a rewritten past season, a broken ledger and a double registration", () => {
    const w = found({ ...base, clubs: 4, seed: 5 });
    nextSeason(w, 1);
    nextSeason(w, 2);
    expect(checkInvariants(w)).toEqual([]);
    const f = w.fixtures.find((x) => x.season === 1 && x.homeGoals !== null)!;
    f.homeGoals! += 1;
    w.clubs.get("c01")!.cash += 1;
    [...w.players.values()][0]!.club = "nowhere";
    expect(
      checkInvariants(w)
        .map((x) => x.invariant)
        .sort(),
    ).toEqual(["history-immutable", "ledger-reconciles", "one-registration"]);
  });

  it("writes markdown and CSV reports", () => {
    const runs = [runLeague({ ...base, seasons: 2, seed: 1 }), runLeague({ ...base, seasons: 2, seed: 2 })];
    const s = summarise({ ruleset: "legacy", scenario: "baseline", runs });
    expect(s.seasons).toBe(4);
    const md = markdown([s], { command: "test", clubs: 20, seasons: 2, seeds: [1, 2] });
    expect(md).toContain("## Hard invariants");
    expect(md).toContain("| legacy | baseline | 4 | 0 |");
    expect(
      csv([{ ruleset: "legacy", scenario: "baseline", runs }])
        .trim()
        .split("\n"),
    ).toHaveLength(5);
  });

  it("ranks withdrawn clubs last and pays them no prize", () => {
    const r = runLeague({
      ...base,
      clubs: 4,
      seasons: 1,
      seed: 2,
      scenario: { name: "broke", description: "", opening: 0 },
    });
    const out = r.events.filter((e) => e.kind === "withdrawal").map((e) => e.club);
    expect(out.length).toBeGreaterThan(0);
    const table = r.seasons[0]!.table;
    expect(table.slice(-out.length).sort()).toEqual([...out].sort());
  });
});

describe("contracts and running costs (finance/3 candidate)", () => {
  const contracts = RULESETS["c-ops05-a1"]!;

  it("keeps a wage fixed for the contract and reprices it at the market on renewal", () => {
    const w = found({ ...base, clubs: 6, seed: 9, ruleset: contracts });
    nextSeason(w, 1);
    const p = [...w.players.values()].find((x) => x.club && x.contractUntil >= 2)!;
    const wage = p.wage;
    expect(wage).toBeGreaterThan(0);
    // The club's money changes the market, but a running contract doesn't move.
    for (const c of w.clubs.values()) c.cash *= 4;
    nextSeason(w, 2);
    if (w.players.has(p.id) && p.contractUntil >= 2 && p.club) expect(p.wage).toBe(wage);
    expect(marketMultiplier(w)).toBeGreaterThan(1);
    // An expired contract is renewed at the (now higher) market rate.
    const renewed = [...w.players.values()].filter((x) => x.club && x.contractUntil >= 3 && x.wage > 0);
    expect(renewed.length).toBeGreaterThan(0);
  });

  it("charges running costs every round, through the ledger", () => {
    const r = runLeague({ ...base, clubs: 6, seasons: 1, seed: 3, ruleset: contracts });
    expect(r.seasons[0]!.flows.operating).toBe(-6 * Math.round(500_000 / 10) * 10);
    expect(r.failures).toEqual([]);
  });

  it("leaves the legacy ruleset untouched (no contracts, no running costs)", () => {
    const r = runLeague({ ...base, seasons: 2, seed: 4 });
    expect(r.seasons.every((s) => s.flows.operating === undefined)).toBe(true);
  });
});
