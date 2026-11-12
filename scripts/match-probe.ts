/**
 * Diagnostic: plays one seeded match through the league adapter and prints where the ball
 * spends its time, how possessions end and the controllers' decision modes. Research only.
 *
 *   bun scripts/match-probe.ts [--seed 1] [--players 7] [--home red-rock-rovers] [--away harbour-city]
 */
import { gunzipSync } from "node:zlib";
import { defaultTactics, type TeamSize } from "@autosoccer/contracts";
import { MemoryReplayStore, runMatch } from "@autosoccer/sim-adapter";
import { openingTactics, SEED_MANAGERS } from "../apps/server/src/modules/agents/managers-seed.ts";
import { sampleRequest } from "../packages/sim-adapter/src/testing.ts";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1]! : d);
const size: TeamSize = opt("players", "7") === "5" ? 5 : 7;
const tactics = (slug: string) => {
  const m = SEED_MANAGERS.find((x) => x.teamSlug === slug);
  return m ? openingTactics(m, size) : defaultTactics(size);
};
const dep = (slug: string) => ({ kind: "tactical" as const, schemaVersion: "tactics/1", config: tactics(slug) });
const req = sampleRequest({ seed: Number(opt("seed", "1")), config: size === 7 ? { playersPerTeam: 7 } : {} });
req.home.deployment = dep(opt("home", "red-rock-rovers"));
req.away.deployment = dep(opt("away", "harbour-city"));
const store = new MemoryReplayStore();
const { result } = await runMatch(req, { store });
const replay = JSON.parse(gunzipSync(await store.get(result.replay.uri)).toString());

console.log("score", result.score, "ticks", result.ticks);
for (const side of ["home", "away"] as const) {
  const s = result.stats[side];
  console.log(side, JSON.stringify(s));
}
const kinds: Record<string, number> = {};
for (const e of replay.events) kinds[e.type] = (kinds[e.type] ?? 0) + 1;
console.log("events", JSON.stringify(kinds));
const modes: Record<string, number> = {};
for (const d of replay.decisions) modes[`${d.team}:${d.mode}`] = (modes[`${d.team}:${d.mode}`] ?? 0) + 1;
console.log("modes", JSON.stringify(modes));
const notes: Record<string, number> = {};
for (const d of replay.decisions)
  for (const n of d.notes) {
    const k = n.replace(/[a-z]+-\d/g, "P").replace(/\d+(\.\d+)?/g, "#");
    notes[k] = (notes[k] ?? 0) + 1;
  }
console.log(
  "notes",
  JSON.stringify(
    Object.entries(notes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
  ),
);
// Ball position by thirds, sampled every second from snapshots.
const snaps = replay.snapshots ?? [];
const L = replay.config.pitch.length / 2;
const thirds = [0, 0, 0];
for (const s of snaps) {
  const x = s.ball?.x ?? s.state?.ball?.x;
  if (typeof x !== "number") continue;
  thirds[x < -L / 3 ? 0 : x > L / 3 ? 2 : 1]!++;
}
console.log("ball thirds (blue goal → red goal)", thirds, "snapshots", snaps.length);
const rejected = replay.decisions.reduce((n: number, d: { rejected?: unknown[] }) => n + (d.rejected?.length ?? 0), 0);
console.log("rejected actions", rejected, "restarts", result.events.filter((e) => e.type === "restart").length);
