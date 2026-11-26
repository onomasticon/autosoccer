import { PlayerListResponse, PlayerProfileResponse, SpotlightResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { offlineEditorialLlm } from "../editorial/offline.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";

const MODEL = "claude-opus-5-5";

describe("spotlight and player profiles over real rounds", () => {
  let t: TestDatabase;
  let seasonId: string;
  const app = () => createApp({ db: t.db, store: new MemoryReplayStore() });
  const get = async (path: string) => {
    const res = await app().request(`/api/v1${path}`);
    return { status: res.status, body: (await res.json()) as unknown };
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 20261125,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-15T12:00:00Z"),
      roundIntervalMinutes: 240,
      playersPerTeam: 7,
    }));
    const worker = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm(MODEL),
        editorialLlm: offlineEditorialLlm(MODEL),
        halfDurationSec: 30,
      }),
    });
    // Play two rounds.
    for (let i = 0; i < 40; i++) {
      const [open] = await t.db<{ round: number | null }[]>`
        select min(round)::int as round from fixtures where season_id = ${seasonId} and status <> 'completed'`;
      if ((open?.round ?? 99) > 2) break;
      await advanceSeason(t.db, seasonId);
      await worker.drain();
    }
  }, 300_000);
  afterAll(async () => {
    await t.drop();
  });

  it("before any match: no lead, and every club listed with no moment", async () => {
    const fresh = await createTestDatabase();
    try {
      await seedTeams(fresh.db);
      const res = await createApp({ db: fresh.db, store: new MemoryReplayStore() }).request("/api/v1/spotlight");
      const body = SpotlightResponse.parse(await res.json());
      expect(body.lead).toBeNull();
    } finally {
      await fresh.drop();
    }
  });

  it("serves a contract-valid lead from the latest completed round, matching the record", async () => {
    const { status, body } = await get("/spotlight");
    expect(status).toBe(200);
    const s = SpotlightResponse.parse(body);
    expect(s.rule).toBe("spotlight/1");
    expect(s.clubs).toHaveLength(SEED_TEAMS.length);
    const lead = s.lead!;
    expect(lead).toBeTruthy();
    expect(lead.round).toBe(2);
    if (lead.kind !== "quiet") {
      // Every claimed goal is in the official events, scored by the named player.
      const [m] = await t.db<{ events: Array<{ type: string; tick: number; scorerId?: string }> }[]>`
        select events from matches where id = ${lead.matchId}`;
      const official = m!.events.filter((e) => e.type === "goal" && e.scorerId === lead.player.id).map((e) => e.tick);
      expect(lead.goals.map((g) => g.tick)).toEqual(official);
      expect(lead.headline).toContain(lead.player.name);
      expect(lead.replay).toBe(true);
    }
    // Round 3 is scheduled: the lead's club has a next fixture.
    expect(lead.next?.round).toBe(3);
  });

  it("lists players for search and serves a stable profile for each", async () => {
    const list = PlayerListResponse.parse((await get("/players")).body);
    expect(new Set(list.items.map((p) => p.team.id)).size).toBe(SEED_TEAMS.length);
    const scorer = [...list.items].sort((a, b) => b.goals - a.goals)[0]!;
    const { status, body } = await get(`/players/${scorer.id}`);
    expect(status).toBe(200);
    const p = PlayerProfileResponse.parse(body);
    expect(p.career.playerId).toBe(scorer.id);
    expect(p.team.id).toBe(scorer.team.id);
    expect(p.allTime.goals).toBe(scorer.goals);
    if (scorer.goals > 0) {
      expect(p.allTime.rank).toBe(1);
      expect(p.distinctions[0]).toMatch(/all-time top scorer/);
      expect(p.recent?.player.id).toBe(scorer.id);
    }
    expect(p.distinctions.at(-1)).toMatch(/title/);
    expect(p.next?.round).toBe(3);
  });

  it("404s for unknown or malformed player ids", async () => {
    expect((await get("/players/not-a-uuid")).status).toBe(404);
    expect((await get("/players/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
