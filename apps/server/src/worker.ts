/** Background job worker: plays matches (and, later, agent and editorial jobs). */
import { createDb } from "@autosoccer/db";
import { FileReplayStore } from "@autosoccer/sim-adapter";
import { loadConfig } from "./config.ts";
import { createWorker } from "./jobs/worker.ts";
import { createLogger } from "./log.ts";
import { MATCH_JOB, matchJobHandler } from "./modules/matches/service.ts";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, { svc: "worker" });
const db = createDb(config.DATABASE_URL, { max: 4 });
const store = new FileReplayStore(config.REPLAY_DIR);

const worker = createWorker({
  db,
  log,
  pollMs: config.WORKER_POLL_MS,
  handlers: { [MATCH_JOB]: matchJobHandler({ db, store }) },
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("stopping", { signal: sig });
    worker.stop();
  });
}
await worker.start();
await db.end({ timeout: 5 });
