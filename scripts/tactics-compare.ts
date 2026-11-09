/**
 * Plays two contrasting tactics/1 configs against each other over several seeds (swapping
 * venues), twice each, and prints how their behaviour differs.
 *   bun run tactics:compare [--seeds 6] [--half 120]
 */
import type { TacticalConfigV1, TeamMatchStats } from "@autosoccer/contracts";
import { describeTactics } from "@autosoccer/contracts";
import { MemoryReplayStore, runMatch } from "@autosoccer/sim-adapter";
import { sampleRequest } from "../packages/sim-adapter/src/testing.ts";

const arg = (n: string, d: number) =>
  process.argv.includes(`--${n}`) ? Number(process.argv[process.argv.indexOf(`--${n}`) + 1]) : d;
const seeds = arg("seeds", 6);
const half = arg("half", 120);
const A: TacticalConfigV1 = {
  formation: "1-1-2",
  lineHeight: "high",
  width: "wide",
  pressing: "high",
  tempo: "direct",
  passingRisk: "risky",
  shooting: "early",
  dribbling: "often",
  keeperDistribution: "long",
};
const B: TacticalConfigV1 = {
  formation: "3-1",
  lineHeight: "deep",
  width: "narrow",
  pressing: "low",
  tempo: "patient",
  passingRisk: "safe",
  shooting: "selective",
  dribbling: "rarely",
  keeperDistribution: "short",
};
const dep = (config: TacticalConfigV1) => ({ kind: "tactical" as const, schemaVersion: "tactics/1", config });
const KEYS: Array<keyof TeamMatchStats> = [
  "goals",
  "possession",
  "avgTeamHeight",
  "passes",
  "passesCompleted",
  "avgPassLength",
  "shots",
  "dribbleTouches",
  "tackles",
  "interceptions",
];
const tot = { A: {} as Record<string, number>, B: {} as Record<string, number> };
let reproducible = true;
console.log(`A: ${describeTactics(A)}\nB: ${describeTactics(B)}\n`);
for (let seed = 1; seed <= seeds; seed++) {
  const swap = seed % 2 === 0;
  const req = sampleRequest({ seed, config: { halfDurationSec: half } });
  req.home.deployment = dep(swap ? B : A);
  req.away.deployment = dep(swap ? A : B);
  const r1 = (await runMatch(req, { store: new MemoryReplayStore() })).result;
  const r2 = (await runMatch(req, { store: new MemoryReplayStore() })).result;
  reproducible &&= r1.finalHash === r2.finalHash;
  const a = swap ? r1.stats.away : r1.stats.home;
  const b = swap ? r1.stats.home : r1.stats.away;
  for (const k of KEYS) {
    tot.A[k] = (tot.A[k] ?? 0) + a[k];
    tot.B[k] = (tot.B[k] ?? 0) + b[k];
  }
  console.log(
    `seed ${seed} (A ${swap ? "away" : "home"}): A ${a.goals}–${b.goals} B · height ${a.avgTeamHeight.toFixed(1)} vs ${b.avgTeamHeight.toFixed(1)} m · hash ${r1.finalHash} ${r1.finalHash === r2.finalHash ? "✓ rerun identical" : "✗ DIFFERS"}`,
  );
}
console.log(
  `\nper-match means over ${seeds} matches (${half}s halves)\n${"stat".padEnd(18)}${"A".padStart(9)}${"B".padStart(9)}`,
);
for (const k of KEYS)
  console.log(
    `${k.padEnd(18)}${(tot.A[k]! / seeds).toFixed(2).padStart(9)}${(tot.B[k]! / seeds).toFixed(2).padStart(9)}`,
  );
console.log(reproducible ? "\nall matches reproduced bit-for-bit ✓" : "\nNON-DETERMINISTIC ✗");
process.exit(reproducible ? 0 : 1);
