import { MatchDetailResponse, PlayerProfileResponse, TeamDetailResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { managerRoundHook, seedManagers } from "../agents/service.ts";
import { matchFacts } from "../editorial/facts.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { INJURY, injuryRoll, replacements, settleInjuries } from "./injuries.ts";

const MODEL = "claude-opus-5-5";

describe("injury/1 rules", () => {
  it("injuries are rare (about 2% a match), last 1–4 rounds, and are likelier for older players", () => {
    const rolls = Array.from({ length: 4000 }, (_, i) => injuryRoll(i, `Player ${i % 97}`, 25));
    const hurt = rolls.filter((r) => r > 0);
    expect(hurt.length / rolls.length).toBeGreaterThan(0.01);
    expect(hurt.length / rolls.length).toBeLessThan(0.035);
    expect(Math.min(...hurt)).toBe(1);
    expect(Math.max(...hurt)).toBeLessThanOrEqual(4);
    const old = Array.from({ length: 4000 }, (_, i) => injuryRoll(i, `Player ${i % 97}`, 35)).filter((r) => r > 0);
    expect(old.length).toBeGreaterThan(hurt.length);
    expect(injuryRoll(7, "Ada Okafor", 25)).toBe(injuryRoll(7, "Ada Okafor", 25)); // deterministic
  });

  it("replacements: the best fit player of the same position, a keeper only for a keeper, else an emergency call-up", () => {
    const squad = [
      { id: "gk1", position: "GK" as const, overall: 70, shirtNumber: 1 },
      { id: "df1", position: "DF" as const, overall: 60, shirtNumber: 2 },
      { id: "df2", position: "DF" as const, overall: 61, shirtNumber: 3 },
      { id: "mf1", position: "MF" as const, overall: 62, shirtNumber: 4 },
      { id: "fw1", position: "FW" as const, overall: 63, shirtNumber: 5 },
      { id: "df3", position: "DF" as const, overall: 58, shirtNumber: 6 },
      { id: "mf2", position: "MF" as const, overall: 66, shirtNumber: 7 },
    ];
    const starters = ["gk1", "df1", "df2", "mf1", "fw1"];
    expect(replacements(starters, squad, new Set(["df1"]), 5)).toEqual([
      { playerId: "df1", replacedBy: "df3", position: "DF" },
    ]);
    // No fit keeper left: an emergency goalkeeper, never an outfield player in goal.
    expect(replacements(starters, squad, new Set(["gk1"]), 5)).toEqual([
      { playerId: "gk1", replacedBy: null, position: "GK" },
    ]);
    // No DF left: the best fit outfield player.
    expect(replacements(starters, squad, new Set(["df1", "df3"]), 5)[0]!.replacedBy).toBe("mf2");
  });
});

describe("injuries through the season lifecycle", () => {
  let t: TestDatabase;
  let seasonId: string;
  let hbc: string;
  const app = () => createApp({ db: t.db, store: new MemoryReplayStore() });
  const get = async <T>(path: string, schema: { parse: (x: unknown) => T }) => {
    const res = await app().request(`/api/v1${path}`);
    expect(res.status).toBe(200);
    return schema.parse(await res.json());
  };
  async function play(through: number) {
    const w = createWorker({
      db: t.db,
      baseBackoffMs: 1,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm(MODEL),
        halfDurationSec: 30,
      }),
    });
    const hook = managerRoundHook(t.db);
    for (let i = 0; i < 60; i++) {
      const [open] = await t.db<{ round: number | null }[]>`
        select min(round)::int as round from fixtures where season_id = ${seasonId} and status <> 'completed'`;
      if (open?.round == null || open.round > through) break;
      await advanceSeason(t.db, seasonId, { beforeRound: hook });
      await w.drain();
    }
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 20261126,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-20T04:00:00Z"),
      roundIntervalMinutes: 240,
      playersPerTeam: 7,
    }));
    await seedManagers(t.db, seasonId, MODEL);
    hbc = (await t.db<{ id: string }[]>`select id from teams where slug = 'harbour-city'`)[0]!.id;
    await play(2);
    // Force a crisis for round 3: both of Harbour City's keepers and all but four outfield players hurt.
    const [m] = await t.db<{ id: string }[]>`
      select m.id from matches m join fixtures f on f.id = m.fixture_id
      where f.season_id = ${seasonId} and f.round = 2 and ${hbc}::uuid in (f.home_team_id, f.away_team_id)`;
    const squad = await t.db<{ id: string; position: string }[]>`
      select id, position from players where team_id = ${hbc} and retired_season_id is null order by shirt_number`;
    const out = [...squad.filter((p) => p.position === "GK"), ...squad.filter((p) => p.position !== "GK").slice(4)];
    for (const p of out)
      await t.db`
        insert into player_injuries (player_id, team_id, season_id, match_id, injured_round, out_from_round, out_until_round, rule)
        values (${p.id}, ${hbc}, ${seasonId}, ${m!.id}, 2, 3, 4, 'injury/1') on conflict do nothing`;
    await play(4);
  }, 300_000);
  afterAll(async () => {
    await t.drop();
  });

  it("rolls each match once: repeated settlement writes nothing new", async () => {
    const [checks] = await t.db<{ n: number; m: number }[]>`
      select (select count(*)::int from injury_checks) as n,
        (select count(*)::int from matches m join fixtures f on f.id = m.fixture_id where f.season_id = ${seasonId}) as m`;
    expect(checks!.n).toBe(checks!.m);
    expect(await settleInjuries(t.db, seasonId)).toBe(0);
  });

  it("an injured player never starts a match they're ruled out of", async () => {
    const clash = await t.db`
      select 1 from player_injuries i join fixtures f on f.season_id = i.season_id
        and f.round between i.out_from_round and i.out_until_round
      join matches m on m.fixture_id = f.id
      where exists (select 1 from jsonb_array_elements((m.request->'home'->'starters') || (m.request->'away'->'starters')) s
        where (s->>'playerId')::uuid = i.player_id)`;
    expect(clash).toHaveLength(0);
  });

  it("a club with no fit keeper and too few players calls up emergency players, who never join the squad", async () => {
    const [f] = await t.db<
      {
        id: string;
        side: "home" | "away";
        request: Record<"home" | "away", { starters: Array<{ playerId: string; position: string }> }>;
      }[]
    >`
      select f.id, case when f.home_team_id = ${hbc} then 'home' else 'away' end as side, m.request
      from fixtures f join matches m on m.fixture_id = f.id
      where f.season_id = ${seasonId} and f.round = 3 and ${hbc}::uuid in (f.home_team_id, f.away_team_id)`;
    const starters = f!.request[f!.side].starters;
    expect(starters).toHaveLength(7);
    const ids = starters.map((s) => s.playerId);
    const emergency = await t.db<{ id: string; position: string; retired: string | null; squad: string | null }[]>`
      select id, position, retired_season_id as retired, emergency_season_id as squad from players
      where id = any(${ids}::uuid[]) and emergency_season_id is not null`;
    expect(emergency.length).toBe(3); // a keeper and two outfield players
    expect(emergency.some((e) => e.position === "GK")).toBe(true);
    expect(starters[0]!.position).toBe("GK");
    const changes = await t.db<
      { emergency: boolean }[]
    >`select emergency from lineup_changes where fixture_id = ${f!.id}`;
    expect(changes.filter((c) => c.emergency)).toHaveLength(3);
    // Reused the next round instead of calling up more.
    const [n] = await t.db<
      { n: number }[]
    >`select count(*)::int as n from players where emergency_season_id is not null`;
    expect(n!.n).toBe(3);
    // Never in the squad.
    const team = await get("/teams/harbour-city", TeamDetailResponse);
    expect(team.players.some((p) => emergency.some((e) => e.id === p.id))).toBe(false);
    expect(team.players).toHaveLength(16);
  });

  it("the match page, the reports' facts, the club and the player page all say who was missing and why", async () => {
    const [f] = await t.db<{ match_id: string }[]>`
      select m.id as match_id from fixtures f join matches m on m.fixture_id = f.id
      where f.season_id = ${seasonId} and f.round = 3 and ${hbc}::uuid in (f.home_team_id, f.away_team_id)`;
    const detail = await get(`/matches/${f!.match_id}`, MatchDetailResponse);
    expect(detail.absences!.length).toBeGreaterThanOrEqual(3); // only injured starters need replacing
    expect(detail.absences!.filter((a) => a.emergency)).toHaveLength(3);
    const statements = (await matchFacts(t.db, f!.match_id)).facts.map((x) => x.statement).join("\n");
    expect(statements).toMatch(
      /missed the match injured, and Harbour City had nobody fit to replace them: .+ started as an emergency call-up/,
    );
    const [e] = await t.db<{ id: string }[]>`select id from players where emergency_season_id is not null limit 1`;
    const profile = await get(`/players/${e!.id}`, PlayerProfileResponse);
    expect(profile.career.emergency).toEqual({ slug: "season-1", name: "Season 1" });
    expect(profile.career.retired).toBeNull();
    expect(INJURY.emergency.deficit).toBeGreaterThan(0);
  });
});
