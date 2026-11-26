import { ClubFinancesResponse } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, notFound } from "../http.ts";
import { type TeamRow, toTeam } from "../mappers.ts";
import { clubFinances } from "./read.ts";

/** Club finances (club-finances/1): the fictional treasury, by club. */
export function financeRoutes({ db }: { db: Db }) {
  const r = new Hono();
  r.get("/teams/:team/finances", async (c) => {
    const [t] = await db<TeamRow[]>`select * from teams where slug = ${c.req.param("team")}`;
    if (!t) return notFound(c, "Team");
    return contractJson(c, ClubFinancesResponse, await clubFinances(db, toTeam(t)));
  });
  return r;
}
