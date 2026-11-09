import { readFileSync } from "node:fs";
import type { ControllerDeployment } from "@autosoccer/contracts";

/** Slot = where one outfield shirt number (2–5) stands: metres from own goal line, and lateral offset. */
export interface Slot {
  depth: number;
  lateral: number;
}

/** Everything the tactical controller template reads. Plain numbers only, so the source is deterministic. */
export interface ControllerParams {
  name: string;
  slots: Record<2 | 3 | 4 | 5, Slot>;
  ballFollow: number;
  ballShift: number;
  attackPush: number;
  pressLine: number;
  pressers: 1 | 2;
  sprint: boolean;
  shootRange: number;
  passSafety: number;
  directness: number;
  maxPassDistance: number;
  backPassAllowance: number;
  leadDistance: number;
  passArriveSpeed: number;
  dribbleSpace: number;
  keeperRelease: "short" | "long";
}

/** The fixed baseline used for Phase-1 integration (and as the fallback for unmapped configs). */
export const BASELINE_PARAMS: ControllerParams = {
  name: "baseline-2-1-1",
  slots: {
    2: { depth: 9, lateral: -5 },
    3: { depth: 9, lateral: 5 },
    4: { depth: 17, lateral: 0 },
    5: { depth: 27, lateral: 3 },
  },
  ballFollow: 0.3,
  ballShift: 0.4,
  attackPush: 4,
  pressLine: 0,
  pressers: 1,
  sprint: true,
  shootRange: 15,
  passSafety: 1.2,
  directness: 0.5,
  maxPassDistance: 22,
  backPassAllowance: 4,
  leadDistance: 1.5,
  passArriveSpeed: 3,
  dribbleSpace: 3.5,
  keeperRelease: "short",
};

const TEMPLATE = readFileSync(new URL("./tactical.js", import.meta.url), "utf8");

/** Renders the controller source for a param set. Same params ⇒ byte-identical source. */
export function renderTacticalController(params: ControllerParams): string {
  return TEMPLATE.replace("__PARAMS__", JSON.stringify(params));
}

export type ParamsResolver = (deployment: Extract<ControllerDeployment, { kind: "tactical" }>) => ControllerParams;

export class UnsupportedDeploymentError extends Error {}

/**
 * Resolves a deployment to controller source. Tactical configs are mapped by `resolve`
 * (the tactics module supplies the schema-aware mapping); scripted artifacts need an
 * artifact store, which is not part of the MVP.
 */
export function controllerSource(
  deployment: ControllerDeployment,
  resolve: ParamsResolver = () => BASELINE_PARAMS,
): string {
  if (deployment.kind === "tactical") return renderTacticalController(resolve(deployment));
  throw new UnsupportedDeploymentError(
    `scripted deployments (sdk ${deployment.sdkVersion}, artifact ${deployment.artifactId}) are not executable yet`,
  );
}
