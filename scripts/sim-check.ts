/**
 * Plays a full-length match through the pinned simulator adapter twice and checks
 * that both runs agree (score, events, final hash, replay bytes).
 *   bun run sim:check [--seed 42] [--half 120]
 */
import { MemoryReplayStore, runMatch, VERSIONS } from "@autosoccer/sim-adapter";
import { sampleRequest } from "../packages/sim-adapter/src/testing.ts";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const seed = arg("seed", 42);
const half = arg("half", 120);
const req = sampleRequest({ seed, config: { halfDurationSec: half } });

console.log(
  `sim ${VERSIONS.simCommit.slice(0, 7)} · engine ${VERSIONS.engineVersion} · sdk ${VERSIONS.sdkVersion} · adapter ${VERSIONS.adapterVersion}`,
);
const runs = [];
for (const n of [1, 2]) {
  const { result } = await runMatch(req, { store: new MemoryReplayStore() });
  runs.push(result);
  const goals = result.events.filter((e) => e.type === "goal").length;
  console.log(
    `run ${n}: ${result.score.home}–${result.score.away}  final ${result.finalHash}  ticks ${result.ticks}  goals ${goals}  ` +
      `replay ${(result.replay.byteSize / 1024).toFixed(0)} KB verified=${result.replay.verified}  ${result.diagnostics.wallMs} ms`,
  );
}
const [a, b] = runs as [(typeof runs)[0], (typeof runs)[0]];
const same =
  a.finalHash === b.finalHash &&
  a.replay.sha256 === b.replay.sha256 &&
  JSON.stringify(a.events) === JSON.stringify(b.events) &&
  JSON.stringify(a.stats) === JSON.stringify(b.stats);
console.log(same ? "deterministic: identical score, events, stats, final hash and replay bytes ✓" : "MISMATCH ✗");
const issues = [...a.diagnostics.controllerFailures, ...a.diagnostics.invariantViolations];
console.log(issues.length ? `diagnostics: ${issues.join("; ")}` : "controller failures: 0 · invariant violations: 0");
process.exit(same && !issues.length ? 0 : 1);
