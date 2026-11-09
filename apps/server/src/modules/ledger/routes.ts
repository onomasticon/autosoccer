import { BudgetResponse } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, notFound } from "../http.ts";
import { seasonBySlug } from "../league/read.ts";
import { budgetSummary } from "./service.ts";

export function ledgerRoutes({ db }: { db: Db }) {
  const r = new Hono();
  r.get("/seasons/:season/budget", async (c) => {
    const s = await seasonBySlug(db, c.req.param("season"));
    if (!s) return notFound(c, "Season");
    return contractJson(c, BudgetResponse, { seasonId: s.id, rows: await budgetSummary(db, s.id) });
  });
  return r;
}
