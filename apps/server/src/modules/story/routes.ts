import { FixtureStory } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, isUuid, notFound } from "../http.ts";
import { fixtureStory } from "./read.ts";

/** Fixture stories: why a fixture matters beforehand and what changed afterwards (fixture-story/1). */
export function storyRoutes({ db }: { db: Db }) {
  const r = new Hono();
  r.get("/fixtures/:id/story", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c, "Fixture");
    const story = await fixtureStory(db, id);
    if (!story) return notFound(c, "Fixture");
    return contractJson(c, FixtureStory, story);
  });
  return r;
}
