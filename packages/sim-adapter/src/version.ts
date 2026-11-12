import type { SimVersionInfo } from "@autosoccer/contracts";
import { SDK_VERSION } from "@autosoccer/controller-sdk";
import { ENGINE_VERSION } from "@autosoccer/sim-core";
import { REPLAY_FORMAT_VERSION } from "@autosoccer/telemetry";

/**
 * The autosoccer-sim commit this adapter is built and tested against. It must equal
 * the `vendor/autosoccer-sim` submodule HEAD (a test enforces it). Upgrading the sim =
 * bump the submodule + this constant + re-run the adapter tests.
 */
export const SIM_COMMIT = "0bc52c0f86162c15e8196b73d753136d3f19d83f";
export const SIM_VERSION = SIM_COMMIT.slice(0, 7);
export const ADAPTER_VERSION = "1.1.0";

export const VERSIONS: SimVersionInfo = {
  simCommit: SIM_COMMIT,
  engineVersion: ENGINE_VERSION,
  sdkVersion: SDK_VERSION,
  adapterVersion: ADAPTER_VERSION,
  replayFormatVersion: REPLAY_FORMAT_VERSION,
};
