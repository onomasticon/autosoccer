import { TransferWindowResponse } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson } from "../http.ts";
import { transferWindow } from "./read.ts";

/** The transfer window (transfer-window/1): the latest, or the one before ?season=. */
export function transferRoutes({ db }: { db: Db }) {
  const r = new Hono();
  r.get("/transfers", async (c) =>
    contractJson(c, TransferWindowResponse, await transferWindow(db, c.req.query("season") || undefined)),
  );
  return r;
}
