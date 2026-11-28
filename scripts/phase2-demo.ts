/**
 * A Phase 2 rehearsal database for screenshots and walkthroughs (#100): the original league plays a
 * short season, concludes at its announced final season and is archived; a new league runs the real
 * inaugural phase (inaugural/1) through the scheduler and worker with the OFFLINE stand-in founder and
 * managers (no model calls, labelled as rehearsal on the site): founding, the talent pool, three
 * recruitment rounds and the safety net. It's then activated, made the default, and plays a few rounds.
 *
 * Staged distress (rehearsal only): two clubs' contracts are raised far beyond their means before
 * round 1, so the lender, a default, forced auctions and administration have something to show.
 *
 *   DATABASE_URL=postgres://…/autosoccer_phase2_demo bun scripts/phase2-demo.ts
 *
 * Refuses to run against a database whose name doesn't contain "demo" or "test": never production.
 */
import { createDb, migrate } from "@autosoccer/db";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { offlineManagerLlm } from "../apps/server/src/modules/agents/offline.ts";
import { startInaugural, tickInaugural } from "../apps/server/src/modules/founding/inaugural.ts";
import { offlineFounder } from "../apps/server/src/modules/founding/offline.ts";
import { apply, leagueBySlug } from "../apps/server/src/modules/league/leagues.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";
import { MATCH_JOB, matchJobHandler } from "../apps/server/src/modules/matches/service.ts";
import { REGISTRY } from "../apps/server/src/modules/models/registry.ts";
import { schedulerTick } from "../apps/server/src/modules/ops/scheduler.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/demo|test/.test(new URL(url).pathname)) {
  console.error("refusing: DATABASE_URL must name a demo or test database");
  process.exit(2);
}
const db = createDb(url, { max: 4 });
await migrate(db);
await seedTeams(db);
const { seasonId } = await createSeason(db, {
  slug: "season-1",
  name: "Season 1",
  seed: 20261127,
  budgetPerTeamMicroUsd: 0,
  teamSlugs: SEED_TEAMS.map((t) => t.slug),
  roundIntervalMinutes: 1,
  startsAt: new Date("2026-11-01T12:00:00Z"),
});
const worker = createWorker({
  db,
  handlers: { [MATCH_JOB]: matchJobHandler({ db, store: new MemoryReplayStore(), halfDurationSec: 10 }) },
});
for (let i = 0; i < 40; i++) {
  if ((await advanceSeason(db, seasonId)).state === "completed") break;
  await worker.drain();
}
await apply(db, "final-season", { slug: "original", confirm: "original", season: "season-1" });
await db`update leagues set status = 'concluded', concluded_at = now() where slug = 'original'`; // what rollover does at the boundary
await apply(db, "create", { slug: "founders", confirm: "founders", name: "The Founders League" });
const founders = (await leagueBySlug(db, "founders"))!;
await db`update leagues set description = 'Twenty clubs, each founded and run by a different AI model.' where id = ${founders.id}`;
const T0 = new Date("2027-01-04T09:00:00Z");
await startInaugural(db, "founders", {
  opens: T0,
  seed: 7,
  models: REGISTRY.filter((m) => m.status !== "reserve").map((m) => m.slug),
  // Offline managers are priced as their models; a budget of $0 would skip every decision and leave
  // recruitment entirely to the safety net.
  budgetPerTeamMicroUsd: 50_000_000,
});
const phase2 = createWorker({
  db,
  baseBackoffMs: 1,
  handlers: buildHandlers({
    db,
    store: new MemoryReplayStore(),
    llm: offlineManagerLlm("offline"),
    llmFor: (model) => offlineManagerLlm(model),
    founderLlmFor: () => offlineFounder(),
    halfDurationSec: 10,
  }),
});
let now = new Date(T0.getTime() + 60_000);
for (let i = 0; i < 40; i++) {
  await schedulerTick(db, { respectSchedule: false, now });
  await phase2.drain();
  const [tick] = await tickInaugural(db, { now });
  if (tick?.state === "ready") break;
  now = new Date(now.getTime() + 4 * 3_600_000);
}
const [inaugural] = await db<{ id: string }[]>`select inaugural_season_id as id from leagues where id = ${founders.id}`;
// Staged distress (see the header): two clubs' wage bills far beyond their means.
const staged = await db<{ team_id: string }[]>`
  select team_id from season_teams where season_id = ${inaugural!.id} order by team_id limit 2`;
for (const { team_id } of staged)
  await db`update player_contracts set wage_per_season = 6000000 where team_id = ${team_id} and status = 'active'`;
await apply(db, "activate", { slug: "founders", confirm: "founders" });
// Deep enough into the season for the staged clubs to exhaust their borrowing (the debt cap is three
// quarters of a season's wages, so a club overspending this much defaults around round 30 of 38).
const UNTIL = Number(process.env.DEMO_ROUNDS ?? 34);
for (let i = 0; i < 200; i++) {
  await schedulerTick(db, { respectSchedule: false, now });
  await phase2.drain();
  const [done] = await db<{ n: number }[]>`
    select count(*)::int as n from fixtures where season_id = ${inaugural!.id} and status = 'completed' and round <= ${UNTIL}`;
  if (done!.n >= UNTIL * 10) break;
  now = new Date(now.getTime() + 12 * 3_600_000);
}
await apply(db, "set-default", { slug: "founders", confirm: "founders" });
await apply(db, "archive", { slug: "original", confirm: "original", backupRef: "demo (no backup)" });
const [club] = await db<{ slug: string }[]>`
  select t.slug from collateral_auctions a join teams t on t.id = a.seller_team_id limit 1`;
console.log(
  `ready: /leagues, /leagues/founders, /seasons/founders-season-1/market, /teams/${club?.slug ?? "(no auction)"}`,
);
await db.end();
