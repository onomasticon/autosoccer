import {
  FixturesResponse,
  RecordsResponse,
  ScorersResponse,
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
  leagueRecords,
  scorers,
  seasonBySlug,
  seasonRace,
  seasonSummaries,
  seasonTeams,
  standingRows,
  toSeason,
} from "./read.ts";

export function leagueRoutes({ db }: { db: Db }) {
  const r = new Hono();

  r.get("/seasons", async (c) => contractJson(c, SeasonListResponse, { items: await seasonSummaries(db) }));

  r.get("/records", async (c) => contractJson(c, RecordsResponse, await leagueRecords(db)));

  r.get("/scorers", async (c) =>
    contractJson(c, ScorersResponse, { season: null, items: await scorers(db, null, 10) }),
  );

  r.get("/seasons/:season/scorers", async (c) => {
    const s = await seasonBySlug(db, c.req.param("season"));
    if (!s) return notFound(c, "Season");
    return contractJson(c, ScorersResponse, { season: toSeason(s), items: await scorers(db, s.id, 10) });
  });

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
    const race = await seasonRace(db, s.id, rows, afterRound);
    return contractJson(c, StandingsResponse, { season: toSeason(s), afterRound, rows, race });
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
    // Club history: final position in each completed season.
    const done = await db<{ id: string; slug: string; name: string }[]>`
      select s.id, s.slug, s.name from seasons s join season_teams st on st.season_id = s.id
      where st.team_id = ${t.id} and s.status = 'completed' order by s.starts_at desc nulls last, s.created_at desc`;
    const history = [];
    for (const s of done) {
      const row = (await standingRows(db, s.id)).rows.find((x) => x.team.id === t.id);
      if (row)
        history.push({
          season: { slug: s.slug, name: s.name },
          position: row.position,
          points: row.points,
          played: row.played,
          champion: row.position === 1,
        });
    }
    // Goals per player (own goals excluded): this season and all time.
    const goalRows = await db<{ player_id: string; season_id: string; n: number }[]>`
      select (g->>'scorerId')::uuid as player_id, f.season_id, count(*)::int as n
      from matches m join fixtures f on f.id = m.fixture_id cross join lateral jsonb_array_elements(m.events) g
      join players p on p.id = (g->>'scorerId')::uuid
      where m.status = 'completed' and p.team_id = ${t.id} and g->>'type' = 'goal'
        and coalesce((g->>'ownGoal')::boolean, false) = false
      group by 1, 2`;
    const goals = players.map((p) => ({
      playerId: p.id,
      season: goalRows.filter((g) => g.player_id === p.id && g.season_id === season?.id).reduce((a, g) => a + g.n, 0),
      allTime: goalRows.filter((g) => g.player_id === p.id).reduce((a, g) => a + g.n, 0),
    }));
    const [written] = mgr
      ? await db<{ name: string; round: number }[]>`
          select s.name, f.round from agent_runs r join fixtures f on f.id = r.fixture_id join seasons s on s.id = f.season_id
          where r.agent_id = ${mgr.id} and r.purpose = 'post_match' and r.status = 'succeeded'
          order by r.finished_at desc nulls last limit 1`
      : [];
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
      history,
      goals,
      memoryWrittenAfter: written ? { season: written.name, round: written.round } : null,
    });
  });

  return r;
}
