import { createDb } from "@autosoccer/db";
import { FileReplayStore } from "@autosoccer/sim-adapter";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createLogger } from "./log.ts";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, { svc: "api" });
const db = createDb(config.DATABASE_URL);
const app = createApp({ db, log, store: new FileReplayStore(config.REPLAY_DIR), opsToken: config.OPS_TOKEN });

const server = Bun.serve({ port: config.API_PORT, fetch: app.fetch });
log.info("api listening", { url: server.url.toString() });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    log.info("shutting down", { signal: sig });
    server.stop();
    await db.end({ timeout: 5 });
    process.exit(0);
  });
}
