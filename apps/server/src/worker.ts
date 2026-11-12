/**
 * Worker process: runs background jobs (matches, manager decisions/reviews, articles) and,
 * unless disabled, the leader-elected round scheduler. Run several for throughput/HA.
 */
import { createDb } from "@autosoccer/db";
import { loadConfig, replayStore } from "./config.ts";
import { buildHandlers } from "./jobs/handlers.ts";
import { createWorker } from "./jobs/worker.ts";
import { createLogger } from "./log.ts";
import { editorialLlm, managerLlm } from "./modules/agents/index.ts";
import { heartbeat, startScheduler } from "./modules/ops/scheduler.ts";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, { svc: "worker" });
const db = createDb(config.DATABASE_URL, { max: config.WORKER_DB_POOL_MAX, caFile: config.DATABASE_CA_CERT_FILE });
const store = replayStore(config);
log.info("replay store", { kind: config.REPLAY_STORE });
log.info("llm provider", {
  provider: config.LLM_PROVIDER,
  manager: config.MANAGER_MODEL,
  editorial: config.EDITORIAL_MODEL,
});

const worker = createWorker({
  db,
  log,
  pollMs: config.WORKER_POLL_MS,
  leaseMs: config.WORKER_LEASE_MS,
  handlers: buildHandlers({ db, store, llm: managerLlm(config), editorialLlm: editorialLlm(config), log }),
});

const beat = setInterval(() => {
  heartbeat(db, worker.workerId, "worker", worker.stats()).catch((e) =>
    log.warn("heartbeat failed", { error: (e as Error).message }),
  );
}, 5000);
await heartbeat(db, worker.workerId, "worker", worker.stats());

const scheduler =
  config.SCHEDULER_ENABLED === "true"
    ? startScheduler(db, {
        intervalMs: config.SCHEDULER_INTERVAL_MS,
        respectSchedule: config.SCHEDULE_RESPECT_KICKOFF === "true",
        rollover:
          config.SEASON_ROLLOVER === "true"
            ? {
                managerModel: config.MANAGER_MODEL,
                editorialModel: config.EDITORIAL_MODEL,
                roundMinutes: config.SEASON_ROUND_MINUTES,
              }
            : undefined,
        log: log.child({ component: "scheduler" }),
        schedulerId: `${worker.workerId}:scheduler`,
      })
    : null;

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("stopping", { signal: sig });
    worker.stop();
  });
}
await worker.start();
clearInterval(beat);
await scheduler?.stop();
await db.end({ timeout: 5 });
