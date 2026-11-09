/**
 * Operator CLI against DATABASE_URL.
 *   bun run ops status                       # seasons, queue, failures, workers, spend
 *   bun run ops requeue [--kind match.play]  # retry permanently failed jobs (after fixing the cause)
 *   bun run ops tick [--ignore-kickoff]      # run one scheduler tick by hand
 */
import { createDb } from "@autosoccer/db";
import { loadConfig } from "../apps/server/src/config.ts";
import { createLogger } from "../apps/server/src/log.ts";
import { formatUsd } from "../apps/server/src/modules/agents/pricing.ts";
import { schedulerTick } from "../apps/server/src/modules/ops/scheduler.ts";
import { opsStatus, requeueFailed } from "../apps/server/src/modules/ops/status.ts";

const cmd = process.argv[2] ?? "status";
const flag = (n: string) => process.argv.includes(`--${n}`);
const opt = (n: string) => (flag(n) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: 2, caFile: config.DATABASE_CA_CERT_FILE });
try {
  if (cmd === "status") {
    const s = await opsStatus(db);
    console.log(`healthy: ${s.healthy ? "yes" : "NO"}  (${s.generatedAt})\n\nseasons`);
    for (const x of s.seasons)
      console.log(
        `  ${x.slug.padEnd(12)} ${x.status.padEnd(10)} ${x.fixturesCompleted}/${x.fixturesTotal} played${x.nextRound ? ` · next round ${x.nextRound}${x.nextKickoff ? ` at ${x.nextKickoff}` : ""}` : ""}`,
      );
    console.log("\njobs");
    for (const j of s.jobs.byKindAndStatus) console.log(`  ${j.kind.padEnd(22)} ${j.status.padEnd(10)} ${j.n}`);
    console.log(`  retrying: ${s.jobs.retrying}`);
    for (const f of s.jobs.failed) console.log(`  FAILED ${f.key} (attempts ${f.attempts}): ${f.error}`);
    console.log("\nworkers");
    for (const w of s.workers)
      console.log(
        `  ${w.alive ? "●" : "○"} ${w.id} [${w.role}] seen ${w.lastSeenSecondsAgo}s ago · ok ${w.succeeded} · failed ${w.failed}`,
      );
    console.log("\nagents");
    for (const a of s.agents)
      console.log(
        `  ${a.kind.padEnd(10)} ${a.status.padEnd(15)} ${String(a.runs).padStart(4)} runs  ${formatUsd(a.costMicroUsd)}`,
      );
  } else if (cmd === "requeue") {
    console.log(`requeued ${await requeueFailed(db, { kind: opt("kind") })} failed job(s)`);
  } else if (cmd === "tick") {
    const r = await schedulerTick(db, { respectSchedule: !flag("ignore-kickoff"), log: createLogger("info") });
    console.log(JSON.stringify(r, null, 2));
  } else throw new Error(`unknown command ${cmd}`);
} finally {
  await db.end();
}
