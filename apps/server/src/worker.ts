/** Background job worker: plays matches and runs manager decisions/reviews. */
import { createDb } from "@autosoccer/db";
import { FileReplayStore } from "@autosoccer/sim-adapter";
import { loadConfig } from "./config.ts";
import { buildHandlers } from "./jobs/handlers.ts";
import { createWorker } from "./jobs/worker.ts";
import { createLogger } from "./log.ts";
import { managerLlm } from "./modules/agents/index.ts";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, { svc: "worker" });
const db = createDb(config.DATABASE_URL, { max: 4 });
const store = new FileReplayStore(config.REPLAY_DIR);
log.info("llm provider", { provider: config.LLM_PROVIDER, model: config.MANAGER_MODEL });

const worker = createWorker({
  db,
  log,
  pollMs: config.WORKER_POLL_MS,
  handlers: buildHandlers({ db, store, llm: managerLlm(config), log }),
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("stopping", { signal: sig });
    worker.stop();
  });
}
await worker.start();
await db.end({ timeout: 5 });
