/**
 * Operator CLI against DATABASE_URL.
 *   bun run ops status                       # seasons, queue, failures, workers, spend
 *   bun run ops requeue [--kind match.play]  # retry permanently failed jobs (after fixing the cause)
 *   bun run ops tick [--ignore-kickoff]      # run one scheduler tick by hand
 *   bun run ops editorial:audit [--json]     # re-check published articles against the fact checker (read-only)
 *   bun run ops reschedule --cadence weekly [--season season-1] [--from ISO] [--dry-run]
 *                                            # move rounds that haven't started onto a cadence (UTC);
 *                                            # started rounds keep their recorded kickoffs
 */
import { createDb } from "@autosoccer/db";
import { loadConfig } from "../apps/server/src/config.ts";
import { createLogger } from "../apps/server/src/log.ts";
import { formatUsd } from "../apps/server/src/modules/agents/pricing.ts";
import { auditPublishedArticles } from "../apps/server/src/modules/editorial/audit.ts";
import { parseCadence, rescheduleUnplayed } from "../apps/server/src/modules/league/cadence.ts";
import { seasonBySlug } from "../apps/server/src/modules/league/read.ts";
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
    if (s.budget) {
      const e = s.budget.editorial;
      console.log(
        `\neditorial budget (${s.budget.season}): ${formatUsd(e.spentMicroUsd)} spent of ${formatUsd(e.grantedMicroUsd)} · ${formatUsd(e.remainingMicroUsd)} left${e.reservedMicroUsd ? ` · ${formatUsd(e.reservedMicroUsd)} reserved` : ""}`,
      );
    }
  } else if (cmd === "requeue") {
    console.log(`requeued ${await requeueFailed(db, { kind: opt("kind") })} failed job(s)`);
  } else if (cmd === "tick") {
    const r = await schedulerTick(db, { respectSchedule: !flag("ignore-kickoff"), log: createLogger("info") });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === "editorial:audit") {
    const findings = await auditPublishedArticles(db);
    if (flag("json")) console.log(JSON.stringify(findings, null, 2));
    else {
      for (const f of findings) {
        console.log(`✗ ${f.slug} [${f.kind}] ${f.headline}`);
        for (const e of f.errors) console.log(`    - ${e}`);
      }
      console.log(`${findings.length} published article(s) fail the current checks`);
    }
  } else if (cmd === "reschedule") {
    const season = await seasonBySlug(db, opt("season") ?? "season-1");
    if (!season) throw new Error("no such season");
    const r = await rescheduleUnplayed(
      db,
      season.id,
      parseCadence(opt("cadence") ?? "weekly", Number(opt("interval") ?? 60)),
      {
        from: opt("from") ? new Date(opt("from")!) : undefined,
        dryRun: flag("dry-run"),
      },
    );
    console.log(
      `${flag("dry-run") ? "would move" : "moved"} ${r.changes.length} round(s); untouched (started): ${r.untouchedRounds.join(", ") || "none"}`,
    );
    for (const c of r.changes) console.log(`  R${c.round}: ${c.from ?? "unscheduled"} → ${c.to}`);
  } else throw new Error(`unknown command ${cmd}`);
} finally {
  await db.end();
}
