/**
 * The cutover rehearsal (#93, #101) on a RESTORED COPY of production: the original league's newest
 * season is announced as its final one and played to the end through the production scheduler (with
 * the legacy rollover on, as in production) and job worker, with offline managers and no newsroom
 * calls. The league must conclude instead of rolling over; it's then archived against a dump of the
 * copy and verified, and further scheduler ticks must queue nothing for it.
 *
 *   DATABASE_URL=postgres://…/autosoccer_restore bun scripts/cutover-rehearsal.ts <backup ref>
 *
 * Refuses a database whose name doesn't contain "restore" or "rehearsal": never production.
 */
import { createDb } from "@autosoccer/db";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { offlineManagerLlm } from "../apps/server/src/modules/agents/offline.ts";
import { startInaugural, tickInaugural } from "../apps/server/src/modules/founding/inaugural.ts";
import { offlineFounder } from "../apps/server/src/modules/founding/offline.ts";
import { apply, leagueBySlug, verifyArchive } from "../apps/server/src/modules/league/leagues.ts";
import { REGISTRY } from "../apps/server/src/modules/models/registry.ts";
import { schedulerTick } from "../apps/server/src/modules/ops/scheduler.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/restore|rehearsal/.test(new URL(url).pathname)) {
  console.error("refusing: DATABASE_URL must name a restored copy (…restore… or …rehearsal…)");
  process.exit(2);
}
const backup = process.argv[2];
if (!backup) {
  console.error("usage: cutover-rehearsal.ts <backup ref of the copy>");
  process.exit(2);
}
const db = createDb(url, { max: 6 });
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const rollover = { managerModel: "claude-opus-5-5", editorialModel: "claude-opus-5-5" };
const tick = (now: Date) => schedulerTick(db, { respectSchedule: false, now, rollover });
const worker = createWorker({
  db,
  baseBackoffMs: 1,
  handlers: buildHandlers({
    db,
    store: new MemoryReplayStore(),
    llm: offlineManagerLlm("claude-opus-5-5"),
    llmFor: (m) => offlineManagerLlm(m),
    founderLlmFor: () => offlineFounder(),
  }),
});

const [final] = await db<{ slug: string }[]>`
  select s.slug from seasons s join leagues l on l.id = s.league_id
  where l.slug = 'original' order by s.created_at desc limit 1`;
const [orig] = await db<{ status: string }[]>`select status from leagues where slug = 'original'`;
log(`1. announce ${final!.slug} as the original league's final season`);
if (orig!.status === "active")
  await apply(db, "final-season", { slug: "original", confirm: "original", season: final!.slug });

log("2. play it out (legacy rollover on, as in production)");
let now = new Date();
for (let i = 0; i < 400; i++) {
  const r = await tick(now);
  await worker.drain();
  const [l] = await db<{ status: string }[]>`select status from leagues where slug = 'original'`;
  if (l!.status === "concluded") {
    log(`   concluded after tick ${i}${r.rolledOver ? ` (rolled over to ${r.rolledOver}!)` : ""}`);
    break;
  }
  now = new Date(now.getTime() + 15 * 60_000);
}
const [seasons] = await db<{ n: number; open: number }[]>`
  select count(*)::int as n, count(*) filter (where s.status <> 'completed')::int as open
  from seasons s join leagues l on l.id = s.league_id where l.slug = 'original'`;
log(`   original league: ${seasons!.n} seasons, ${seasons!.open} not completed (expect 0: no season 18)`);

log("3. the new league: create, found and recruit (offline stand-ins), activate, make it the default");
if (!(await leagueBySlug(db, "founders")))
  await apply(db, "create", { slug: "founders", confirm: "founders", name: "The Founders League" });
await startInaugural(db, "founders", {
  opens: now,
  seed: 7,
  models: REGISTRY.filter((m) => m.status !== "reserve").map((m) => m.slug),
  budgetPerTeamMicroUsd: 50_000_000,
});
for (let i = 0; i < 80; i++) {
  await tick(now);
  await worker.drain();
  const [t] = await tickInaugural(db, { now });
  if (!t || t.state === "ready") break;
  now = new Date(now.getTime() + 4 * 3_600_000);
}
if ((await leagueBySlug(db, "founders"))!.status === "draft")
  await apply(db, "activate", { slug: "founders", confirm: "founders" });
await apply(db, "set-default", { slug: "founders", confirm: "founders" });
log("   founders active and the default");

log(`4. archive the original against ${backup}, then verify`);
await apply(db, "archive", { slug: "original", confirm: "original", backupRef: backup });
const v = await verifyArchive(db, "original");
log(`   verify: ${v.ok ? "unchanged since archival" : `DIFFERS: ${v.differences.join("; ")}`}`);

log("5. scheduler isolation: 20 more ticks, 12 hours apart, while the new league plays");
const origJobs = async () =>
  (
    await db<{ n: number }[]>`
      select count(*)::int as n from jobs j where exists (
        select 1 from fixtures f join seasons s on s.id = f.season_id join leagues l on l.id = s.league_id
        where l.slug = 'original' and (j.payload->>'fixtureId' = f.id::text or j.payload->>'seasonId' = s.id::text))`
  )[0]!.n;
const before = { n: await origJobs() };
for (let i = 0; i < 20; i++) {
  now = new Date(now.getTime() + 12 * 3_600_000);
  await tick(now);
  await worker.drain();
}
const after = { n: await origJobs() };
const [s2] = await db<{ n: number; played: number }[]>`
  select (select count(*)::int from seasons s join leagues l on l.id = s.league_id where l.slug = 'original') as n,
    (select count(*)::int from fixtures f join seasons s on s.id = f.season_id join leagues l on l.id = s.league_id
      where l.slug = 'founders' and f.status = 'completed') as played`;
const v2 = await verifyArchive(db, "original");
log(
  `   jobs for the original: ${after.n - before.n} new (expect 0); its seasons: ${s2!.n}; new league fixtures played: ${s2!.played}; verify: ${v2.ok ? "unchanged" : "DIFFERS"}`,
);
await db.end();
process.exit(v.ok && v2.ok && after.n === before.n && seasons!.open === 0 ? 0 : 1);
