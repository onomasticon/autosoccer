import { existsSync, readFileSync } from "node:fs";
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
  /** "anthropic" calls Claude; "offline" uses the deterministic rule-based stand-in. Default: anthropic if a key is set. */
  LLM_PROVIDER: z.enum(["anthropic", "offline"]).optional(),
  MANAGER_MODEL: z.string().default("claude-opus-5-5"),
  EDITORIAL_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type ServerConfig = z.infer<typeof Env>;

/** Fills unset variables from the repo-root .env (processes may start in any directory). */
export function loadDotEnv(path = resolve(REPO_ROOT, ".env"), env: Record<string, string | undefined> = process.env) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && env[m[1]!] === undefined) env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  if (env === process.env) loadDotEnv();
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${issues}\nSee .env.example.`);
  }
  const data = parsed.data;
  data.LLM_PROVIDER ??= data.ANTHROPIC_API_KEY ? "anthropic" : "offline";
  if (!isAbsolute(data.REPLAY_DIR)) data.REPLAY_DIR = resolve(REPO_ROOT, data.REPLAY_DIR);
  return data;
}
