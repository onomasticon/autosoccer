import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

/** Repository root; relative paths in the environment resolve against it. */
export const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

const Env = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  REPLAY_DIR: z.string().default("data/replays"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
});

export type ServerConfig = z.infer<typeof Env>;

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${issues}\nSee .env.example.`);
  }
  const data = parsed.data;
  if (!isAbsolute(data.REPLAY_DIR)) data.REPLAY_DIR = resolve(REPO_ROOT, data.REPLAY_DIR);
  return data;
}
