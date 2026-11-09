import { RevisionHistoryResponse } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, notFound } from "../http.ts";
import { currentSeason } from "../league/read.ts";
import { type TeamRow, toTeam } from "../mappers.ts";
import { revisionHistory } from "./service.ts";

export function tacticsRoutes({ db }: { db: Db }) {
  const r = new Hono();
  r.get("/teams/:team/revisions", async (c) => {
    const [t] = await db<TeamRow[]>`select * from teams where slug = ${c.req.param("team")}`;
    const season = await currentSeason(db);
    if (!t || !season) return notFound(c, "Team");
    return contractJson(c, RevisionHistoryResponse, {
      team: toTeam(t),
      seasonId: season.id,
      items: await revisionHistory(db, t.id, season.id),
    });
  });
  return r;
}
