import { createDb } from "@autosoccer/db";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe("api", () => {
  it("reports healthy when the database is reachable", async () => {
    const res = await createApp({ db: t.db }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok", apiVersion: "v1" });
  });

  it("reports degraded (503) when the database is down", async () => {
    const dead = createDb("postgres://nobody:nothing@127.0.0.1:1/none", { max: 1 });
    const res = await createApp({ db: dead }).request("/health");
    expect(res.status).toBe(503);
    expect((await res.json()).db).toBe("unreachable");
    await dead.end();
  });

  it("serves versioned meta with the applied schema version", async () => {
    const res = await createApp({ db: t.db }).request("/api/v1/meta");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiVersion).toBe("v1");
    expect(body.schemaVersion).toBeGreaterThanOrEqual(2);
    expect(body.contractsVersion).toBe("1.0.0");
  });

  it("publishes the OpenAPI document for the v1 contracts", async () => {
    const res = await createApp({ db: t.db }).request("/api/v1/openapi.json");
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/seasons/{season}/standings"].get.operationId).toBe("getStandings");
    expect(doc.components.schemas.MatchDetailResponse).toBeDefined();
  });

  it("returns a JSON 404 envelope for unknown routes", async () => {
    const res = await createApp({ db: t.db }).request("/api/v1/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

describe("config", () => {
  it("applies defaults and validates the environment", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://a:b@h:1/d" })).toMatchObject({ API_PORT: 4000, LOG_LEVEL: "info" });
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
