import { DEFAULT_TACTICS, Formation, TacticalConfigV1 as Schema, type TacticalConfigV1 } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import {
  BASELINE_PARAMS,
  MemoryReplayStore,
  renderTacticalController,
  resolveTactics,
  runMatch,
  tacticalParams,
} from "./index.ts";
import { sampleRequest } from "./testing.ts";

const dep = (config: Record<string, unknown>) => ({ kind: "tactical" as const, schemaVersion: "tactics/1", config });

function* allConfigs(): Generator<TacticalConfigV1> {
  const shape = Schema.shape;
  const opts = (k: keyof typeof shape) => (shape[k] as unknown as { options: string[] }).options;
  for (const formation of Formation.options)
    for (const lineHeight of opts("lineHeight"))
      for (const width of opts("width"))
        for (const pressing of opts("pressing"))
          for (const tempo of opts("tempo"))
            for (const passingRisk of opts("passingRisk"))
              for (const shooting of opts("shooting"))
                for (const dribbling of opts("dribbling"))
                  for (const keeperDistribution of opts("keeperDistribution"))
                    yield {
                      formation,
                      lineHeight,
                      width,
                      pressing,
                      tempo,
                      passingRisk,
                      shooting,
                      dribbling,
                      keeperDistribution,
                    } as TacticalConfigV1;
}

describe("tactics/1 → controller mapping", () => {
  it("is total and stays on the pitch for every one of the valid configs", () => {
    let n = 0;
    for (const c of allConfigs()) {
      const p = tacticalParams(c);
      for (const s of Object.values(p.slots)) {
        expect(s.depth).toBeGreaterThan(0);
        expect(s.depth).toBeLessThan(50);
        expect(Math.abs(s.lateral)).toBeLessThanOrEqual(15);
      }
      n++;
    }
    expect(n).toBe(5 * 3 ** 7 * 2);
  });

  it("is deterministic: equal configs render byte-identical controllers, different ones differ", () => {
    const a = renderTacticalController(tacticalParams(DEFAULT_TACTICS));
    expect(renderTacticalController(tacticalParams({ ...DEFAULT_TACTICS }))).toBe(a);
    expect(renderTacticalController(tacticalParams({ ...DEFAULT_TACTICS, pressing: "high" }))).not.toBe(a);
  });

  it("maps formations to distinct shapes", () => {
    const depths = (f: TacticalConfigV1["formation"]) =>
      Object.values(tacticalParams({ ...DEFAULT_TACTICS, formation: f }).slots).map((s) => s.depth);
    expect(depths("3-1").filter((d) => d === 9)).toHaveLength(3);
    expect(depths("1-1-2").filter((d) => d === 27)).toHaveLength(2);
  });

  it("the resolver rejects invalid or unknown configs and keeps {} as the Phase-1 baseline", () => {
    expect(resolveTactics(dep({}))).toEqual(BASELINE_PARAMS);
    expect(() => resolveTactics(dep({ ...DEFAULT_TACTICS, formation: "4-4-2" }))).toThrow(/formation/);
    expect(() => resolveTactics(dep({ ...DEFAULT_TACTICS, secretSauce: true }))).toThrow(/invalid/);
    expect(() => resolveTactics({ kind: "tactical", schemaVersion: "tactics/9", config: {} })).toThrow(/unsupported/);
  });
});

describe("contrasting tactics in the simulator", () => {
  const AGGRESSIVE = {
    formation: "1-1-2",
    lineHeight: "high",
    width: "wide",
    pressing: "high",
    tempo: "direct",
    passingRisk: "risky",
    shooting: "early",
    dribbling: "often",
    keeperDistribution: "long",
  };
  const LOW_BLOCK = {
    formation: "3-1",
    lineHeight: "deep",
    width: "narrow",
    pressing: "low",
    tempo: "patient",
    passingRisk: "safe",
    shooting: "selective",
    dribbling: "rarely",
    keeperDistribution: "short",
  };

  it("produce observable, reproducible differences (both venues)", async () => {
    const totals = { aggressive: { pl: 0, comp: 0, drib: 0 }, block: { pl: 0, comp: 0, drib: 0 } };
    for (const seed of [1, 2, 3, 4]) {
      const swap = seed % 2 === 0;
      const req = sampleRequest({ seed, config: { halfDurationSec: 60 } });
      req.home.deployment = dep(swap ? LOW_BLOCK : AGGRESSIVE);
      req.away.deployment = dep(swap ? AGGRESSIVE : LOW_BLOCK);
      const { result } = await runMatch(req, { store: new MemoryReplayStore() });
      const agg = swap ? result.stats.away : result.stats.home;
      const blk = swap ? result.stats.home : result.stats.away;
      // A high line stands far higher up the pitch than a deep block — every match.
      expect(agg.avgTeamHeight - blk.avgTeamHeight).toBeGreaterThan(15);
      totals.aggressive.pl += agg.avgPassLength;
      totals.block.pl += blk.avgPassLength;
      totals.aggressive.comp += agg.passesCompleted;
      totals.block.comp += blk.passesCompleted;
      totals.aggressive.drib += agg.dribbleTouches;
      totals.block.drib += blk.dribbleTouches;
      expect(result.diagnostics.controllerFailures).toEqual([]);
      if (seed === 1) {
        const again = await runMatch(req, { store: new MemoryReplayStore() });
        expect(again.result.finalHash).toBe(result.finalHash);
        expect(again.result.stats).toEqual(result.stats);
      }
    }
    expect(totals.aggressive.pl).toBeGreaterThan(totals.block.pl); // direct = longer passes
    expect(totals.block.comp).toBeGreaterThan(totals.aggressive.comp); // safe/patient = more completed
    expect(totals.aggressive.drib).toBeGreaterThan(totals.block.drib); // "often" dribbles more
  }, 60_000);
});
