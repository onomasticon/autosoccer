/**
 * Injury demo on the configured DATABASE_URL (use a throwaway database): plays a season's first
 * rounds with offline managers, prints the injuries the rolls produced, then forces a crisis (one
 * club loses both keepers and all but four outfield players for two rounds) so the emergency
 * call-up is visible, and plays on.
 *
 *   DATABASE_URL=postgres://…/demo bun scripts/injury-demo.ts [--club harbour-city] [--rounds 6]
 */
import { createDb, migrate } from "@autosoccer/db";
import { FileReplayStore } from "@autosoccer/sim-adapter";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { offlineManagerLlm } from "../apps/server/src/modules/agents/offline.ts";
import { managerRoundHook, seedManagers } from "../apps/server/src/modules/agents/service.ts";
import { offlineEditorialLlm } from "../apps/server/src/modules/editorial/offline.ts";
import { seedJournalists } from "../apps/server/src/modules/editorial/service.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";

const MODEL = "claude-opus-5-5";
const arg = (n: string, d: string) =>
  process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d;
const CLUB = arg("club", "harbour-city");
const ROUNDS = Number(arg("rounds", "6"));

const db = createDb(process.env.DATABASE_URL!, { max: 4 });
await migrate(db);
await seedTeams(db);
const { seasonId } = await createSeason(db, {
  slug: "season-1",
  name: "Season 1",
  seed: 20261126,
  budgetPerTeamMicroUsd: 1_000_000,
  teamSlugs: SEED_TEAMS.map((x) => x.slug),
  startsAt: new Date(Date.now() - 30 * 3600_000),
  roundIntervalMinutes: 240,
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
const hook = managerRoundHook(db);
const play = async (through: number) => {
  for (let i = 0; i < 80; i++) {
    const [open] = await db<{ round: number | null }[]>`
      select min(round)::int as round from fixtures where season_id = ${seasonId} and status <> 'completed'`;
    if (open?.round == null || open.round > through) break;
    await advanceSeason(db, seasonId, { beforeRound: hook });
    await worker.drain();
  }
};
await play(2);
const [club] = await db<{ id: string; name: string }[]>`select id, name from teams where slug = ${CLUB}`;
const [m] = await db<{ id: string }[]>`
  select m.id from matches m join fixtures f on f.id = m.fixture_id
  where f.season_id = ${seasonId} and f.round = 2 and ${club!.id}::uuid in (f.home_team_id, f.away_team_id)`;
const squad = await db<{ id: string; position: string }[]>`
  select id, position from players where team_id = ${club!.id} and retired_season_id is null order by shirt_number`;
for (const p of [...squad.filter((x) => x.position === "GK"), ...squad.filter((x) => x.position !== "GK").slice(4)])
  await db`
    insert into player_injuries (player_id, team_id, season_id, match_id, injured_round, out_from_round, out_until_round, rule)
    values (${p.id}, ${club!.id}, ${seasonId}, ${m!.id}, 2, 3, 4, 'injury/1') on conflict do nothing`;
await play(ROUNDS);
const natural = await db<{ name: string; club: string; round: number; rounds: number }[]>`
  select p.name, t.name as club, i.injured_round as round, (i.out_until_round - i.out_from_round + 1)::int as rounds
  from player_injuries i join players p on p.id = i.player_id join teams t on t.id = i.team_id
  where not (i.team_id = ${club!.id} and i.injured_round = 2) order by i.injured_round, p.name`;
console.log("\nInjuries from the rolls:");
console.table(natural);
const calls = await db<{ name: string; position: string; matches: number }[]>`
  select p.name, p.position, (select count(*)::int from lineup_changes c where c.replaced_by = p.id) as matches
  from players p where p.emergency_season_id is not null order by p.shirt_number`;
console.log(`Emergency call-ups for ${club!.name} (rounds 3–4):`);
console.table(calls);
await db.end();
