import type { SimVersionInfo } from "@autosoccer/contracts";
import { SDK_VERSION } from "@autosoccer/controller-sdk";
import { ENGINE_VERSION } from "@autosoccer/sim-core";
import { REPLAY_FORMAT_VERSION } from "@autosoccer/telemetry";

/**
 * The autosoccer-sim commit this adapter is built and tested against. It must equal
 * the `vendor/autosoccer-sim` submodule HEAD (a test enforces it). Upgrading the sim =
 * bump the submodule + this constant + re-run the adapter tests.
 */
export const SIM_COMMIT = "9c436779c9550f6a7f71cd9fb0ffcf137fad9ec0";
export const SIM_VERSION = SIM_COMMIT.slice(0, 7);
export const ADAPTER_VERSION = "1.3.0";

/** What a pinned simulator can play. */
export interface SimFeatures {
  /** Ball control and controller 3.0 (`config.ballControl`). */
  ballControl: boolean;
  /** Player attributes (`starters[].attributes`). */
  attributes: boolean;
}

/**
 * Every pin this build plays, newest first, with the features requests pinned to it may use. A
 * season keeps the pin it was created with, so earlier pins stay listed while seasons on them can
 * still be in progress. Each later sim only added opt-in behaviour: a request that doesn't use a
 * newer feature runs the same engine code path and the same controller source (tests pin both).
 */
export const SIM_PINS: ReadonlyArray<{ commit: string; features: SimFeatures }> = [
  { commit: SIM_COMMIT, features: { ballControl: true, attributes: true } },
  { commit: "9709cfa7bbe07a9c32a1f606b554182d2a07e700", features: { ballControl: true, attributes: false } },
  { commit: "0bc52c0f86162c15e8196b73d753136d3f19d83f", features: { ballControl: false, attributes: false } },
];
export const COMPATIBLE_SIM_COMMITS: readonly string[] = SIM_PINS.slice(1).map((p) => p.commit);

/** Features of a pinned sim (full or 7-character commit), or null if this build can't play it. */
export function simFeatures(simVersion: string): SimFeatures | null {
  const pin = SIM_PINS.find((p) => simVersion === p.commit || simVersion === p.commit.slice(0, 7));
  return pin?.features ?? null;
}

interface PinnedRequest {
  simVersion: string;
  config: { ballControl?: boolean };
  home?: { starters: ReadonlyArray<{ attributes?: unknown }> };
  away?: { starters: ReadonlyArray<{ attributes?: unknown }> };
}

/** Whether this build can play a request: a known pin that supports every feature the request uses. */
export function isSupportedSimPin(r: PinnedRequest): boolean {
  const f = simFeatures(r.simVersion);
  if (!f) return false;
  if (r.config.ballControl && !f.ballControl) return false;
  const rated = [r.home, r.away].some((t) => t?.starters.some((s) => s.attributes));
  return !rated || f.attributes;
}

export const VERSIONS: SimVersionInfo = {
  simCommit: SIM_COMMIT,
  engineVersion: ENGINE_VERSION,
  sdkVersion: SDK_VERSION,
  adapterVersion: ADAPTER_VERSION,
  replayFormatVersion: REPLAY_FORMAT_VERSION,
};
