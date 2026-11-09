/**
 * One-command local environment: `bun run dev` (watch mode) or `bun run start` (production build).
 * Creates .env from .env.example, starts Postgres (docker compose), applies migrations,
 * then runs the API and the web app together.  Pass --no-db to use an existing DATABASE_URL.
 */
import { copyFileSync, existsSync } from "node:fs";
import { RR_CLI, RR_SERVE, run, spawn, stopAll, waitFor } from "./proc.ts";

const prod = process.argv.includes("--prod");
const noDb = process.argv.includes("--no-db");

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("created .env from .env.example — restart to pick up edits");
  for (const line of (await Bun.file(".env").text()).split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}

if (!noDb && run(["docker", "compose", "up", "-d", "--wait", "db"]) !== 0) {
  console.error("Could not start Postgres with docker compose. Is Docker running? (or pass --no-db)");
  process.exit(1);
}
if (run(["bun", "packages/db/src/migrate-cli.ts"]) !== 0) process.exit(1);

const apiPort = process.env.API_PORT ?? "4000";
const webPort = process.env.WEB_PORT ?? "3000";

if (prod) {
  if (run(["bun", "run", "build"]) !== 0) process.exit(1);
  spawn("api", ["bun", "src/api.ts"], { cwd: "apps/server" });
  spawn("web", [RR_SERVE, "./build/server/index.js"], {
    cwd: "apps/web",
    env: { PORT: webPort, NODE_ENV: "production" },
  });
} else {
  spawn("api", ["bun", "--watch", "src/api.ts"], { cwd: "apps/server" });
  spawn("web", [RR_CLI, "dev"], { cwd: "apps/web" });
}

try {
  await waitFor(`http://localhost:${apiPort}/health`);
  await waitFor(`http://localhost:${webPort}/`);
  console.log(
    `\n  Auto Soccer is up:\n    web  http://localhost:${webPort}\n    api  http://localhost:${apiPort}/health\n`,
  );
} catch (e) {
  console.error((e as Error).message);
  stopAll();
  process.exit(1);
}
