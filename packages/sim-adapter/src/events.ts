import type { OfficialEvent, Side } from "@autosoccer/contracts";
import type { LoggedEvent, SimConfig } from "@autosoccer/sim-core";

const sideOf = (team: "blue" | "red"): Side => (team === "blue" ? "home" : "away");

/**
 * Projects the simulator event log onto official match events, translating
 * simulator player ids (blue-1…red-5) to platform player ids via the starters.
 * Clock = seconds since the half's periodStart (the default clock policy runs continuously).
 */
export function officialEvents(
  log: readonly LoggedEvent[],
  config: SimConfig,
  playerIdOf: (simId: string) => string,
): OfficialEvent[] {
  const out: OfficialEvent[] = [];
  let period: "firstHalf" | "secondHalf" = "firstHalf";
  let periodStart = 0;
  const halfSec = config.halfDurationSec;
  const clock = (tick: number) => Math.min(halfSec, Math.round(((tick - periodStart) / config.tickRate) * 10) / 10);
  for (const { tick, event: e } of log) {
    switch (e.type) {
      case "periodStart":
        if (e.period !== "firstHalf" && e.period !== "secondHalf") break;
        period = e.period;
        periodStart = tick;
        out.push({ type: "periodStart", tick, period, clockSec: 0 });
        break;
      case "periodEnd":
        if (e.period !== "firstHalf" && e.period !== "secondHalf") break;
        out.push({ type: "periodEnd", tick, period: e.period, clockSec: clock(tick) });
        break;
      case "goalScored":
        out.push({
          type: "goal",
          tick,
          period,
          clockSec: clock(tick),
          side: sideOf(e.team),
          scorerId: e.scorer ? playerIdOf(e.scorer) : null,
          ownGoal: e.ownGoal,
          score: { home: e.score.blue, away: e.score.red },
        });
        break;
      case "foul":
        out.push({
          type: "foul",
          tick,
          period,
          clockSec: clock(tick),
          side: e.by.startsWith("blue") ? "home" : "away",
          playerId: playerIdOf(e.by),
          againstId: playerIdOf(e.against),
        });
        break;
      case "restartTaken":
        if (e.restart === "kickoff") break;
        out.push({
          type: "restart",
          tick,
          period,
          clockSec: clock(tick),
          side: sideOf(e.team),
          restart: e.restart,
          takerId: playerIdOf(e.taker),
        });
        break;
    }
  }
  return out;
}
