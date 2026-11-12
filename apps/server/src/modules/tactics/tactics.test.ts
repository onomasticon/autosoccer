import { DEFAULT_TACTICS, type Player, RevisionHistoryResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { insertFixture, insertSeason, insertTeam } from "../../testing/fixtures.ts";
import { type PlayerRow, toPlayer } from "../mappers.ts";
import { buildMatchRequest, playFixture } from "../matches/service.ts";
import { createRevision, latestValidRevision, tacticalDeployment } from "./service.ts";
import { validateRevision } from "./validate.ts";

let t: TestDatabase;
let season: string;
let home: string;
let away: string;
let squad: Player[];
beforeAll(async () => {
  t = await createTestDatabase();
  season = await insertSeason(t.db);
  home = await insertTeam(t.db, "harbour-city", "Harbour");
  away = await insertTeam(t.db, "rovers", "Rovers");
  squad = (await t.db<PlayerRow[]>`select * from players where team_id = ${home} order by shirt_number`).map(toPlayer);
});
afterAll(async () => {
  await t.drop();
});
const ids = (...n: number[]) => n.map((i) => squad[i - 1]!.id);

describe("validateRevision", () => {
  const valid = () => ({ deployment: tacticalDeployment(DEFAULT_TACTICS), starters: ids(1, 2, 3, 4, 5) });
  it("accepts a valid revision and derives reserves", () => {
    const v = validateRevision(squad, valid());
    expect(v).toMatchObject({ ok: true, errors: [] });
    expect(v.lineup!.reserves).toEqual(ids(6, 7));
  });
  it("allows reserves to start in outfield slots", () => {
    expect(validateRevision(squad, { ...valid(), starters: ids(1, 6, 3, 4, 7) }).ok).toBe(true);
  });
  it("rejects bad tactics, lineups and unsupported deployments with readable errors", () => {
    const ok = valid();
    const cases: Array<[Parameters<typeof validateRevision>[1], RegExp]> = [
      [{ ...ok, deployment: tacticalDeployment({ ...DEFAULT_TACTICS, formation: "4-4-2" }) }, /tactics\.formation/],
      [{ ...ok, deployment: tacticalDeployment({ ...DEFAULT_TACTICS, extra: 1 }) }, /tactics/],
      [
        { ...ok, deployment: { kind: "tactical", schemaVersion: "tactics/2", config: {} } },
        /unsupported tactics schema/,
      ],
      [{ ...ok, deployment: { kind: "scripted", sdkVersion: "1.2.0", artifactId: squad[0]!.id } }, /scripted/],
      [{ ...ok, starters: ids(1, 2, 3, 4) }, /exactly 5 starters/],
      [{ ...ok, starters: ids(1, 2, 2, 4, 5) }, /more than once/],
      [{ ...ok, starters: [...ids(1, 2, 3, 4), "00000000-0000-4000-8000-000000000000"] }, /not in this squad/],
      [{ ...ok, starters: ids(2, 1, 3, 4, 5) }, /slot 1 must be a goalkeeper/],
    ];
    for (const [input, re] of cases) {
      const v = validateRevision(squad, input);
      expect(v.ok).toBe(false);
      expect(v.errors.join("\n")).toMatch(re);
    }
  });
});

describe("revisions and match deployment", () => {
  it("versions revisions per team (concurrency-safe), storing rejected ones without selecting them", async () => {
    const results = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        createRevision(t.db, {
          teamId: home,
          seasonId: season,
          source: "manager",
          deployment: tacticalDeployment({ ...DEFAULT_TACTICS, pressing: i % 2 ? "high" : "low" }),
          starters: ids(1, 2, 3, 4, 5),
        }),
      ),
    );
    expect(results.map((r) => r.version).sort()).toEqual([1, 2, 3, 4]);
    const bad = await createRevision(t.db, {
      teamId: home,
      seasonId: season,
      source: "manager",
      deployment: tacticalDeployment({ ...DEFAULT_TACTICS, formation: "5-0" }),
      starters: ids(1, 2, 3, 4, 5),
      rationale: "try something illegal",
    });
    expect(bad).toMatchObject({ version: 5, status: "rejected" });
    expect(bad.validationErrors.length).toBeGreaterThan(0);
    expect((await latestValidRevision(t.db, home, season))!.version).toBe(4);
  });

  it("matches use the latest valid revision: its tactics and its starters in slot order", async () => {
    const rev = await createRevision(t.db, {
      teamId: home,
      seasonId: season,
      source: "manager",
      deployment: tacticalDeployment({ ...DEFAULT_TACTICS, formation: "1-1-2", lineHeight: "high" }),
      starters: ids(1, 6, 3, 4, 7),
      rationale: "push up",
    });
    const f = await insertFixture(t.db, season, home, away, 1, 77);
    const req = await buildMatchRequest({ db: t.db, store: new MemoryReplayStore() }, f);
    expect(req.home.tacticalRevisionId).toBe(rev.id);
    expect(req.home.deployment).toEqual(rev.deployment);
    expect(req.home.starters.map((s) => s.playerId)).toEqual(ids(1, 6, 3, 4, 7));
    expect(req.away.tacticalRevisionId).toBeNull();
    const out = await playFixture({ db: t.db, store: new MemoryReplayStore(), halfDurationSec: 15 }, f);
    const [m] = await t.db`select home_revision_id, status from matches where id = ${out.matchId}`;
    expect(m).toMatchObject({ home_revision_id: rev.id, status: "completed" });
  });

  it("exposes the full revision history for audit", async () => {
    const app = createApp({ db: t.db, store: new MemoryReplayStore() });
    const body = RevisionHistoryResponse.parse(
      await (await app.request("/api/v1/teams/harbour-city/revisions")).json(),
    );
    expect(body.items.map((r) => r.status)).toContain("rejected");
    expect(body.items.at(-1)!.rationale).toBe("push up");
  });
});

describe("7-a-side", () => {
  it("7-a-side seasons need seven starters and a 7-a-side formation, and play 7v7", async () => {
    const season7 = await insertSeason(t.db, "seven", undefined, 7);
    const all = ids(1, 2, 3, 4, 5, 6, 7);
    const shape7 = { ...DEFAULT_TACTICS, formation: "2-3-1" as const };
    expect(validateRevision(squad, { deployment: tacticalDeployment(shape7), starters: all }, 7).ok).toBe(true);
    const five = validateRevision(squad, { deployment: tacticalDeployment(DEFAULT_TACTICS), starters: all }, 7);
    expect(five.errors.join(" ")).toMatch(/2-1-1 is not a 7-a-side formation/);
    const short = validateRevision(squad, { deployment: tacticalDeployment(shape7), starters: ids(1, 2, 3, 4, 5) }, 7);
    expect(short.errors).toContain("exactly 7 starters are required (got 5)");

    const bad = await createRevision(t.db, {
      teamId: home,
      seasonId: season7,
      source: "manager",
      deployment: tacticalDeployment(DEFAULT_TACTICS),
      starters: ids(1, 2, 3, 4, 5),
    });
    expect(bad.status).toBe("rejected");
    const f = await insertFixture(t.db, season7, home, away, 1, 99);
    const req = await buildMatchRequest({ db: t.db, store: new MemoryReplayStore() }, f);
    expect(req.config.playersPerTeam).toBe(7);
    expect(req.home.starters).toHaveLength(7);
    // Default lineup fills GK, DF, DF, MF, MF, MF, FW; this test squad has only two MFs, so an FW fills the third.
    expect(req.away.starters.map((s) => s.position)).toEqual(["GK", "DF", "DF", "MF", "MF", "FW", "FW"]);
    const out = await playFixture({ db: t.db, store: new MemoryReplayStore(), halfDurationSec: 15 }, f);
    const [m] = await t.db`select status from matches where id = ${out.matchId}`;
    expect(m).toMatchObject({ status: "completed" });
  });
});
