import { buildOpenApi, CONTRACTS_VERSION } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { type Logger, silentLogger } from "./log.ts";

export const API_VERSION = "v1";

export interface AppDeps {
  db: Db;
  log?: Logger;
}

/** The HTTP API (modular monolith). Feature modules mount their routes under /api/v1. */
export function createApp({ db, log = silentLogger }: AppDeps) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - t0),
    });
  });

  app.get("/health", async (c) => {
    try {
      await db`select 1`;
      return c.json({ status: "ok", db: "ok", apiVersion: API_VERSION });
    } catch (e) {
      log.error("health check failed", { error: (e as Error).message });
      return c.json({ status: "degraded", db: "unreachable", apiVersion: API_VERSION }, 503);
    }
  });

  const api = new Hono();
  api.get("/meta", async (c) => {
    const [row] = await db<{ version: number }[]>`select max(version)::int as version from schema_migrations`;
    return c.json({ apiVersion: API_VERSION, contractsVersion: CONTRACTS_VERSION, schemaVersion: row?.version ?? 0 });
  });
  const openapi = buildOpenApi();
  api.get("/openapi.json", (c) => c.json(openapi));
  app.route(`/api/${API_VERSION}`, api);

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } }, 404),
  );
  app.onError((err, c) => {
    log.error("unhandled error", { error: err.message, stack: err.stack });
    return c.json({ error: { code: "internal", message: "Internal server error" } }, 500);
  });

  return app;
}
