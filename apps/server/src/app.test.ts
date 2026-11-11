import { createDb } from "@autosoccer/db";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

const store = new MemoryReplayStore();

import { FileReplayStore, R2ReplayStore } from "@autosoccer/sim-adapter";
import { loadConfig, replayStore } from "./config.ts";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe("api", () => {
  it("reports healthy when the database is reachable", async () => {
    const res = await createApp({ db: t.db, store }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok", apiVersion: "v1" });
  });

  it("reports degraded (503) when the database is down", async () => {
    const dead = createDb("postgres://nobody:nothing@127.0.0.1:1/none", { max: 1 });
    const res = await createApp({ db: dead, store }).request("/health");
    expect(res.status).toBe(503);
    expect((await res.json()).db).toBe("unreachable");
    await dead.end();
  });

  it("serves versioned meta with the applied schema version", async () => {
    const res = await createApp({ db: t.db, store }).request("/api/v1/meta");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiVersion).toBe("v1");
    expect(body.schemaVersion).toBeGreaterThanOrEqual(2);
    expect(body.contractsVersion).toBe("1.0.0");
  });

  it("publishes the OpenAPI document for the v1 contracts", async () => {
    const res = await createApp({ db: t.db, store }).request("/api/v1/openapi.json");
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/seasons/{season}/standings"].get.operationId).toBe("getStandings");
    expect(doc.components.schemas.MatchDetailResponse).toBeDefined();
  });

  it("returns a JSON 404 envelope for unknown routes", async () => {
    const res = await createApp({ db: t.db, store }).request("/api/v1/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

describe("config", () => {
  it("applies defaults and validates the environment", () => {
    const cfg = loadConfig({ DATABASE_URL: "postgres://a:b@h:1/d" });
    expect(cfg).toMatchObject({ API_PORT: 4000, LOG_LEVEL: "info" });
    expect(cfg.REPLAY_DIR.endsWith("/data/replays")).toBe(true);
    expect(cfg.REPLAY_DIR.startsWith("/")).toBe(true);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
  it("selects the replay store and requires R2 settings when REPLAY_STORE=r2", () => {
    const base = { DATABASE_URL: "postgres://a:b@h:1/d" };
    expect(replayStore(loadConfig(base))).toBeInstanceOf(FileReplayStore);
    expect(() => loadConfig({ ...base, REPLAY_STORE: "r2", R2_BUCKET: "replays" })).toThrow(
      /R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
    );
    const r2 = replayStore(
      loadConfig({
        ...base,
        REPLAY_STORE: "r2",
        R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
        R2_BUCKET: "replays",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
      }),
    );
    expect(r2).toBeInstanceOf(R2ReplayStore);
    expect((r2 as R2ReplayStore).bucket).toBe("replays");
  });
  it("reads pool sizes and resolves the database CA path from the repo root", () => {
    const cfg = loadConfig({
      DATABASE_URL: "postgres://a:b@h:1/d?sslmode=verify-full",
      API_DB_POOL_MAX: "4",
      WORKER_DB_POOL_MAX: "3",
      DATABASE_CA_CERT_FILE: "certs/do-ca.crt",
    });
    expect(cfg).toMatchObject({ API_DB_POOL_MAX: 4, WORKER_DB_POOL_MAX: 3 });
    expect(cfg.DATABASE_CA_CERT_FILE!.endsWith("/certs/do-ca.crt")).toBe(true);
    expect(() => loadConfig({ DATABASE_URL: "postgres://a:b@h:1/d", WORKER_DB_POOL_MAX: "1" })).toThrow(
      /WORKER_DB_POOL_MAX/,
    );
  });
});
