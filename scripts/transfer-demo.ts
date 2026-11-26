/**
 * Transfer window demo on the configured DATABASE_URL (use a throwaway database): plays Season 1
 * with offline managers, rolls over, runs the transfer window to completion and plays round 1 of
 * Season 2, so the site shows deals, the signing's next fixture and both clubs' statements.
 *
 *   DATABASE_URL=postgres://…/demo bun scripts/transfer-demo.ts [--rounds 1]
 */
import { createDb, migrate } from "@autosoccer/db";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { offlineManagerLlm } from "../apps/server/src/modules/agents/offline.ts";
import { managerRoundHook, seedManagers } from "../apps/server/src/modules/agents/service.ts";
import { rolloverSeason } from "../apps/server/src/modules/league/rollover.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";
import { tickTransfers } from "../apps/server/src/modules/transfers/window.ts";

const MODEL = "claude-opus-5-5";
const rounds = process.argv.includes("--rounds") ? Number(process.argv[process.argv.indexOf("--rounds") + 1]) : 1;
const db = createDb(process.env.DATABASE_URL!, { max: 4 });
await migrate(db);
await seedTeams(db);
const { seasonId: s1 } = await createSeason(db, {
  slug: "season-1",
  name: "Season 1",
  seed: 20261125,
  budgetPerTeamMicroUsd: 1_000_000,
  teamSlugs: SEED_TEAMS.map((x) => x.slug),
  startsAt: new Date(Date.now() - 24 * 3600_000),
  roundIntervalMinutes: 60,
  playersPerTeam: 7,
});
await seedManagers(db, s1, MODEL);
// Replays are kept in memory only: the demo is about the market, not match playback.
const worker = createWorker({
  db,
  baseBackoffMs: 1,
  handlers: buildHandlers({ db, store: new MemoryReplayStore(), llm: offlineManagerLlm(MODEL), halfDurationSec: 30 }),
});
const hook = managerRoundHook(db);
const play = async (seasonId: string, upTo = 99) => {
  for (let i = 0; i < 60; i++) {
    const [open] = await db<{ round: number | null }[]>`
      select min(round)::int as round from fixtures where season_id = ${seasonId} and status <> 'completed'`;
    if (open?.round != null && open.round > upTo) break;
    if ((await advanceSeason(db, seasonId, { beforeRound: hook })).state === "completed") break;
    await worker.drain();
  }
};
await play(s1);
const slug = await rolloverSeason(db, { managerModel: MODEL, editorialModel: MODEL, roundMinutes: 60, clubs: 4 });
const [s2] = await db<{ id: string }[]>`select id from seasons where slug = ${slug}`;
for (let i = 0; i < 20; i++) {
  const [w] = await db<{ phase: string }[]>`select phase from transfer_windows where season_id = ${s2!.id}`;
  if (!w || w.phase === "closed") break;
  await tickTransfers(db);
  await worker.drain();
}
if (rounds > 0) await play(s2!.id, rounds);
const deals = await db<{ player: string; seller: string; buyer: string; fee: string; status: string }[]>`
  select p.name as player, ts.name as seller, tb.name as buyer, b.fee::text, b.status from transfer_bids b
  join players p on p.id = b.player_id join teams ts on ts.id = b.seller_team_id join teams tb on tb.id = b.buyer_team_id
  order by b.fee desc`;
console.table(deals);
await db.end();
