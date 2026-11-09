import { type ControllerDeployment, describeTactics, TacticalConfigV1 } from "@autosoccer/contracts";

/** Human-readable summary of a deployment for public pages. */
export function describeDeployment(d: ControllerDeployment): string {
  if (d.kind === "scripted") return `scripted controller (SDK ${d.sdkVersion})`;
  if (Object.keys(d.config).length === 0) return "league baseline tactics";
  const t = TacticalConfigV1.safeParse(d.config);
  return t.success ? describeTactics(t.data) : "tactical setup";
}
