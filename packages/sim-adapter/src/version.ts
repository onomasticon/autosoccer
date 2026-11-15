import type { SimVersionInfo } from "@autosoccer/contracts";
import { SDK_VERSION } from "@autosoccer/controller-sdk";
import { ENGINE_VERSION } from "@autosoccer/sim-core";
import { REPLAY_FORMAT_VERSION } from "@autosoccer/telemetry";

/**
 * The autosoccer-sim commit this adapter is built and tested against. It must equal
 * the `vendor/autosoccer-sim` submodule HEAD (a test enforces it). Upgrading the sim =
 * bump the submodule + this constant + re-run the adapter tests.
 */
export const SIM_COMMIT = "9709cfa7bbe07a9c32a1f606b554182d2a07e700";
export const SIM_VERSION = SIM_COMMIT.slice(0, 7);
export const ADAPTER_VERSION = "1.2.0";

/**
 * Earlier pins whose requests this build plays identically, so a season that started on one can
 * finish after an upgrade. 0bc52c0 → 9709cfa only added opt-in engine behaviour (ball control,
 * 11-a-side) and a separate controller template for it: a request without `ballControl` runs the
 * same engine code path and the byte-identical controller 2.0 source (tests pin both).
 */
export const COMPATIBLE_SIM_COMMITS: readonly string[] = ["0bc52c0f86162c15e8196b73d753136d3f19d83f"];

/** Whether this build can play a request pinned to `simVersion` (ball control needs the current pin). */
export function isSupportedSimPin(r: { simVersion: string; config: { ballControl?: boolean } }): boolean {
  const matches = (commit: string) => r.simVersion === commit || r.simVersion === commit.slice(0, 7);
  if (matches(SIM_COMMIT)) return true;
  return !r.config.ballControl && COMPATIBLE_SIM_COMMITS.some(matches);
}

export const VERSIONS: SimVersionInfo = {
  simCommit: SIM_COMMIT,
  engineVersion: ENGINE_VERSION,
  sdkVersion: SDK_VERSION,
  adapterVersion: ADAPTER_VERSION,
  replayFormatVersion: REPLAY_FORMAT_VERSION,
};
