import {
  MatchDetailResponse,
  type OfficialEvent,
  type PlayerAttributes,
  type TeamMatchStats,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import type { ReplayStore } from "@autosoccer/sim-adapter";
import { Hono } from "hono";
import { contractJson, isUuid, notFound } from "../http.ts";
import { teamsAsOf } from "../insolvency/takeover.ts";
import { ratedPlayer, seasonRatings } from "../league/careers.ts";
import {
  type FixtureRow,
  type MatchRow,
  type PlayerRow,
  type ReplayRow,
  type RevisionRow,
  type TeamRow,
  toFixtureView,
  toMatch,
  toReplay,
  toTeam,
} from "../mappers.ts";

export function matchRoutes({ db, store }: { db: Db; store: ReplayStore }) {
  const r = new Hono();

  r.get("/matches/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c, "Match");
    const [m] = await db<MatchRow[]>`select * from matches where id = ${id}`;
    if (!m) return notFound(c, "Match");
    const [f] = await db<FixtureRow[]>`select *, ${m.id}::uuid as match_id, ${m.home_score}::int as home_score,
      ${m.away_score}::int as away_score from fixtures where id = ${m.fixture_id}`;
    // The clubs as they were known that season (before any later takeover and rename).
    const teams = await teamsAsOf(db, f!.season_id);
    const request = m.request as {
      home: { starters: { playerId: string; attributes?: PlayerAttributes }[] };
      away: { starters: { playerId: string; attributes?: PlayerAttributes }[] };
    };
    const starterIds = [...request.home.starters, ...request.away.starters].map((s) => s.playerId);
    // The ratings this match was played with: its frozen request's, else its season's snapshot.
    const snapshot = await seasonRatings(db, f!.season_id);
    const frozen = new Map(
      [...request.home.starters, ...request.away.starters]
        .filter((s): s is typeof s & { attributes: PlayerAttributes } => "attributes" in s && !!s.attributes)
        .map((s) => [s.playerId, s.attributes]),
    );
    const players = new Map(
      (await db<PlayerRow[]>`select * from players where id = any(${starterIds}::uuid[])`).map((p) => [
        p.id,
        ratedPlayer(p, frozen.size ? frozen : snapshot),
      ]),
    );
    const [replay] = await db<ReplayRow[]>`select * from replay_artifacts where match_id = ${m.id}`;
    const revIds = [m.home_revision_id, m.away_revision_id].filter((x): x is string => !!x);
    const revs = new Map(
      (revIds.length
        ? await db<RevisionRow[]>`select * from tactical_revisions where id = any(${revIds}::uuid[])`
        : []
      ).map((x) => [x.id, { id: x.id, version: x.version, deployment: x.deployment, rationale: x.rationale }]),
    );
    return contractJson(c, MatchDetailResponse, {
      match: toMatch(m),
      fixture: toFixtureView(f!, teams),
      events: m.status === "completed" ? (m.events as OfficialEvent[]) : [],
      stats: m.status === "completed" ? (m.stats as { home: TeamMatchStats; away: TeamMatchStats }) : null,
      lineups: {
        home: request.home.starters.map((s) => players.get(s.playerId)!).filter(Boolean),
        away: request.away.starters.map((s) => players.get(s.playerId)!).filter(Boolean),
      },
      replay: replay ? toReplay(replay) : null,
      revisions: {
        home: (m.home_revision_id && revs.get(m.home_revision_id)) || null,
        away: (m.away_revision_id && revs.get(m.away_revision_id)) || null,
      },
    });
  });

  r.get("/matches/:id/replay", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c, "Replay");
    const [rep] = await db<ReplayRow[]>`select * from replay_artifacts where match_id = ${id}`;
    if (!rep) return notFound(c, "Replay");
    if (c.req.header("if-none-match") === `"${rep.sha256}"`) return c.body(null, 304);
    const bytes = await store.get(rep.uri);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": "application/gzip",
      "content-length": String(bytes.byteLength),
      etag: `"${rep.sha256}"`,
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  return r;
}
