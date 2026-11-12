import type { ControllerDeployment, Lineup, Position, TeamSize } from "@autosoccer/contracts";

/** Simulator slot order for the starters (matches the simulator's kickoff shape per team size). */
export const SLOT_POSITIONS: Record<TeamSize, readonly Position[]> = {
  5: ["GK", "DF", "DF", "MF", "FW"],
  7: ["GK", "DF", "DF", "MF", "MF", "MF", "FW"],
};

/** The fixed Phase-1 deployment: baseline tactics until a manager deploys a revision. */
export const DEFAULT_DEPLOYMENT: ControllerDeployment = { kind: "tactical", schemaVersion: "tactics/1", config: {} };

/**
 * Default lineup from a squad: fills the size's slots (GK, DF, DF, MF, FW in 5-a-side) with the
 * lowest shirt number of the matching position, then any remaining outfield player. Deterministic.
 */
export function defaultLineup(
  players: Array<{ id: string; shirtNumber: number; position: Position }>,
  size: TeamSize = 5,
): Lineup {
  const pool = [...players].sort((a, b) => a.shirtNumber - b.shirtNumber);
  const starters: string[] = [];
  for (const pos of SLOT_POSITIONS[size]) {
    const pick =
      pool.find((p) => p.position === pos && !starters.includes(p.id)) ??
      (pos === "GK" ? undefined : pool.find((p) => p.position !== "GK" && !starters.includes(p.id)));
    if (!pick) throw new Error(`squad cannot field a ${pos}`);
    starters.push(pick.id);
  }
  return { starters, reserves: pool.filter((p) => !starters.includes(p.id)).map((p) => p.id) };
}
