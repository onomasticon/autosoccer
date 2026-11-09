import type { ControllerDeployment, Lineup, Position } from "@autosoccer/contracts";

/** Simulator slot order for the five starters. */
export const SLOT_POSITIONS: readonly Position[] = ["GK", "DF", "DF", "MF", "FW"];

/** The fixed Phase-1 deployment: baseline tactics until a manager deploys a revision. */
export const DEFAULT_DEPLOYMENT: ControllerDeployment = { kind: "tactical", schemaVersion: "tactics/1", config: {} };

/**
 * Default lineup from a squad: fills slots GK, DF, DF, MF, FW with the lowest shirt
 * number of the matching position, then any remaining outfield player. Deterministic.
 */
export function defaultLineup(players: Array<{ id: string; shirtNumber: number; position: Position }>): Lineup {
  const pool = [...players].sort((a, b) => a.shirtNumber - b.shirtNumber);
  const starters: string[] = [];
  for (const pos of SLOT_POSITIONS) {
    const pick =
      pool.find((p) => p.position === pos && !starters.includes(p.id)) ??
      (pos === "GK" ? undefined : pool.find((p) => p.position !== "GK" && !starters.includes(p.id)));
    if (!pick) throw new Error(`squad cannot field a ${pos}`);
    starters.push(pick.id);
  }
  return { starters, reserves: pool.filter((p) => !starters.includes(p.id)).map((p) => p.id) };
}
