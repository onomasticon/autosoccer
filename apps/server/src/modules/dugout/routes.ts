import { DUGOUT_CONTRACT, DugoutResponse, ManagerProfile, TeamDugoutResponse } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, notFound } from "../http.ts";
import { currentSeason, seasonBySlug } from "../league/read.ts";
import { type TeamRow, toTeam } from "../mappers.ts";
import { managerProfile } from "./profile.ts";
import { seasonDugout, teamDugout } from "./read.ts";

export function dugoutRoutes({ db }: { db: Db }) {
  const r = new Hono();
  r.get("/seasons/:season/dugout", async (c) => {
    const s = await seasonBySlug(db, c.req.param("season"));
    if (!s) return notFound(c, "Season");
    return contractJson(c, DugoutResponse, { contract: DUGOUT_CONTRACT, ...(await seasonDugout(db, s)) });
  });
  r.get("/teams/:team/dugout", async (c) => {
    const [t] = await db<TeamRow[]>`select * from teams where slug = ${c.req.param("team")}`;
    const s = await currentSeason(db);
    if (!t || !s) return notFound(c, "Team");
    return contractJson(c, TeamDugoutResponse, {
      contract: DUGOUT_CONTRACT,
      seasonId: s.id,
      story: await teamDugout(db, s, toTeam(t)),
    });
  });
  r.get("/teams/:team/manager-profile", async (c) => {
    const [t] = await db<TeamRow[]>`select * from teams where slug = ${c.req.param("team")}`;
    if (!t) return notFound(c, "Team");
    const slug = c.req.query("season");
    const s = slug ? await seasonBySlug(db, slug) : undefined;
    if (slug && !s) return notFound(c, "Season");
    return contractJson(c, ManagerProfile, await managerProfile(db, toTeam(t), s ?? undefined));
  });
  return r;
}
