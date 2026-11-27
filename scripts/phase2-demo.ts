/**
 * A Phase 2 rehearsal database for screenshots and walkthroughs (#100): the original league plays a
 * short season, concludes at its announced final season and is archived; a new league is created,
 * its 20 clubs founded by the OFFLINE stand-in founder (not models), activated and made the default.
 *
 *   DATABASE_URL=postgres://…/autosoccer_phase2_demo bun scripts/phase2-demo.ts
 *
 * Refuses to run against a database whose name doesn't contain "demo" or "test": never production.
 */
import { createDb, migrate } from "@autosoccer/db";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { offlineFounder } from "../apps/server/src/modules/founding/offline.ts";
import { inviteFounders, runFounding } from "../apps/server/src/modules/founding/service.ts";
import { apply, leagueBySlug } from "../apps/server/src/modules/league/leagues.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";
import { MATCH_JOB, matchJobHandler } from "../apps/server/src/modules/matches/service.ts";
import { REGISTRY } from "../apps/server/src/modules/models/registry.ts";

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
await inviteFounders(
  db,
  founders.id,
  REGISTRY.filter((m) => m.status !== "reserve").map((m) => m.slug),
);
const llm = offlineFounder();
const rounds = await runFounding(db, founders.id, () => llm);
console.log(
  rounds.map((r) => `round ${r.round}: ${r.founded.length} founded, ${r.rejected.length} returned`).join("\n"),
);
await db`update leagues set status = 'active', activated_at = now() where id = ${founders.id}`; // no squads yet (#96): rehearsal only
await apply(db, "set-default", { slug: "founders", confirm: "founders" });
await apply(db, "archive", { slug: "original", confirm: "original", backupRef: "demo (no backup)" });
const [club] = await db<
  { slug: string }[]
>`select t.slug from founders f join teams t on t.id = f.team_id order by t.slug limit 1`;
console.log(`ready: /leagues, /leagues/original, /teams/${club!.slug}`);
await db.end();
