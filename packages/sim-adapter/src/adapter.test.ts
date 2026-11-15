import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { MatchResult } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import {
  BASELINE_PARAMS,
  COMPATIBLE_SIM_COMMITS,
  controllerSource,
  isSupportedSimPin,
  MemoryReplayStore,
  renderTacticalController,
  requestHash,
  runMatch,
  SIM_COMMIT,
  SimVersionMismatchError,
  UnsupportedDeploymentError,
} from "./index.ts";
import { resolveTactics } from "./tactics.ts";
import { sampleRequest } from "./testing.ts";

const SHORT = { halfDurationSec: 30 };

describe("sim pin", () => {
  it("SIM_COMMIT matches the vendored autosoccer-sim submodule", () => {
    const root = new URL("../../../vendor/autosoccer-sim", import.meta.url).pathname;
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(head).toBe(SIM_COMMIT);
  });
});

describe("runMatch", () => {
  it("produces a schema-valid result with a verified replay", async () => {
    const store = new MemoryReplayStore();
    const { result } = await runMatch(sampleRequest({ seed: 7, config: SHORT }), { store });
    expect(MatchResult.safeParse(result).success).toBe(true);
    expect(result.replay.verified).toBe(true);
    expect(result.diagnostics.controllerFailures).toEqual([]);
    expect(result.diagnostics.invariantViolations).toEqual([]);
    const replay = JSON.parse(gunzipSync(await store.get(result.replay.uri)).toString());
    expect(replay.format).toBe("autosoccer-replay");
    expect(replay.finalHash).toBe(result.finalHash);
    expect(replay.result.score).toEqual({ blue: result.score.home, red: result.score.away });
  });

  it("is reproducible: same request ⇒ identical result and replay bytes", async () => {
    const req = sampleRequest({ seed: 11, config: SHORT });
    const a = await runMatch(req, { store: new MemoryReplayStore() });
    const b = await runMatch(req, { store: new MemoryReplayStore() });
    const strip = (r: MatchResult) => ({ ...r, diagnostics: { ...r.diagnostics, wallMs: 0 } });
    expect(strip(b.result)).toEqual(strip(a.result));
    expect(b.result.replay.sha256).toBe(a.result.replay.sha256);
  });

  it("different seeds give different matches", async () => {
    const a = await runMatch(sampleRequest({ seed: 1, config: SHORT }), { store: new MemoryReplayStore() });
    const b = await runMatch(sampleRequest({ seed: 2, config: SHORT }), { store: new MemoryReplayStore() });
    expect(a.result.finalHash).not.toBe(b.result.finalHash);
    expect(a.result.requestHash).not.toBe(b.result.requestHash);
  });

  it("maps simulator events onto platform players, consistent with the score", async () => {
    const req = sampleRequest({ seed: 3, config: { halfDurationSec: 60 } });
    const { result } = await runMatch(req, { store: new MemoryReplayStore() });
    const known = new Set([...req.home.starters, ...req.away.starters].map((s) => s.playerId));
    const goals = result.events.filter((e) => e.type === "goal");
    expect(goals.length).toBe(result.score.home + result.score.away);
    for (const g of goals) if (g.scorerId) expect(known.has(g.scorerId)).toBe(true);
    if (goals.length) expect(goals.at(-1)!.score).toEqual(result.score);
    const periods = result.events.filter((e) => e.type === "periodStart").map((e) => e.period);
    expect(periods).toEqual(["firstHalf", "secondHalf"]);
    for (const e of result.events) expect(e.clockSec).toBeLessThanOrEqual(60);
  });

  it("rejects a request pinned to another simulator version", async () => {
    await expect(
      runMatch(sampleRequest({ simVersion: "deadbee" }), { store: new MemoryReplayStore() }),
    ).rejects.toThrow(SimVersionMismatchError);
  });

  it("rejects scripted deployments until an artifact store exists", async () => {
    const req = sampleRequest({ config: SHORT });
    req.away.deployment = { kind: "scripted", sdkVersion: "1.2.0", artifactId: req.away.teamId };
    await expect(runMatch(req, { store: new MemoryReplayStore() })).rejects.toThrow(UnsupportedDeploymentError);
  });
});

describe("7-a-side", () => {
  it("plays seven players a side on the bigger pitch, with platform ids for every player", async () => {
    const store = new MemoryReplayStore();
    const req = sampleRequest({ seed: 11, config: { ...SHORT, playersPerTeam: 7 } });
    const { result } = await runMatch(req, { store });
    expect(MatchResult.safeParse(result).success).toBe(true);
    expect(result.replay.verified).toBe(true);
    expect(result.diagnostics.controllerFailures).toEqual([]);
    expect(result.diagnostics.invariantViolations).toEqual([]);
    const replay = JSON.parse(gunzipSync(await store.get(result.replay.uri)).toString());
    expect(replay.config.playersPerTeam).toBe(7);
    expect(replay.config.pitch).toMatchObject({ length: 60, width: 38, goalWidth: 5 });
    const known = new Set([...req.home.starters, ...req.away.starters].map((s) => s.playerId));
    const named = result.events.flatMap((e) =>
      "takerId" in e ? [e.takerId] : "playerId" in e ? [e.playerId, e.againstId] : [],
    );
    expect(named.length).toBeGreaterThan(0);
    for (const id of named) expect(known.has(id)).toBe(true);
  });

  it("rejects a request whose lineups don't match the team size", () => {
    const five = sampleRequest();
    expect(() => requestHash({ ...five, config: { playersPerTeam: 7 } })).toThrow(/playersPerTeam/);
  });
});

describe("controller rendering", () => {
  it("is deterministic and embeds the params", () => {
    const a = renderTacticalController(BASELINE_PARAMS);
    expect(renderTacticalController({ ...BASELINE_PARAMS })).toBe(a);
    expect(a).toContain(JSON.stringify(BASELINE_PARAMS));
    expect(a).not.toContain("__PARAMS__");
  });

  it("request hash ignores key order", () => {
    const req = sampleRequest();
    const { config, ...rest } = req;
    const shuffled = JSON.parse(JSON.stringify({ config, ...rest }));
    expect(requestHash(shuffled)).toBe(requestHash(req));
  });
});

describe("11-a-side with ball control", () => {
  it("plays eleven a side on the 74×48 m pitch with ball control and controller 3.0", async () => {
    const store = new MemoryReplayStore();
    const req = sampleRequest({ seed: 5, config: { ...SHORT, playersPerTeam: 11, ballControl: true } });
    const { result } = await runMatch(req, { store });
    expect(MatchResult.safeParse(result).success).toBe(true);
    expect(result.replay.verified).toBe(true);
    expect(result.diagnostics.controllerFailures).toEqual([]);
    expect(result.diagnostics.invariantViolations).toEqual([]);
    const replay = JSON.parse(gunzipSync(await store.get(result.replay.uri)).toString());
    expect(replay.config.playersPerTeam).toBe(11);
    expect(replay.config.pitch).toMatchObject({ length: 74, width: 48, goalWidth: 6 });
    expect(replay.config.action.controlChance).toBe(0.85);
    expect(replay.controllers.blue.version).toBe("3.0.0");
    expect(replay.controllers.red.version).toBe("3.0.0");
  });
});

describe("sim pin compatibility", () => {
  const d = { kind: "tactical" as const, schemaVersion: "tactics/1", config: {} };
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");

  it("plays requests pinned to an earlier compatible sim, but only without ball control", () => {
    const old = COMPATIBLE_SIM_COMMITS[0]!;
    expect(isSupportedSimPin({ simVersion: old.slice(0, 7), config: {} })).toBe(true);
    expect(isSupportedSimPin({ simVersion: old, config: { ballControl: false } })).toBe(true);
    expect(isSupportedSimPin({ simVersion: old.slice(0, 7), config: { ballControl: true } })).toBe(false);
    expect(isSupportedSimPin({ simVersion: SIM_COMMIT.slice(0, 7), config: { ballControl: true } })).toBe(true);
    expect(isSupportedSimPin({ simVersion: "deadbee", config: {} })).toBe(false);
  });

  it("gives requests without ball control the byte-identical controller 2.0 they had on the earlier pin", () => {
    // Hashes of the rendered default controllers at sim 0bc52c0 (before ball control).
    expect(hash(controllerSource(d, resolveTactics, 5))).toBe(
      "d83c6bd7dbbe25131e85ddd4ebe9d9d844bc6c6732b045a56c7139784224b4e0",
    );
    expect(hash(controllerSource(d, resolveTactics, 7))).toBe(
      "cd986f843da06bafd6f8c0a69fc8e3a45a56b5ae0c3cc5a285a8407cfc1bd9fb",
    );
    expect(controllerSource(d, resolveTactics, 7, true)).toContain('version: "3.0.0"');
  });

  it("still plays a 7-a-side request pinned to the earlier sim", async () => {
    const req = sampleRequest({
      seed: 4,
      simVersion: COMPATIBLE_SIM_COMMITS[0]!.slice(0, 7),
      config: { ...SHORT, playersPerTeam: 7 },
    });
    const { result } = await runMatch(req, { store: new MemoryReplayStore() });
    expect(result.replay.verified).toBe(true);
  });
});
