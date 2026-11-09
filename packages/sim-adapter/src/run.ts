import { gzipSync } from "node:zlib";
import { MatchRequest, type MatchResult, type TeamMatchStats } from "@autosoccer/contracts";
import { runSeriesMatch } from "@autosoccer/match-runner";
import { makeConfig } from "@autosoccer/sim-core";
import { canonicalJson, sha256 } from "./canonical.ts";
import { controllerSource, type ParamsResolver } from "./controllers/index.ts";
import { officialEvents } from "./events.ts";
import type { ReplayStore } from "./replay-store.ts";
import { SIM_COMMIT, SIM_VERSION, VERSIONS } from "./version.ts";

export class SimVersionMismatchError extends Error {}

export interface RunMatchOptions {
  store: ReplayStore;
  /** Maps a tactical deployment's config to controller params (supplied by the tactics module). */
  resolveParams?: ParamsResolver;
}

export interface RunMatchOutput {
  result: MatchResult;
  /** Canonical request that was executed (after schema defaults). */
  request: MatchRequest;
}

/** Hash identifying a request: identical requests must yield identical results. */
export function requestHash(request: MatchRequest): string {
  return sha256(canonicalJson(MatchRequest.parse(request)));
}

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;
const roundStats = (s: TeamMatchStats): TeamMatchStats =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number.isInteger(v) ? v : round(v)])) as TeamMatchStats;

/**
 * Plays one official match: MatchRequest → simulator (sandboxed controllers,
 * per-tick invariants, verified replay) → MatchResult. Pure in (request, sim
 * version): the same request always gives the same score, events and final hash.
 */
export async function runMatch(input: MatchRequest, opts: RunMatchOptions): Promise<RunMatchOutput> {
  const request = MatchRequest.parse(input);
  if (request.simVersion !== SIM_VERSION && request.simVersion !== SIM_COMMIT) {
    throw new SimVersionMismatchError(`request pins sim ${request.simVersion}, adapter is built for ${SIM_VERSION}`);
  }
  const config = request.config.halfDurationSec ? { halfDurationSec: request.config.halfDurationSec } : {};
  const simConfig = makeConfig(config);
  const label = (t: typeof request.home, side: string) => `${t.name} (${side}, ${t.tacticalRevisionId ?? "default"})`;

  const { summary, replay } = await runSeriesMatch(request.seed, {
    blue: { label: label(request.home, "home"), source: controllerSource(request.home.deployment, opts.resolveParams) },
    red: { label: label(request.away, "away"), source: controllerSource(request.away.deployment, opts.resolveParams) },
    config,
    replayEvery: 1,
    determinismEvery: 0,
    checkInvariants: true,
  });
  if (!replay) throw new Error("simulator did not produce a replay");
  if (!summary.finished) throw new Error(`match did not reach full time (stopped at tick ${summary.ticks})`);

  const ids = new Map<string, string>();
  for (const [i, s] of request.home.starters.entries()) ids.set(`blue-${i + 1}`, s.playerId);
  for (const [i, s] of request.away.starters.entries()) ids.set(`red-${i + 1}`, s.playerId);
  const playerIdOf = (simId: string) => {
    const id = ids.get(simId);
    if (!id) throw new Error(`unknown simulator player ${simId}`);
    return id;
  };

  const hash = requestHash(request);
  const bytes = gzipSync(JSON.stringify(replay), { level: 9 });
  const uri = await opts.store.put(`${request.fixtureId}/${hash.slice(0, 16)}.replay.json.gz`, bytes);

  const result: MatchResult = {
    contract: "match-result/1",
    fixtureId: request.fixtureId,
    seed: request.seed,
    versions: VERSIONS,
    requestHash: hash,
    finalHash: summary.hash,
    score: { home: summary.score.blue, away: summary.score.red },
    events: officialEvents(replay.events, simConfig, playerIdOf),
    stats: { home: roundStats(summary.profile.blue), away: roundStats(summary.profile.red) },
    ticks: summary.ticks,
    replay: { uri, sha256: sha256(bytes), byteSize: bytes.byteLength, verified: summary.replayVerified === true },
    diagnostics: {
      controllerFailures: summary.failures,
      invariantViolations: summary.invariantViolations,
      wallMs: Math.round(summary.wallMs),
    },
  };
  return { result, request };
}
