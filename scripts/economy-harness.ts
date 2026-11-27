/**
 * The accelerated economy harness (#98), fast mode: seeded leagues played in memory with production
 * economic rules, synthetic results and deterministic policy managers. Never touches a database.
 *
 *   bun run economy:harness [--clubs 20] [--seasons 100] [--seeds 1,2,3,4,5] [--rulesets legacy]
 *                           [--scenarios baseline,low-liquidity,...|all] [--out out/economy]
 *                           [--report docs/platform/economy-balance.md]
 *   bun run economy:harness --replay 3 --rulesets legacy --scenarios baseline   # one seed, failures in full
 *   bun run economy:harness --smoke                                            # CI-sized run
 *
 * Writes <out>/runs.json (every season of every run), <out>/seasons.csv, <out>/summary.json and a
 * markdown report. Exits non-zero if any hard invariant fails, unless --allow-failures is given
 * (the legacy baseline breaks `no-forfeits`-style promises by design, so it is reported, not gated).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type RunResult, runLeague } from "../apps/server/src/modules/economy/engine.ts";
import { csv, type Group, markdown, summarise } from "../apps/server/src/modules/economy/report.ts";
import { RULESETS, SCENARIOS } from "../apps/server/src/modules/economy/rulesets.ts";

const has = (n: string) => process.argv.includes(`--${n}`);
const arg = (n: string, d: string) => (has(n) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d);
const smoke = has("smoke");
const clubs = Number(arg("clubs", "20"));
const seasons = Number(arg("seasons", smoke ? "5" : "100"));
const seeds = has("replay")
  ? [Number(arg("replay", "1"))]
  : arg("seeds", smoke ? "1,2" : "1,2,3,4,5")
      .split(",")
      .map(Number);
const rulesets = arg("rulesets", Object.keys(RULESETS).join(",")).split(",");
const scenarioArg = arg("scenarios", smoke ? "baseline" : "all");
const scenarios = scenarioArg === "all" ? Object.keys(SCENARIOS) : scenarioArg.split(",");
const out = arg("out", "out/economy");
const reportPath = arg("report", `${out}/report.md`);

const groups: Group[] = [];
const t0 = performance.now();
for (const rs of rulesets) {
  const ruleset = RULESETS[rs];
  if (!ruleset) throw new Error(`unknown ruleset ${rs} (have ${Object.keys(RULESETS).join(", ")})`);
  for (const sc of scenarios) {
    const scenario = SCENARIOS[sc];
    if (!scenario) throw new Error(`unknown scenario ${sc} (have ${Object.keys(SCENARIOS).join(", ")})`);
    const runs: RunResult[] = [];
    for (const seed of seeds) runs.push(runLeague({ clubs, seasons, seed, ruleset, scenario }));
    groups.push({ ruleset: rs, scenario: sc, runs });
    const n = runs.reduce((s, r) => s + r.seasons.length, 0);
    const ms = runs.reduce((s, r) => s + r.ms, 0);
    console.log(
      `${rs}/${sc}: ${n} seasons in ${(ms / 1000).toFixed(1)} s, ${runs.flatMap((r) => r.failures).length} invariant failures`,
    );
  }
}
const summaries = groups.map(summarise);
const command = `bun run economy:harness ${process.argv.slice(2).join(" ")}`.trim();
mkdirSync(out, { recursive: true });
writeFileSync(
  `${out}/runs.json`,
  JSON.stringify(groups.map((g) => ({ ...g, runs: g.runs.map((r) => ({ ...r, deals: r.deals.length })) }))),
);
writeFileSync(`${out}/seasons.csv`, csv(groups));
writeFileSync(`${out}/summary.json`, JSON.stringify(summaries, null, 2));
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, markdown(summaries, { command, clubs, seasons, seeds }));
const total = summaries.reduce((s, x) => s + x.seasons, 0);
console.log(`${total} seasons in ${((performance.now() - t0) / 1000).toFixed(1)} s; report: ${reportPath}`);
if (has("replay")) for (const f of summaries.flatMap((s) => s.failures)) console.log(JSON.stringify(f));
const gated = has("allow-failures") ? [] : summaries.flatMap((s) => s.failures);
process.exit(gated.length ? 1 : 0);
