/**
 * League operations against the configured DATABASE_URL.
 *   bun run league seed [--season season-1] [--seed 20261109] [--budget 1.00]
 *   bun run league run  [--season season-1]   # plays every remaining round in-process (no AI)
 *   bun run league table [--season season-1]
 */
import { createDb } from "@autosoccer/db";
import { FileReplayStore } from "@autosoccer/sim-adapter";
import { loadConfig } from "../apps/server/src/config.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { createLogger } from "../apps/server/src/log.ts";
import { fixtureViews, seasonBySlug, standingRows } from "../apps/server/src/modules/league/read.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";
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
    const fx = await fixtureViews(db, seasonId);
    console.log(`${created ? "created" : "exists"}: ${slug} (${fx.length} fixtures)`);
    for (const f of fx) console.log(`  R${f.round}  ${f.home.name.padEnd(20)} v ${f.away.name.padEnd(20)} ${f.status}`);
  } else if (cmd === "run") {
    const s = await seasonBySlug(db, slug);
    if (!s) throw new Error(`no season ${slug}; run \`bun run league seed\``);
    const log = createLogger("warn");
    const worker = createWorker({
      db,
      log,
      handlers: { [MATCH_JOB]: matchJobHandler({ db, store: new FileReplayStore(config.REPLAY_DIR) }) },
    });
    const t0 = performance.now();
    for (;;) {
      const a = await advanceSeason(db, s.id);
      if (a.state === "completed") break;
      if (a.state === "blocked" || a.state === "waiting") throw new Error(`season ${a.state}: ${JSON.stringify(a)}`);
      const done = await worker.drain();
      for (const d of done) console.log(`  round ${a.round}: job ${d.job.idempotency_key} → ${d.status}`);
    }
    console.log(`season complete in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    await printTable();
  } else if (cmd === "table") {
    await printTable();
  } else throw new Error(`unknown command ${cmd}`);
} finally {
  await db.end();
}
