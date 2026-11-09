/**
 * Versioned adapter between the site and autosoccer-sim replay files. The site never runs
 * controllers: it re-steps the pure engine from recorded snapshots + commands (exactly what
 * the simulator's own viewer does), so what you see is the official match.
 */
import type { PlayerState, WorldState } from "@autosoccer/sim-core";
import { REPLAY_FORMAT, type ReplayFile, ReplayPlayer } from "@autosoccer/telemetry";

export const SUPPORTED_FORMAT_VERSIONS = [1] as const;
export const ADAPTER = "site-replay-adapter/1";

export class UnsupportedReplayError extends Error {}

export function assertSupported(replay: unknown): asserts replay is ReplayFile {
  const r = replay as Partial<ReplayFile> | null;
  if (!r || r.format !== REPLAY_FORMAT) throw new UnsupportedReplayError("not an autosoccer replay file");
  if (!SUPPORTED_FORMAT_VERSIONS.includes(r.formatVersion as 1)) {
    throw new UnsupportedReplayError(`replay format v${r.formatVersion} is not supported by ${ADAPTER}`);
  }
}

/** A frame is everything the renderer needs; decoupled from engine internals. */
export interface Frame {
  tick: number;
  period: WorldState["match"]["period"];
  clockSec: number;
  score: { home: number; away: number };
  ball: { x: number; y: number; held: boolean };
  players: Array<{
    id: string;
    side: "home" | "away";
    number: number;
    gk: boolean;
    x: number;
    y: number;
    heading: number;
    stunned: boolean;
  }>;
}

export function toFrame(s: WorldState, tickRate: number): Frame {
  return {
    tick: s.tick,
    period: s.match.period,
    clockSec: s.match.halfTicks / tickRate,
    score: { home: s.match.score.blue, away: s.match.score.red },
    ball: { x: s.ball.x, y: s.ball.y, held: s.ball.heldBy !== null },
    players: s.players.map((p: PlayerState) => ({
      id: p.id,
      side: p.team === "blue" ? "home" : "away",
      number: p.number,
      gk: p.role === "GK",
      x: p.x,
      y: p.y,
      heading: p.heading,
      stunned: p.stunned > 0,
    })),
  };
}

export class ReplaySource {
  private readonly player: ReplayPlayer;
  readonly finalTick: number;
  readonly tickRate: number;
  readonly pitch: ReplayFile["config"]["pitch"];
  readonly playerRadius: number;
  readonly engineVersion: string;

  constructor(readonly replay: ReplayFile) {
    assertSupported(replay);
    this.player = new ReplayPlayer(replay);
    this.finalTick = replay.finalTick;
    this.tickRate = replay.config.tickRate;
    this.pitch = replay.config.pitch;
    this.playerRadius = replay.config.player.radius;
    this.engineVersion = replay.engineVersion;
  }

  get tick() {
    return this.player.tick;
  }

  frameAt(tick: number): Frame {
    return toFrame(this.player.seek(tick), this.tickRate);
  }
}

/** Fetches a gzip replay and decodes it in the browser. */
export async function loadReplay(url: string, signal?: AbortSignal): Promise<ReplaySource> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`replay unavailable (HTTP ${res.status})`);
  const text = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  const json: unknown = JSON.parse(text);
  assertSupported(json);
  return new ReplaySource(json);
}
