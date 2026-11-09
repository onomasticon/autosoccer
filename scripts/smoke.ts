/**
 * Boot smoke test (used by CI): runs migrations, starts the API and the *built*
 * web app on spare ports, and checks that the homepage renders live API health.
 */
import { RR_SERVE, run, spawn, stopAll, waitFor } from "./proc.ts";

const apiPort = "4100";
const webPort = "3100";
let ok = false;
try {
  if (run(["bun", "packages/db/src/migrate-cli.ts"]) !== 0) throw new Error("migrations failed");
  spawn("api", ["bun", "src/api.ts"], { cwd: "apps/server", env: { API_PORT: apiPort } });
  spawn("web", [RR_SERVE, "./build/server/index.js"], {
    cwd: "apps/web",
    env: { PORT: webPort, API_URL: `http://localhost:${apiPort}`, NODE_ENV: "production" },
  });
  const health = await (await waitFor(`http://localhost:${apiPort}/health`)).json();
  if (health.status !== "ok") throw new Error(`API unhealthy: ${JSON.stringify(health)}`);
  const html = await (await waitFor(`http://localhost:${webPort}/`)).text();
  const status = /data-testid="api-status"[^>]*>(.*?)<\/p>/s.exec(html)?.[1]?.replace(/<!-- -->/g, "");
  if (!status?.startsWith("API: ok"))
    throw new Error(`homepage did not render API health (got ${JSON.stringify(status)})`);
  console.log("smoke: api healthy, web rendered API status — OK");
  ok = true;
} catch (e) {
  console.error(`smoke failed: ${(e as Error).message}`);
} finally {
  stopAll();
}
process.exit(ok ? 0 : 1);
