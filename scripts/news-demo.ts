/**
 * News desk demo on the configured DATABASE_URL (use a throwaway database). Runs the real scheduler
 * (respecting kickoff times) with offline managers and the offline newsroom over a season that
 * kicked off a day ago, rolls over into the next season, runs its transfer window, and stops before
 * the new season's round 1. Prints the news cycle: every article in publication order, with its
 * priority, and which ones are still held back for later.
 *
 *   DATABASE_URL=postgres://…/demo bun scripts/news-demo.ts [--hours-ago 24] [--round-minutes 240]
 */
import { createDb, migrate } from "@autosoccer/db";
import { FileReplayStore } from "@autosoccer/sim-adapter";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { offlineManagerLlm } from "../apps/server/src/modules/agents/offline.ts";
import { seedManagers } from "../apps/server/src/modules/agents/service.ts";
import { offlineEditorialLlm } from "../apps/server/src/modules/editorial/offline.ts";
import { seedJournalists } from "../apps/server/src/modules/editorial/service.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";
import { schedulerTick } from "../apps/server/src/modules/ops/scheduler.ts";

const MODEL = "claude-opus-5-5";
const arg = (n: string, d: string) =>
  process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d;
const HOURS_AGO = Number(arg("hours-ago", "24"));
const ROUND_MINUTES = Number(arg("round-minutes", "240"));

const db = createDb(process.env.DATABASE_URL!, { max: 4 });
await migrate(db);
await seedTeams(db);
const { seasonId } = await createSeason(db, {
  slug: "season-1",
  name: "Season 1",
  seed: 20261126,
  budgetPerTeamMicroUsd: 1_000_000,
  teamSlugs: SEED_TEAMS.map((x) => x.slug),
  startsAt: new Date(Date.now() - HOURS_AGO * 3600_000),
  roundIntervalMinutes: ROUND_MINUTES,
  playersPerTeam: 7,
});
await seedManagers(db, seasonId, MODEL);
await seedJournalists(db, MODEL);
const worker = createWorker({
  db,
  baseBackoffMs: 1,
  handlers: buildHandlers({
    db,
    store: new FileReplayStore(process.env.REPLAY_DIR ?? "data/replays"),
    llm: offlineManagerLlm(MODEL),
    editorialLlm: offlineEditorialLlm(MODEL),
  }),
});
for (let i = 0; i < 200; i++) {
  const tick = await schedulerTick(db, {
    respectSchedule: true,
    previews: true,
    rollover: { managerModel: MODEL, editorialModel: MODEL, roundMinutes: ROUND_MINUTES },
  });
  await worker.drain();
  const [s] = await db<{ n: number; closed: boolean }[]>`
    select count(*)::int as n, bool_and(coalesce(w.phase = 'closed', true)) as closed
    from seasons s left join transfer_windows w on w.season_id = s.id`;
  const waiting = tick.seasons.every((x) => x.result.state === "waiting");
  if (s!.n > 1 && s!.closed && waiting) break;
}
await schedulerTick(db, { respectSchedule: true, previews: true });
await worker.drain();

const rows = await db<{ published_at: Date; priority: number; kind: string; topic: string | null; headline: string }[]>`
  select published_at, priority, kind, topic, headline from articles where status = 'published' order by published_at, priority desc`;
const now = Date.now();
console.log("\nThe news cycle (publication order):");
for (const r of rows)
  console.log(
    `${r.published_at.toISOString().slice(5, 16).replace("T", " ")}  ${r.published_at.getTime() > now ? "held " : "     "} p${String(r.priority).padStart(3)}  ${(r.topic ?? r.kind).padEnd(12)} ${r.headline}`,
  );
await db.end();
