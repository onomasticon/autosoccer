/**
 * End-to-end unattended season on a fresh database, driven exactly as in production:
 * real worker processes (each running the leader-elected scheduler), kickoff times, AI
 * managers with an enforced budget, the newsroom, replays and the public site.
 *
 * Chaos step: one worker is SIGKILLed mid-season and replaced; its in-flight job must be
 * reclaimed after the lease expires. Afterwards everything is verified and a report is
 * written to docs/operations/e2e-report.md.
 *
 *   bun run season:e2e [--interval-sec 4] [--budget 1.00] [--keep] [--no-site]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createTestDatabase } from "@autosoccer/db/testing";
import { FileReplayStore, runMatch, sha256 } from "@autosoccer/sim-adapter";
import { formatUsd } from "../apps/server/src/modules/agents/pricing.ts";
import { seedManagers } from "../apps/server/src/modules/agents/service.ts";
import { matchFacts, roundFacts } from "../apps/server/src/modules/editorial/facts.ts";
import { checkGrounding } from "../apps/server/src/modules/editorial/grounding.ts";
import { seedJournalists } from "../apps/server/src/modules/editorial/service.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { createSeason, seasonResults, seasonStandings, seedTeams } from "../apps/server/src/modules/league/service.ts";
import { budgetSummary } from "../apps/server/src/modules/ledger/service.ts";
import { opsStatus } from "../apps/server/src/modules/ops/status.ts";
import { RR_SERVE, spawn, stopAll, waitFor } from "./proc.ts";

const arg = (n: string, d: string) =>
  process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d;
const flag = (n: string) => process.argv.includes(`--${n}`);
const intervalSec = Number(arg("interval-sec", "4"));
const budget = Number(arg("budget", "1.00"));
const SEED = 20261109;
const MODEL = process.env.MANAGER_MODEL ?? "claude-opus-5-5";
const provider = process.env.LLM_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "offline");
const replayDir = new URL("../out/e2e/replays", import.meta.url).pathname;
rmSync(replayDir, { recursive: true, force: true });
mkdirSync(replayDir, { recursive: true });

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const t = await createTestDatabase();
const db = t.db;
console.log(
  `e2e database ${t.name} · llm ${provider} (${MODEL}) · rounds every ${intervalSec}s · budget $${budget.toFixed(2)}/team\n`,
);
const t0 = Date.now();
let ok = false;
try {
  // ── seed ────────────────────────────────────────────────────────────────────
  await seedTeams(db);
  const { seasonId } = await createSeason(db, {
    slug: "season-1",
    name: "Season 1",
    seed: SEED,
    budgetPerTeamMicroUsd: Math.round(budget * 1_000_000),
    teamSlugs: SEED_TEAMS.map((x) => x.slug),
    startsAt: new Date(Date.now() + 2000),
    roundIntervalMinutes: intervalSec / 60,
  });
  await seedManagers(db, seasonId, MODEL);
  await seedJournalists(db, process.env.EDITORIAL_MODEL ?? MODEL);

  // ── run: two workers, each with the scheduler; kill one mid-season ───────────
  const env = {
    DATABASE_URL: t.url,
    REPLAY_DIR: replayDir,
    LLM_PROVIDER: provider,
    LOG_LEVEL: "warn",
    WORKER_POLL_MS: "200",
    WORKER_LEASE_MS: "8000",
    SCHEDULER_INTERVAL_MS: "500",
    SCHEDULE_RESPECT_KICKOFF: "true",
  };
  const w1 = spawn("worker-1", ["bun", "src/worker.ts"], { cwd: "apps/server", env });
  spawn("worker-2", ["bun", "src/worker.ts"], { cwd: "apps/server", env });
  let killed = false;
  let lastLine = "";
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const s = await opsStatus(db);
    const season = s.seasons.find((x) => x.slug === "season-1")!;
    const line = `  ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  ${season.fixturesCompleted}/12 played · round ${season.nextRound ?? "–"} · workers alive ${s.workers.filter((w) => w.alive && w.role === "worker").length}`;
    if (line.replace(/^\s+\d+s/, "") !== lastLine.replace(/^\s+\d+s/, "")) console.log(line);
    lastLine = line;
    if (!killed && season.fixturesCompleted >= 4) {
      const [running] = await db<{ n: number }[]>`select count(*)::int as n from jobs where status = 'running'`;
      if (running!.n > 0 || season.fixturesCompleted >= 6) {
        console.log(`  chaos: SIGKILL worker-1 with ${running!.n} job(s) running; starting worker-3`);
        w1.kill("SIGKILL");
        spawn("worker-3", ["bun", "src/worker.ts"], { cwd: "apps/server", env });
        killed = true;
      }
    }
    if (season.status === "completed") break;
    if (Date.now() > deadline) throw new Error("season did not complete within 15 minutes");
    await Bun.sleep(1000);
  }
  const runSec = (Date.now() - t0) / 1000;
  // let post-match reviews and articles for the last round drain
  for (let i = 0; i < 120; i++) {
    const [p] = await db<{ n: number }[]>`select count(*)::int as n from jobs where status in ('queued', 'running')`;
    if (p!.n === 0) break;
    await Bun.sleep(500);
  }
  const drainedSec = (Date.now() - t0) / 1000;
  console.log(
    `\nseason completed in ${runSec.toFixed(1)} s (all follow-up jobs drained at ${drainedSec.toFixed(1)} s)\n`,
  );

  // ── verify ───────────────────────────────────────────────────────────────────
  const matches = await db<
    {
      id: string;
      fixture_id: string;
      request: never;
      final_hash: string;
      home_score: number;
      away_score: number;
      diagnostics: { wallMs: number };
      started_at: Date;
      completed_at: Date;
      ticks: number;
    }[]
  >`
    select id, fixture_id, request, final_hash, home_score, away_score, diagnostics, started_at, completed_at, ticks from matches where status = 'completed'`;
  check(
    "12 fixtures played, each exactly once",
    matches.length === 12 && new Set(matches.map((m) => m.fixture_id)).size === 12,
    `${matches.length} matches`,
  );
  const [failedJobs] = await db<{ n: number }[]>`select count(*)::int as n from jobs where status = 'failed'`;
  const [reclaimed] = await db<
    { n: number }[]
  >`select count(*)::int as n from jobs where attempts > 1 and status = 'succeeded'`;
  check(
    "no permanently failed jobs; crashed work was reclaimed",
    failedJobs!.n === 0,
    `${reclaimed!.n} job(s) succeeded on a retry after the worker kill`,
  );

  const order = await db<{ round: number; first: Date; last: Date }[]>`
    select f.round, min(m.started_at) as first, max(m.completed_at) as last from matches m join fixtures f on f.id = m.fixture_id group by f.round order by f.round`;
  check(
    "rounds ran strictly in order",
    order.every((r, i) => i === 0 || r.first >= order[i - 1]!.last),
    order.map((r) => `R${r.round}`).join(" → "),
  );
  const sched = await db<{ late: number }[]>`
    select count(*)::int as late from matches m join fixtures f on f.id = m.fixture_id where m.started_at < f.scheduled_at`;
  check("no match started before its scheduled kickoff", sched[0]!.late === 0);

  // determinism: re-simulate every stored request
  const reStore = new FileReplayStore(new URL("../out/e2e/rerun", import.meta.url).pathname);
  let same = 0;
  for (const m of matches)
    if ((await runMatch(m.request, { store: reStore })).result.finalHash === m.final_hash) same++;
  check("every match reproduces bit-for-bit from its stored request", same === 12, `${same}/12 final hashes match`);

  const store = new FileReplayStore(replayDir);
  const reps = await db<
    { uri: string; sha256: string; verified: boolean; final_hash: string; byte_size: number }[]
  >`select uri, sha256, verified, final_hash, byte_size from replay_artifacts`;
  let repOk = 0;
  for (const r of reps) {
    const bytes = await store.get(r.uri);
    const file = JSON.parse(gunzipSync(bytes).toString());
    if (r.verified && sha256(bytes) === r.sha256 && file.finalHash === r.final_hash) repOk++;
  }
  check(
    "12 replays stored, checksummed and hash-verified",
    repOk === 12,
    `${repOk}/12 · ${(reps.reduce((a, r) => a + r.byte_size, 0) / 1024 / 1024).toFixed(1)} MB`,
  );

  const { rows } = await seasonStandings(db, seasonId);
  const results = await seasonResults(db, seasonId);
  const draws = results.filter((r) => r.homeGoals === r.awayGoals).length;
  check(
    "standings reconcile with results",
    rows.reduce((a, r) => a + r.points, 0) === 3 * (12 - draws) + 2 * draws &&
      rows.every((r) => r.played === 6) &&
      rows.reduce((a, r) => a + r.goalDifference, 0) === 0,
  );

  const runs = await db<
    { purpose: string; status: string; n: number }[]
  >`select purpose, status, count(*)::int as n from agent_runs group by 1, 2 order by 1, 2`;
  const n = (p: string, s: string) => runs.find((r) => r.purpose === p && r.status === s)?.n ?? 0;
  check(
    "every manager decided before and reviewed after each match",
    n("pre_match", "succeeded") + n("pre_match", "skipped_budget") === 24 &&
      n("post_match", "succeeded") + n("post_match", "skipped_budget") === 24,
    runs.map((r) => `${r.purpose}:${r.status}=${r.n}`).join(", "),
  );
  const early = await db<{ n: number }[]>`
    select count(*)::int as n from agent_runs r join matches m on m.fixture_id = r.fixture_id
    where r.agent_kind = 'manager' and ((r.purpose = 'pre_match' and r.finished_at > m.started_at) or (r.purpose = 'post_match' and r.started_at < m.completed_at))`;
  check("no manager LLM call overlapped a simulation", early[0]!.n === 0);
  const [adapt] = await db<
    { n: number }[]
  >`select count(distinct (team_id, deployment))::int as n from tactical_revisions where status = 'valid'`;
  check("managers adapted their tactics during the season", adapt!.n > 4, `${adapt!.n} distinct team setups deployed`);
  const budgetRows = await budgetSummary(db, seasonId);
  const [charges] = await db<
    { c: number }[]
  >`select (-coalesce(sum(amount_micro_usd), 0))::bigint as c from compute_transactions where kind = 'charge'`;
  const [costs] = await db<
    { c: number }[]
  >`select coalesce(sum(cost_micro_usd), 0)::bigint as c from agent_runs where agent_kind = 'manager'`;
  check(
    "budgets enforced: no team overspent, ledger reconciles with run costs",
    budgetRows.every((r) => r.spentMicroUsd <= r.grantedMicroUsd && r.reservedMicroUsd === 0) &&
      Number(charges!.c) === Number(costs!.c),
    budgetRows.map((r) => formatUsd(r.spentMicroUsd)).join(" / "),
  );

  const arts = await db<
    {
      kind: string;
      status: string;
      match_id: string | null;
      citations: Array<{ factId: string }>;
      headline: string;
      standfirst: string;
      body: string;
      slug: string;
      agent_run_id: string;
    }[]
  >`
    select kind, status, match_id, citations, headline, standfirst, body, slug, agent_run_id from articles`;
  const published = arts.filter((a) => a.status === "published");
  let grounded = 0;
  for (const a of published) {
    if (a.match_id) {
      const f = await matchFacts(db, a.match_id);
      if (
        checkGrounding({ ...a, citations: a.citations.map((c) => ({ ...c, text: "" })) }, f, {
          requireScoreFact: `match:${a.match_id}:score`,
        }).length === 0
      )
        grounded++;
    } else {
      const [r] = await db<
        { key: string }[]
      >`select idempotency_key as key from agent_runs where id = ${a.agent_run_id}`;
      const round = Number(r!.key.split(":").at(-1));
      const { matchIds: _m, ...f } = await roundFacts(db, seasonId, round);
      if (checkGrounding({ ...a, citations: a.citations.map((c) => ({ ...c, text: "" })) }, f).length === 0) grounded++;
    }
  }
  check(
    "newsroom: a grounded report per match and a piece per round",
    published.filter((a) => a.kind === "match_report").length === 12 &&
      published.length === 18 &&
      grounded === published.length,
    `${published.length} published · ${grounded} re-pass the fact checker · ${arts.length - published.length} rejected`,
  );

  // public site against this database
  let pagesOk = 0;
  const pages: string[] = [];
  if (!flag("no-site")) {
    const apiPort = "4400";
    const webPort = "3400";
    spawn("api", ["bun", "src/api.ts"], {
      cwd: "apps/server",
      env: { DATABASE_URL: t.url, API_PORT: apiPort, REPLAY_DIR: replayDir, LOG_LEVEL: "warn" },
    });
    spawn("web", [RR_SERVE, "./build/server/index.js"], {
      cwd: "apps/web",
      env: { PORT: webPort, API_URL: `http://localhost:${apiPort}`, NODE_ENV: "production" },
    });
    await waitFor(`http://localhost:${apiPort}/health`);
    await waitFor(`http://localhost:${webPort}/`);
    const team = SEED_TEAMS[0]!.slug;
    pages.push(
      "/",
      "/fixtures",
      "/table",
      "/teams",
      `/teams/${team}`,
      `/matches/${matches[0]!.id}`,
      `/matches/${matches[0]!.id}/replay.json.gz`,
      "/news",
      `/news/${published[0]!.slug}`,
      "/journalists",
    );
    for (const p of pages) {
      const res = await fetch(`http://localhost:${webPort}${p}`);
      if (res.ok) pagesOk++;
      else console.log(`    ${p} → ${res.status}`);
    }
    check(
      "public site serves the whole season",
      pagesOk === pages.length,
      `${pagesOk}/${pages.length} pages HTTP 200 (incl. replay download)`,
    );
  }

  // ── performance ──────────────────────────────────────────────────────────────
  const wall = matches.map((m) => m.diagnostics.wallMs).sort((a, b) => a - b);
  const simSec = matches[0]!.ticks / 60;
  const kinds = await db<{ kind: string; n: number; avg: number; p95: number }[]>`
    select kind, count(*)::int as n,
      avg(extract(epoch from finished_at - created_at) * 1000)::int as avg,
      percentile_cont(0.95) within group (order by extract(epoch from finished_at - created_at) * 1000)::int as p95
    from jobs where status = 'succeeded' group by kind order by kind`;
  const perf = {
    seasonWallSec: runSec,
    drainedSec,
    matchWallMs: { min: wall[0], median: wall[6], max: wall.at(-1) },
    realtimeFactor: +(simSec / (wall[6]! / 1000)).toFixed(0),
    jobs: kinds,
  };
  ok = checks.every((c) => c.ok);

  // ── report ───────────────────────────────────────────────────────────────────
  const names = new Map(
    (await db<{ id: string; name: string }[]>`select id, name from teams`).map((x) => [x.id, x.name]),
  );
  const table = rows.map(
    (r) =>
      `| ${r.position} | ${names.get(r.team)} | ${r.played} | ${r.won} | ${r.drawn} | ${r.lost} | ${r.goalsFor} | ${r.goalsAgainst} | ${r.goalDifference > 0 ? "+" : ""}${r.goalDifference} | ${r.points} |`,
  );
  const report = `# End-to-end season report

Generated by \`bun run season:e2e\` on ${new Date().toISOString()} (${process.platform}, Bun ${Bun.version}).
Fresh database · seed ${SEED} · LLM provider **${provider}** (${MODEL}) · budget $${budget.toFixed(2)}/team ·
rounds every ${intervalSec}s with kickoff times respected · 2 worker processes (each running the leader-elected scheduler),
one SIGKILLed mid-season and replaced.

## Checks
| | Check | Detail |
| --- | --- | --- |
${checks.map((c) => `| ${c.ok ? "✅" : "❌"} | ${c.name} | ${c.detail} |`).join("\n")}

## Final table
| # | Team | P | W | D | L | GF | GA | GD | Pts |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${table.join("\n")}

## Performance
- Season wall time: **${runSec.toFixed(1)} s** (${intervalSec}s between rounds); all follow-up jobs drained at ${drainedSec.toFixed(1)} s.
- Match simulation (${simSec.toFixed(0)} s of simulated play, two sandboxed controllers): min ${perf.matchWallMs.min} ms · median ${perf.matchWallMs.median} ms · max ${perf.matchWallMs.max} ms → **~${perf.realtimeFactor}× real time**.
- Job latency (enqueue → finished, includes queueing behind other jobs):

| Job | Count | Avg ms | p95 ms |
| --- | ---: | ---: | ---: |
${kinds.map((k) => `| ${k.kind} | ${k.n} | ${k.avg} | ${k.p95} |`).join("\n")}

## Compute spend (managers)
| Team | Spent | Remaining | Paid runs |
| --- | ---: | ---: | ---: |
${budgetRows.map((r) => `| ${names.get(r.teamId)} | ${formatUsd(r.spentMicroUsd)} | ${formatUsd(r.remainingMicroUsd)} | ${r.runs} |`).join("\n")}
${provider === "offline" ? "\n_Offline provider: token counts are estimated and priced as the configured model; no model was called._\n" : ""}`;
  mkdirSync(new URL("../docs/operations", import.meta.url).pathname, { recursive: true });
  writeFileSync(new URL("../docs/operations/e2e-report.md", import.meta.url).pathname, report);
  writeFileSync(
    new URL("../out/e2e/report.json", import.meta.url).pathname,
    JSON.stringify({ checks, perf, provider, seed: SEED, pages }, null, 2),
  );
  console.log(`\n${ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"} · report: docs/operations/e2e-report.md`);
  if (flag("keep")) console.log(`database kept: ${t.url}`);
} catch (e) {
  console.error(`e2e failed: ${(e as Error).stack}`);
} finally {
  stopAll();
  await Bun.sleep(500);
  if (!flag("keep")) await t.drop();
  else await db.end();
}
process.exit(ok ? 0 : 1);
