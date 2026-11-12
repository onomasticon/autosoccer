import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { FileReplayStore, R2ReplayStore, type ReplayStore } from "@autosoccer/sim-adapter";
import { z } from "zod";

/** Repository root; relative paths in the environment resolve against it. */
export const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

const Env = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** CA certificate (PEM file) to verify the database's TLS certificate; use with ?sslmode=verify-full. */
  DATABASE_CA_CERT_FILE: z.string().optional(),
  /** Connection pool sizes. Keep api + workers × worker pool under the database limit. The scheduler lock holds one worker connection, so worker pools need ≥ 2. */
  API_DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  WORKER_DB_POOL_MAX: z.coerce.number().int().min(2).max(100).default(6),
  /** Where replays are stored: "file" (REPLAY_DIR, shared volume) or "r2" (Cloudflare R2 / any S3-compatible store). */
  REPLAY_STORE: z.enum(["file", "r2"]).default("file"),
  REPLAY_DIR: z.string().default("data/replays"),
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  /** "anthropic" calls Claude; "offline" uses the deterministic rule-based stand-in. Default: anthropic if a key is set. */
  LLM_PROVIDER: z.enum(["anthropic", "offline"]).optional(),
  MANAGER_MODEL: z.string().default("claude-opus-5-5"),
  EDITORIAL_MODEL: z.string().default("claude-opus-5-5"),
  /** Run the round scheduler inside the worker process (leader-elected across workers). */
  SCHEDULER_ENABLED: z.enum(["true", "false"]).default("true"),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  /** Wait for each round's scheduled kickoff time; "false" plays rounds back to back (demos). */
  SCHEDULE_RESPECT_KICKOFF: z.enum(["true", "false"]).default("true"),
  /** Start the next season automatically when the latest one completes (same clubs, budgets and spacing). */
  SEASON_ROLLOVER: z.enum(["true", "false"]).default("true"),
  /** Minutes between rounds of rolled-over seasons. 240 = one season per day (6 rounds + a 4-hour break). */
  SEASON_ROUND_MINUTES: z.coerce.number().int().min(5).default(240),
  OPS_TOKEN: z.string().optional(),
  /** A running job not finished within this lease is reclaimed by another worker (crash recovery). */
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(300_000),
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
  if (data.REPLAY_STORE === "r2") {
    const missing = (["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const).filter(
      (k) => !data[k],
    );
    if (missing.length) throw new Error(`REPLAY_STORE=r2 needs ${missing.join(", ")}. See .env.example.`);
  }
  data.LLM_PROVIDER ??= data.ANTHROPIC_API_KEY ? "anthropic" : "offline";
  if (!isAbsolute(data.REPLAY_DIR)) data.REPLAY_DIR = resolve(REPO_ROOT, data.REPLAY_DIR);
  if (data.DATABASE_CA_CERT_FILE && !isAbsolute(data.DATABASE_CA_CERT_FILE))
    data.DATABASE_CA_CERT_FILE = resolve(REPO_ROOT, data.DATABASE_CA_CERT_FILE);
  return data;
}

/** The configured replay store (shared by the API, which reads, and workers, which write). */
export function replayStore(config: ServerConfig): ReplayStore {
  if (config.REPLAY_STORE === "r2")
    return new R2ReplayStore({
      endpoint: config.R2_ENDPOINT!,
      bucket: config.R2_BUCKET!,
      accessKeyId: config.R2_ACCESS_KEY_ID!,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
    });
  return new FileReplayStore(config.REPLAY_DIR);
}
