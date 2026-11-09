import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { opsStatus } from "./status.ts";

/** Operator endpoints. When OPS_TOKEN is set, requests need `Authorization: Bearer <token>`. */
export function opsRoutes({ db, token }: { db: Db; token?: string }) {
  const r = new Hono();
  r.use("/ops/*", async (c, next) => {
    if (token && c.req.header("authorization") !== `Bearer ${token}`) {
      return c.json({ error: { code: "unauthorized", message: "ops token required" } }, 401);
    }
    await next();
  });
  r.get("/ops/status", async (c) => {
    const s = await opsStatus(db);
    return c.json(s, s.healthy ? 200 : 503);
  });
  return r;
}
