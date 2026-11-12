import type { ControllerDeployment, Lineup, MatchRequest, MatchResult, TeamSize } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import {
  type ParamsResolver,
  type ReplayStore,
  requestHash,
  runMatch,
  SIM_VERSION,
  VERSIONS,
} from "@autosoccer/sim-adapter";
import { enqueue } from "../../jobs/queue.ts";
import { PermanentJobError } from "../../jobs/worker.ts";
import type { Logger } from "../../log.ts";
import { type PlayerRow, toPlayer } from "../mappers.ts";
import { DEFAULT_DEPLOYMENT, defaultLineup } from "./lineup.ts";

export const MATCH_JOB = "match.play";
export const matchJobKey = (fixtureId: string) => `${MATCH_JOB}:${fixtureId}`;

export interface MatchDeps {
  db: Db;
  store: ReplayStore;
  resolveParams?: ParamsResolver;
  /** Test hook: overrides the simulator half length (seconds). */
  halfDurationSec?: number;
  /** Called once, after a match result is first recorded (e.g. enqueue post-match reviews). */
  onCompleted?: (fixtureId: string, matchId: string) => Promise<void>;
}

interface TeamSelection {
  revisionId: string | null;
  deployment: ControllerDeployment;
  lineup: Lineup;
}

/** The deployment a team takes into a fixture: its latest valid revision, else the default. */
export async function teamSelection(
  db: Db,
  seasonId: string,
  teamId: string,
  size: TeamSize = 5,
): Promise<TeamSelection> {
  const [rev] = await db<{ id: string; deployment: ControllerDeployment; lineup: Lineup }[]>`
    select id, deployment, lineup from tactical_revisions
    where team_id = ${teamId} and season_id = ${seasonId} and status = 'valid'
    order by version desc limit 1`;
  if (rev) return { revisionId: rev.id, deployment: rev.deployment, lineup: rev.lineup };
  const players = await db<PlayerRow[]>`select * from players where team_id = ${teamId}`;
  return { revisionId: null, deployment: DEFAULT_DEPLOYMENT, lineup: defaultLineup(players.map(toPlayer), size) };
}

/** Builds the MatchRequest for a fixture from persisted state (squads, revisions, seed, pinned sim). */
export async function buildMatchRequest(deps: MatchDeps, fixtureId: string): Promise<MatchRequest> {
  const { db } = deps;
  const [f] = await db<
    {
      season_id: string;
      home_team_id: string;
      away_team_id: string;
      seed: number;
      sim_version: string;
      players_per_team: number;
    }[]
  >`
    select f.season_id, f.home_team_id, f.away_team_id, f.seed, s.sim_version, s.players_per_team
    from fixtures f join seasons s on s.id = f.season_id where f.id = ${fixtureId}`;
  if (!f) throw new PermanentJobError(`fixture ${fixtureId} not found`);
  const size: TeamSize = f.players_per_team === 7 ? 7 : 5;
  const entry = async (teamId: string) => {
    const [team] = await db<{ name: string }[]>`select name from teams where id = ${teamId}`;
    const sel = await teamSelection(db, f.season_id, teamId, size);
    const players = new Map(
      (await db<PlayerRow[]>`select * from players where team_id = ${teamId}`).map((p) => [p.id, toPlayer(p)]),
    );
    const starters = sel.lineup.starters.map((id) => {
      const p = players.get(id);
      if (!p) throw new PermanentJobError(`lineup player ${id} is not in ${team!.name}'s squad`);
      return { playerId: p.id, name: p.name, shirtNumber: p.shirtNumber, position: p.position };
    });
    return { teamId, name: team!.name, starters, tacticalRevisionId: sel.revisionId, deployment: sel.deployment };
  };
  return {
    contract: "match-request/1",
    fixtureId,
    seed: Number(f.seed),
    simVersion: f.sim_version,
    home: await entry(f.home_team_id),
    away: await entry(f.away_team_id),
    config: {
      ...(deps.halfDurationSec ? { halfDurationSec: deps.halfDurationSec } : {}),
      ...(size === 7 ? { playersPerTeam: 7 as const } : {}),
    },
  };
}

export interface PlayOutcome {
  matchId: string;
  replayId: string | null;
  alreadyCompleted: boolean;
  result: MatchResult | null;
}

/**
 * Plays a fixture exactly once. The request is frozen on the first attempt (stored on the
 * match row), so retries replay the identical request; completion is guarded by a row lock,
 * so concurrent or repeated runs can never record a second result.
 */
export async function playFixture(deps: MatchDeps, fixtureId: string, log?: Logger): Promise<PlayOutcome> {
  const { db } = deps;
  const [existing] = await db<{ id: string; status: string; request: MatchRequest }[]>`
    select id, status, request from matches where fixture_id = ${fixtureId}`;
  if (existing?.status === "completed") {
    return { matchId: existing.id, replayId: null, alreadyCompleted: true, result: null };
  }

  let request: MatchRequest;
  let matchId: string;
  if (existing) {
    request = existing.request;
    matchId = existing.id;
  } else {
    request = await buildMatchRequest(deps, fixtureId);
    const [ins] = await db<{ id: string }[]>`
      insert into matches (fixture_id, seed, request_hash, request, versions, home_revision_id, away_revision_id)
      values (${fixtureId}, ${request.seed}, ${requestHash(request)}, ${db.json(request as never)}, ${db.json(VERSIONS as never)},
        ${request.home.tacticalRevisionId}, ${request.away.tacticalRevisionId})
      on conflict (fixture_id) do nothing returning id`;
    if (ins) matchId = ins.id;
    else {
      const [row] = await db<
        { id: string; request: MatchRequest }[]
      >`select id, request from matches where fixture_id = ${fixtureId}`;
      matchId = row!.id;
      request = row!.request;
    }
  }
  if (request.simVersion !== SIM_VERSION) {
    throw new PermanentJobError(`fixture pinned to sim ${request.simVersion}, worker runs ${SIM_VERSION}`);
  }

  await db`update matches set status = 'running', started_at = coalesce(started_at, now()) where id = ${matchId} and status <> 'completed'`;
  await db`update fixtures set status = 'playing', updated_at = now() where id = ${fixtureId} and status <> 'completed'`;
  log?.info("simulating", { fixtureId, seed: request.seed });

  let result: MatchResult;
  try {
    ({ result } = await runMatch(request, { store: deps.store, resolveParams: deps.resolveParams }));
  } catch (e) {
    await db`update matches set status = 'failed', diagnostics = ${db.json({ error: (e as Error).message })} where id = ${matchId} and status <> 'completed'`;
    await db`update fixtures set status = 'failed', updated_at = now() where id = ${fixtureId} and status <> 'completed'`;
    throw e;
  }

  const outcome = await db.begin(async (tx): Promise<PlayOutcome> => {
    const [m] = await tx<{ status: string }[]>`select status from matches where id = ${matchId} for update`;
    if (m!.status === "completed") return { matchId, replayId: null, alreadyCompleted: true, result: null };
    const [replay] = await tx<{ id: string }[]>`
      insert into replay_artifacts (match_id, uri, format, format_version, engine_version, sdk_version, byte_size, sha256, final_hash, verified)
      values (${matchId}, ${result.replay.uri}, 'autosoccer-replay', ${result.versions.replayFormatVersion}, ${result.versions.engineVersion},
        ${result.versions.sdkVersion}, ${result.replay.byteSize}, ${result.replay.sha256}, ${result.finalHash}, ${result.replay.verified})
      on conflict (match_id) do update set uri = excluded.uri, byte_size = excluded.byte_size, sha256 = excluded.sha256,
        final_hash = excluded.final_hash, verified = excluded.verified
      returning id`;
    await tx`
      update matches set status = 'completed', home_score = ${result.score.home}, away_score = ${result.score.away},
        final_hash = ${result.finalHash}, ticks = ${result.ticks}, events = ${tx.json(result.events as never)},
        stats = ${tx.json(result.stats as never)}, diagnostics = ${tx.json(result.diagnostics as never)}, completed_at = now()
      where id = ${matchId}`;
    await tx`update fixtures set status = 'completed', updated_at = now() where id = ${fixtureId}`;
    return { matchId, replayId: replay!.id, alreadyCompleted: false, result };
  });
  if (!outcome.alreadyCompleted) await deps.onCompleted?.(fixtureId, matchId);
  return outcome;
}

/** Enqueues the (idempotent) job that plays a fixture. */
export const enqueueFixture = (db: Db, fixtureId: string) =>
  enqueue(db, { kind: MATCH_JOB, key: matchJobKey(fixtureId), payload: { fixtureId }, maxAttempts: 3 });

export function matchJobHandler(deps: MatchDeps) {
  return async (job: { payload: Record<string, unknown> }, ctx: { log: Logger }) => {
    const fixtureId = String(job.payload.fixtureId ?? "");
    const out = await playFixture(deps, fixtureId, ctx.log);
    return {
      result: { matchId: out.matchId, alreadyCompleted: out.alreadyCompleted, score: out.result?.score ?? null },
      artifacts: [{ kind: "match", id: out.matchId }, ...(out.replayId ? [{ kind: "replay", id: out.replayId }] : [])],
    };
  };
}
