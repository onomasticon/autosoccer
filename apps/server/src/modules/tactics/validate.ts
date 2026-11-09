import {
  type ControllerDeployment,
  type Lineup,
  type Player,
  TACTICS_SCHEMA_VERSION,
  TacticalConfigV1,
} from "@autosoccer/contracts";

export interface RevisionInput {
  deployment: ControllerDeployment;
  /** Five starters in slot order: [GK, then the formation's outfield slots back to front]. */
  starters: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  lineup: Lineup | null;
}

/**
 * Validates a proposed tactical revision against the team's squad:
 * schema (tactics/1, strict), exactly five distinct starters from this squad,
 * a goalkeeper in slot 1 and no goalkeeper in an outfield slot. Reserves are the
 * rest of the squad. Scripted deployments are rejected until they're executable.
 */
export function validateRevision(squad: Player[], input: RevisionInput): ValidationResult {
  const errors: string[] = [];
  const d = input.deployment;
  if (d.kind !== "tactical") {
    errors.push("scripted controllers are not enabled for this season");
  } else if (d.schemaVersion !== TACTICS_SCHEMA_VERSION) {
    errors.push(`unsupported tactics schema "${d.schemaVersion}" (expected ${TACTICS_SCHEMA_VERSION})`);
  } else {
    const parsed = TacticalConfigV1.safeParse(d.config);
    if (!parsed.success)
      for (const i of parsed.error.issues) errors.push(`tactics.${i.path.join(".") || "(root)"}: ${i.message}`);
  }

  const byId = new Map(squad.map((p) => [p.id, p]));
  const starters = input.starters;
  if (starters.length !== 5) errors.push(`exactly 5 starters are required (got ${starters.length})`);
  if (new Set(starters).size !== starters.length) errors.push("a player is listed more than once");
  const unknown = starters.filter((id) => !byId.has(id));
  if (unknown.length) errors.push(`not in this squad: ${unknown.join(", ")}`);
  const gk = byId.get(starters[0] ?? "");
  if (gk && gk.position !== "GK") errors.push(`slot 1 must be a goalkeeper (${gk.name} is a ${gk.position})`);
  for (const id of starters.slice(1)) {
    const p = byId.get(id);
    if (p?.position === "GK") errors.push(`${p.name} is a goalkeeper and can't play an outfield slot`);
  }
  const lineup = errors.length
    ? null
    : {
        starters: [...starters],
        reserves: squad
          .filter((p) => !starters.includes(p.id))
          .sort((a, b) => a.shirtNumber - b.shirtNumber)
          .map((p) => p.id),
      };
  return { ok: errors.length === 0, errors, lineup };
}
