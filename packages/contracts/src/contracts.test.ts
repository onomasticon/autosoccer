import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exampleMatchRequest, exampleMatchResult } from "./examples.ts";
import { EXAMPLES, renderGenerated } from "./generate.ts";
import {
  ControllerDeployment,
  Lineup,
  MatchRequest,
  MatchResult,
  OfficialEvent,
  ROUTES,
  TacticalRevision,
} from "./index.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describe("contract examples", () => {
  for (const e of EXAMPLES) {
    it(`${e.name} example satisfies its schema`, () => {
      const r = e.schema.safeParse(e.value);
      expect(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2)).toBe(true);
    });
  }

  it("docs/api is up to date (run `bun run contracts:gen`)", () => {
    const root = new URL("../../../docs/api/", import.meta.url).pathname;
    for (const [path, body] of Object.entries(renderGenerated())) {
      expect(readFileSync(root + path, "utf8"), path).toBe(body);
    }
  });
});

describe("controller deployment union", () => {
  it("accepts tactical and scripted deployments", () => {
    expect(ControllerDeployment.parse({ kind: "tactical", schemaVersion: "tactics/1", config: {} }).kind).toBe(
      "tactical",
    );
    expect(ControllerDeployment.parse({ kind: "scripted", sdkVersion: "1.2.0", artifactId: uuid(1) }).kind).toBe(
      "scripted",
    );
  });
  it("rejects unknown kinds and malformed versions", () => {
    expect(ControllerDeployment.safeParse({ kind: "llm-live", config: {} }).success).toBe(false);
    expect(ControllerDeployment.safeParse({ kind: "tactical", schemaVersion: "v1", config: {} }).success).toBe(false);
    expect(
      ControllerDeployment.safeParse({ kind: "scripted", sdkVersion: "latest", artifactId: uuid(1) }).success,
    ).toBe(false);
  });
});

describe("lineup", () => {
  it("requires exactly five unique starters", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7].map(uuid);
    expect(Lineup.safeParse({ starters: ids.slice(0, 5), reserves: ids.slice(5) }).success).toBe(true);
    expect(Lineup.safeParse({ starters: ids.slice(0, 4), reserves: [] }).success).toBe(false);
    expect(Lineup.safeParse({ starters: ids.slice(0, 5), reserves: [ids[0]] }).success).toBe(false);
  });
});

describe("match contracts", () => {
  it("MatchRequest pins the contract version and needs five starters per side", () => {
    expect(MatchRequest.safeParse({ ...exampleMatchRequest, contract: "match-request/2" }).success).toBe(false);
    const short = {
      ...exampleMatchRequest,
      home: { ...exampleMatchRequest.home, starters: exampleMatchRequest.home.starters.slice(0, 4) },
    };
    expect(MatchRequest.safeParse(short).success).toBe(false);
  });
  it("MatchResult requires replay provenance and versions", () => {
    const { replay: _r, ...noReplay } = exampleMatchResult;
    expect(MatchResult.safeParse(noReplay).success).toBe(false);
    expect(MatchResult.safeParse({ ...exampleMatchResult, requestHash: "abc" }).success).toBe(false);
  });
  it("OfficialEvent is a closed union", () => {
    expect(
      OfficialEvent.safeParse({ type: "quote", tick: 1, period: "firstHalf", clockSec: 0, text: "…" }).success,
    ).toBe(false);
  });
  it("a rejected revision status is representable for audit", () => {
    const r = TacticalRevision.shape.status.safeParse("rejected");
    expect(r.success).toBe(true);
  });
});

describe("routes", () => {
  it("have unique operation ids and versioned-relative paths", () => {
    const ids = ROUTES.map((r) => r.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ROUTES) expect(r.path.startsWith("/")).toBe(true);
  });
});
