import {
  FixturesResponse,
  SeasonListResponse,
  SeasonResponse,
  StandingsResponse,
  TeamDetailResponse,
  TeamListResponse,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, notFound } from "../http.ts";
import { type PlayerRow, type RevisionRow, type TeamRow, toPlayer, toTeam } from "../mappers.ts";
import {
  currentSeason,
  fixtureViews,
  seasonBySlug,
  seasonSummaries,
  seasonTeams,
  standingRows,
  toSeason,
} from "./read.ts";

export function leagueRoutes({ db }: { db: Db }) {
  const r = new Hono();

  r.get("/seasons", async (c) => contractJson(c, SeasonListResponse, { items: await seasonSummaries(db) }));

  r.get("/seasons/current", async (c) => {
    const s = await currentSeason(db);
    if (!s) return notFound(c, "Season");
    const teams = [...(await seasonTeams(db, s.id)).values()];
    const [rounds] = await db<
      { n: number }[]
    >`select coalesce(max(round), 0)::int as n from fixtures where season_id = ${s.id}`;
    return contractJson(c, SeasonResponse, { season: toSeason(s), teams, rounds: rounds!.n });
  });

  r.get("/seasons/:season/standings", async (c) => {
    const s = await seasonBySlug(db, c.req.param("season"));
    if (!s) return notFound(c, "Season");
    const { rows, afterRound } = await standingRows(db, s.id);
    return contractJson(c, StandingsResponse, { season: toSeason(s), afterRound, rows });
  });

  r.get("/seasons/:season/fixtures", async (c) => {
    const s = await seasonBySlug(db, c.req.param("season"));
    if (!s) return notFound(c, "Season");
    const all = await fixtureViews(db, s.id);
    const rounds = [...new Set(all.map((f) => f.round))].map((round) => ({
      round,
      fixtures: all.filter((f) => f.round === round),
    }));
    return contractJson(c, FixturesResponse, { season: toSeason(s), rounds });
  });

  r.get("/teams", async (c) => {
    const rows = await db<TeamRow[]>`select * from teams order by name`;
    return contractJson(c, TeamListResponse, { items: rows.map(toTeam) });
  });

  r.get("/teams/:team", async (c) => {
    const [t] = await db<TeamRow[]>`select * from teams where slug = ${c.req.param("team")}`;
    if (!t) return notFound(c, "Team");
    const players = (await db<PlayerRow[]>`select * from players where team_id = ${t.id} order by shirt_number`).map(
      toPlayer,
    );
    const [mgr] = await db<
      {
        id: string;
        slug: string;
        name: string;
        persona: string;
        philosophy: string;
        model: string;
        memory: { summary: string; notes: string[]; updatedAt: string | null };
      }[]
    >`
      select id, slug, name, persona, philosophy, model, memory from manager_agents where team_id = ${t.id}`;
    const season = await currentSeason(db);
    let standing = null;
    let fixtures: Awaited<ReturnType<typeof fixtureViews>> = [];
    let currentRevision = null;
    if (season) {
      standing = (await standingRows(db, season.id)).rows.find((row) => row.team.id === t.id) ?? null;
      fixtures = await fixtureViews(db, season.id, t.id);
      const [rev] = await db<RevisionRow[]>`
        select * from tactical_revisions where team_id = ${t.id} and season_id = ${season.id} and status = 'valid'
        order by version desc limit 1`;
      if (rev)
        currentRevision = {
          id: rev.id,
          version: rev.version,
          deployment: rev.deployment,
          rationale: rev.rationale,
          createdAt: rev.created_at.toISOString(),
        };
    }
    return contractJson(c, TeamDetailResponse, {
      team: toTeam(t),
      players,
      manager: mgr ?? null,
      standing,
      fixtures,
      currentRevision,
    });
  });

  return r;
}
