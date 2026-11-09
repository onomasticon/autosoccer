import type { MatchRequest } from "@autosoccer/contracts";
import { SIM_VERSION } from "./version.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const POS = ["GK", "DF", "DF", "MF", "FW"] as const;

/** A valid MatchRequest with baseline tactics, for tests and demos. */
export function sampleRequest(over: Partial<MatchRequest> = {}): MatchRequest {
  const side = (base: number, name: string) => ({
    teamId: uuid(base),
    name,
    starters: POS.map((position, i) => ({
      playerId: uuid(base + i + 1),
      name: `${name} ${i + 1}`,
      shirtNumber: i + 1,
      position,
    })),
    tacticalRevisionId: null,
    deployment: { kind: "tactical" as const, schemaVersion: "tactics/1", config: {} },
  });
  return {
    contract: "match-request/1",
    fixtureId: uuid(9000),
    seed: 42,
    simVersion: SIM_VERSION,
    home: side(100, "Home"),
    away: side(200, "Away"),
    config: {},
    ...over,
  };
}
