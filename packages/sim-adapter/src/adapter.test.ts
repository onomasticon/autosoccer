import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { MatchResult } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import {
  BASELINE_PARAMS,
  MemoryReplayStore,
  renderTacticalController,
  requestHash,
  runMatch,
  SIM_COMMIT,
  SimVersionMismatchError,
  UnsupportedDeploymentError,
} from "./index.ts";
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
