/**
 * League operations against the configured DATABASE_URL.
 *   bun run league seed [--season season-1] [--seed 20261109] [--budget 1.00]
 *   bun run league run  [--season season-1] [--no-managers]   # plays every remaining round in-process
 *   bun run league managers [--season season-1]              # manager decisions, memory and spend
 *   bun run league budget [--season season-1]                # compute ledger per team
 *   bun run league table [--season season-1]
 */
import { createDb } from "@autosoccer/db";
import { FileReplayStore } from "@autosoccer/sim-adapter";
import { loadConfig } from "../apps/server/src/config.ts";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { createLogger } from "../apps/server/src/log.ts";
import { editorialLlm, managerLlm } from "../apps/server/src/modules/agents/index.ts";
import { formatUsd } from "../apps/server/src/modules/agents/pricing.ts";
import { managerRoundHook, seedManagers } from "../apps/server/src/modules/agents/service.ts";
import { seedJournalists } from "../apps/server/src/modules/editorial/service.ts";
import { fixtureViews, seasonBySlug, standingRows } from "../apps/server/src/modules/league/read.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";
import { budgetSummary } from "../apps/server/src/modules/ledger/service.ts";
import { MATCH_JOB, matchJobHandler } from "../apps/server/src/modules/matches/service.ts";

const [cmd = "table"] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/^\d|^season/.test(a));
const opt = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : def;
};
const slug = opt("season", "season-1");
const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: 4 });

async function printTable() {
  const s = await seasonBySlug(db, slug);
  if (!s) throw new Error(`no season ${slug}; run \`bun run league seed\``);
  const { rows, afterRound } = await standingRows(db, s.id);
  console.log(`\n${s.name} — ${s.status}, after round ${afterRound}`);
  console.log(" #  Team                 P  W  D  L  GF GA  GD  Pts  Form");
  for (const r of rows) {
    const gd = r.goalDifference > 0 ? `+${r.goalDifference}` : String(r.goalDifference);
    console.log(
      `${String(r.position).padStart(2)}  ${r.team.name.padEnd(20)} ${[r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst].map((n) => String(n).padStart(2)).join(" ")} ${gd.padStart(3)}  ${String(r.points).padStart(3)}  ${r.form.join("")}`,
    );
  }
}

try {
  if (cmd === "seed") {
    await seedTeams(db);
    const { seasonId, created } = await createSeason(db, {
      slug,
      name: opt("name", "Season 1"),
      seed: Number(opt("seed", "20261109")),
      budgetPerTeamMicroUsd: Math.round(Number(opt("budget", "1.00")) * 1_000_000),
      teamSlugs: SEED_TEAMS.map((t) => t.slug),
    });
    await seedManagers(db, seasonId, config.MANAGER_MODEL);
    await seedJournalists(db, config.EDITORIAL_MODEL);
    const fx = await fixtureViews(db, seasonId);
    console.log(`${created ? "created" : "exists"}: ${slug} (${fx.length} fixtures)`);
    for (const f of fx) console.log(`  R${f.round}  ${f.home.name.padEnd(20)} v ${f.away.name.padEnd(20)} ${f.status}`);
  } else if (cmd === "run") {
    const s = await seasonBySlug(db, slug);
    if (!s) throw new Error(`no season ${slug}; run \`bun run league seed\``);
    const log = createLogger("warn");
    const store = new FileReplayStore(config.REPLAY_DIR);
    const managers = !process.argv.includes("--no-managers");
    if (managers) console.log(`managers on · llm ${config.LLM_PROVIDER} · model ${config.MANAGER_MODEL}`);
    const handlers = managers
      ? buildHandlers({ db, store, llm: managerLlm(config), editorialLlm: editorialLlm(config), log })
      : { [MATCH_JOB]: matchJobHandler({ db, store }) };
    const worker = createWorker({ db, log, handlers });
    const hook = managers ? managerRoundHook(db) : undefined;
    const t0 = performance.now();
    for (;;) {
      const a = await advanceSeason(db, s.id, { beforeRound: hook });
      if (a.state === "completed") break;
      if (a.state === "blocked") throw new Error(`season blocked: ${JSON.stringify(a)}`);
      const done = await worker.drain();
      for (const d of done) console.log(`  round ${a.round}: job ${d.job.idempotency_key} → ${d.status}`);
    }
    console.log(`season complete in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    await printTable();
  } else if (cmd === "managers") {
    const s = await seasonBySlug(db, slug);
    if (!s) throw new Error(`no season ${slug}`);
    const ms = await db<{ id: string; name: string; team: string; memory: { summary: string; notes: string[] } }[]>`
      select m.id, m.name, t.name as team, m.memory from manager_agents m join teams t on t.id = m.team_id order by t.name`;
    for (const m of ms) {
      const runs = await db<{ purpose: string; status: string; cost: number; provider: string | null }[]>`
        select purpose, status, cost_micro_usd as cost, provider from agent_runs where agent_id = ${m.id} and season_id = ${s.id}`;
      const revs = await db<{ version: number; source: string; status: string; rationale: string | null }[]>`
        select r.version, r.source, r.status, r.rationale from tactical_revisions r join manager_agents m on m.team_id = r.team_id
        where m.id = ${m.id} and r.season_id = ${s.id} order by version`;
      const spent = runs.reduce((a, r) => a + r.cost, 0);
      console.log(
        `\n${m.name} (${m.team}) — ${runs.length} runs, ${runs.filter((r) => r.status === "succeeded").length} succeeded, spend ${formatUsd(spent)} [${[...new Set(runs.map((r) => r.provider))].join(",")}]`,
      );
      for (const r of revs)
        console.log(`  v${r.version} ${r.source.padEnd(7)} ${r.status.padEnd(8)} ${r.rationale ?? ""}`);
      console.log(`  memory: ${m.memory.summary}`);
      for (const n of m.memory.notes) console.log(`    · ${n}`);
    }
  } else if (cmd === "budget") {
    const s = await seasonBySlug(db, slug);
    if (!s) throw new Error(`no season ${slug}`);
    const names = new Map(
      (await db<{ id: string; name: string }[]>`select id, name from teams`).map((t) => [t.id, t.name]),
    );
    console.log(`\n${s.name} compute budget (per team ${formatUsd(s.budget_per_team_micro_usd)})`);
    console.log(`${"Team".padEnd(20)}${"spent".padStart(10)}${"left".padStart(10)}${"paid runs".padStart(11)}  status`);
    for (const r of await budgetSummary(db, s.id)) {
      console.log(
        `${names.get(r.teamId)!.padEnd(20)}${formatUsd(r.spentMicroUsd).padStart(10)}${formatUsd(r.remainingMicroUsd).padStart(10)}${String(r.runs).padStart(11)}  ${r.exhausted ? "EXHAUSTED (last valid tactics)" : "ok"}`,
      );
    }
    const st = await db<
      { status: string; n: number }[]
    >`select status, count(*)::int as n from agent_runs where season_id = ${s.id} group by status order by status`;
    console.log(`agent runs: ${st.map((x) => `${x.status} ${x.n}`).join(", ")}`);
  } else if (cmd === "table") {
    await printTable();
  } else throw new Error(`unknown command ${cmd}`);
} finally {
  await db.end();
}
