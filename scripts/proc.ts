/** Tiny process supervisor helpers shared by the dev/start/smoke scripts. */
import type { Subprocess } from "bun";

const COLORS = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m"];
const children: Subprocess[] = [];

export function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): number {
  const r = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  return r.exitCode;
}

async function pipe(stream: ReadableStream<Uint8Array>, prefix: string) {
  const decoder = new TextDecoder();
  let buf = "";
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) process.stdout.write(`${prefix} ${line}\n`);
  }
  if (buf) process.stdout.write(`${prefix} ${buf}\n`);
}

export function spawn(name: string, cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const color = COLORS[children.length % COLORS.length];
  const prefix = `${color}[${name}]\x1b[0m`;
  const p = Bun.spawn(cmd, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdout: "pipe", stderr: "pipe" });
  children.push(p);
  void pipe(p.stdout, prefix);
  void pipe(p.stderr, prefix);
  return p;
}

export function stopAll() {
  for (const c of children) if (!c.killed) c.kill("SIGTERM");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopAll();
    process.exit(0);
  });
}

export async function waitFor(url: string, timeoutMs = 60_000): Promise<Response> {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await Bun.sleep(300);
  }
  throw new Error(`Timed out waiting for ${url} (${last})`);
}

/** Run the React Router binaries directly (not via `bun run`) so SIGTERM reaches the server process. */
export const RR_SERVE = new URL("../node_modules/.bin/react-router-serve", import.meta.url).pathname;
export const RR_CLI = new URL("../node_modules/.bin/react-router", import.meta.url).pathname;
