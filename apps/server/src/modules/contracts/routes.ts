import { SeasonMarketResponse } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, notFound } from "../http.ts";
import { seasonMarket } from "./read.ts";

/** A season's player market (market/1). Seasons of a draft league aren't public yet. */
export function marketRoutes({ db }: { db: Db }) {
  const r = new Hono();
  r.get("/seasons/:season/market", async (c) => {
    const [s] = await db<{ id: string; league: string | null }[]>`
      select s.id, l.status as league from seasons s left join leagues l on l.id = s.league_id
      where s.slug = ${c.req.param("season")} and s.status <> 'draft'`;
    if (!s || s.league === "draft") return notFound(c, "Season");
    const m = await seasonMarket(db, s.id);
    if (!m) return notFound(c, "Season");
    return contractJson(c, SeasonMarketResponse, m);
  });
  return r;
}
