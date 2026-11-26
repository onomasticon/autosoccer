import { PlayerListResponse, PlayerProfileResponse, SpotlightResponse } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, isUuid, notFound } from "../http.ts";
import { playerList, playerProfile, spotlight } from "./read.ts";

/** Homepage spotlight (spotlight/1), player profiles (player-profile/1) and the player list. */
export function spotlightRoutes({ db }: { db: Db }) {
  const r = new Hono();
  r.get("/spotlight", async (c) => contractJson(c, SpotlightResponse, await spotlight(db)));
  r.get("/players", async (c) => contractJson(c, PlayerListResponse, { items: await playerList(db) }));
  r.get("/players/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c, "Player");
    const profile = await playerProfile(db, id);
    if (!profile) return notFound(c, "Player");
    return contractJson(c, PlayerProfileResponse, profile);
  });
  return r;
}
