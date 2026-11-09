import { buildOpenApi, CONTRACTS_VERSION } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import type { ReplayStore } from "@autosoccer/sim-adapter";
import { Hono } from "hono";
import { type Logger, silentLogger } from "./log.ts";
import { agentRoutes } from "./modules/agents/routes.ts";
import { editorialRoutes } from "./modules/editorial/routes.ts";
import { leagueRoutes } from "./modules/league/routes.ts";
import { ledgerRoutes } from "./modules/ledger/routes.ts";
import { matchRoutes } from "./modules/matches/routes.ts";
import { opsRoutes } from "./modules/ops/routes.ts";
import { tacticsRoutes } from "./modules/tactics/routes.ts";

export const API_VERSION = "v1";

export interface AppDeps {
  db: Db;
  store: ReplayStore;
  log?: Logger;
  /** Bearer token for /api/v1/ops/*; unset = open (local development). */
  opsToken?: string;
}

/** The HTTP API (modular monolith). Feature modules mount their routes under /api/v1. */
export function createApp({ db, store, log = silentLogger, opsToken }: AppDeps) {
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
  api.route("/", leagueRoutes({ db }));
  api.route("/", matchRoutes({ db, store }));
  api.route("/", tacticsRoutes({ db }));
  api.route("/", agentRoutes({ db }));
  api.route("/", ledgerRoutes({ db }));
  api.route("/", editorialRoutes({ db }));
  api.route("/", opsRoutes({ db, token: opsToken }));
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
