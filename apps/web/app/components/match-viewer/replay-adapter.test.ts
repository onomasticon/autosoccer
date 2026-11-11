import { gunzipSync } from "node:zlib";
import { MemoryReplayStore, runMatch } from "@autosoccer/sim-adapter";
import { beforeAll, describe, expect, it } from "vitest";
import { sampleRequest } from "../../../../../packages/sim-adapter/src/testing";
import { formatClock, formatDate } from "../../lib/format";
import { assertSupported, ReplaySource, UnsupportedReplayError } from "./replay-adapter";

let replay: unknown;
let result: Awaited<ReturnType<typeof runMatch>>["result"];
beforeAll(async () => {
  const store = new MemoryReplayStore();
  ({ result } = await runMatch(sampleRequest({ seed: 5, config: { halfDurationSec: 20 } }), { store }));
  replay = JSON.parse(gunzipSync(await store.get(result.replay.uri)).toString());
});

describe("site replay adapter", () => {
  it("plays an official replay to the recorded final score", () => {
    const src = new ReplaySource(replay as never);
    const start = src.frameAt(0);
    expect(start.players).toHaveLength(10);
    expect(start.players.filter((p) => p.side === "home")).toHaveLength(5);
    expect(start.players.filter((p) => p.gk)).toHaveLength(2);
    const end = src.frameAt(src.finalTick);
    expect(end.period).toBe("fullTime");
    expect(end.score).toEqual(result.score);
  });

  it("seeks backwards and forwards deterministically", () => {
    const src = new ReplaySource(replay as never);
    const mid = Math.floor(src.finalTick / 2);
    const a = src.frameAt(mid);
    src.frameAt(src.finalTick);
    const b = src.frameAt(mid);
    expect(b).toEqual(a);
  });

  it("refuses files it doesn't understand", () => {
    expect(() => assertSupported({ format: "something-else" })).toThrow(UnsupportedReplayError);
    expect(() => assertSupported({ ...(replay as object), formatVersion: 2 })).toThrow(/v2 is not supported/);
  });
});

describe("formatting", () => {
  it("shows simulator clocks per half and stable UTC dates", () => {
    expect(formatClock("firstHalf", 0)).toBe("1H 0:00");
    expect(formatClock("secondHalf", 98.4)).toBe("2H 1:38");
    expect(formatDate("2026-11-09T12:05:00.000Z", { weekday: true, time: true })).toBe("Mon 9 Nov, 12:05 UTC");
    expect(formatDate(null)).toBe("");
  });
});
