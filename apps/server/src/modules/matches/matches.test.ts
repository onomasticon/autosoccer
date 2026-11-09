import { gunzipSync } from "node:zlib";
import { MatchDetailResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore, runMatch } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { createWorker } from "../../jobs/worker.ts";
import { insertFixture, insertSeason, insertTeam } from "../../testing/fixtures.ts";
import { defaultLineup } from "./lineup.ts";
import { buildMatchRequest, enqueueFixture, MATCH_JOB, matchJobHandler, playFixture } from "./service.ts";

let t: TestDatabase;
let season: string;
let home: string;
let away: string;
const store = new MemoryReplayStore();
const deps = () => ({ db: t.db, store, halfDurationSec: 20 });

beforeAll(async () => {
  t = await createTestDatabase();
  season = await insertSeason(t.db);
  home = await insertTeam(t.db, "harbour", "Harbour");
  away = await insertTeam(t.db, "rovers", "Rovers");
});
afterAll(async () => {
  await t.drop();
});

describe("default lineup", () => {
  it("fills GK, DF, DF, MF, FW by lowest shirt number and keeps the rest as reserves", () => {
    const p = (id: string, n: number, position: "GK" | "DF" | "MF" | "FW") => ({ id, shirtNumber: n, position });
    const l = defaultLineup([
      p("g", 1, "GK"),
      p("d1", 2, "DF"),
      p("d2", 3, "DF"),
      p("m", 4, "MF"),
      p("f", 5, "FW"),
      p("m2", 6, "MF"),
      p("f2", 7, "FW"),
    ]);
    expect(l).toEqual({ starters: ["g", "d1", "d2", "m", "f"], reserves: ["m2", "f2"] });
    expect(() => defaultLineup([p("d1", 2, "DF")])).toThrow(/GK/);
  });
});

describe("match jobs", () => {
  it("builds a valid request from persisted state with the pinned sim and fixture seed", async () => {
    const f = await insertFixture(t.db, season, home, away, 1, 1234);
    const req = await buildMatchRequest(deps(), f);
    expect(req.seed).toBe(1234);
    expect(req.home.starters.map((s) => s.position)).toEqual(["GK", "DF", "DF", "MF", "FW"]);
    expect(req.home.name).toBe("Harbour");
  });

  it("persists one match exactly once, even with duplicate enqueues and concurrent workers", async () => {
    const f = await insertFixture(t.db, season, away, home, 2, 99);
    const a = await enqueueFixture(t.db, f);
    const b = await enqueueFixture(t.db, f);
    expect(b.job.id).toBe(a.job.id);
    const workers = [1, 2, 3].map((i) =>
      createWorker({ db: t.db, workerId: `w${i}`, handlers: { [MATCH_JOB]: matchJobHandler(deps()) } }),
    );
    await Promise.all(workers.map((w) => w.drain()));
    // Even calling the handler directly again cannot record a second result.
    const again = await playFixture(deps(), f);
    expect(again.alreadyCompleted).toBe(true);

    const matches = await t.db`select * from matches where fixture_id = ${f}`;
    expect(matches.length).toBe(1);
    expect(matches[0]).toMatchObject({ status: "completed" });
    const replays = await t.db`select * from replay_artifacts where match_id = ${matches[0]!.id}`;
    expect(replays.length).toBe(1);
    expect(replays[0]!.verified).toBe(true);
    const [fx] = await t.db`select status from fixtures where id = ${f}`;
    expect(fx!.status).toBe("completed");
    const [job] = await t.db`select status, attempts, artifacts from jobs where id = ${a.job.id}`;
    expect(job).toMatchObject({ status: "succeeded", attempts: 1 });
    expect(job!.artifacts.map((x: { kind: string }) => x.kind)).toEqual(["match", "replay"]);
  });

  it("is reproducible: re-running the stored request gives the same score and final hash", async () => {
    const f = await insertFixture(t.db, await insertSeason(t.db, "repro"), home, away, 3, 2024);
    const out = await playFixture(deps(), f);
    const [m] = await t.db`select request, final_hash, home_score, away_score from matches where id = ${out.matchId}`;
    const rerun = await runMatch(m!.request, { store: new MemoryReplayStore() });
    expect(rerun.result.finalHash).toBe(m!.final_hash);
    expect(rerun.result.score).toEqual({ home: m!.home_score, away: m!.away_score });
  });

  it("a failed attempt keeps the frozen request; the retry completes the same match", async () => {
    const f = await insertFixture(t.db, await insertSeason(t.db, "retry"), away, home, 4, 7);
    let calls = 0;
    const flaky = {
      ...deps(),
      store: {
        put: async (k: string, b: Uint8Array) => {
          calls++;
          if (calls === 1) throw new Error("disk full");
          return store.put(k, b);
        },
        get: (u: string) => store.get(u),
      },
    };
    await enqueueFixture(t.db, f);
    const w = createWorker({ db: t.db, baseBackoffMs: 0, handlers: { [MATCH_JOB]: matchJobHandler(flaky) } });
    const r1 = await w.runOnce();
    expect(r1!.status).toBe("queued");
    const [failed] = await t.db`select id, status, request_hash from matches where fixture_id = ${f}`;
    expect(failed!.status).toBe("failed");
    const [fx] = await t.db`select status from fixtures where id = ${f}`;
    expect(fx!.status).toBe("failed");
    const r2 = await w.runOnce();
    expect(r2!.status).toBe("succeeded");
    const rows = await t.db`select id, status, request_hash from matches where fixture_id = ${f}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: failed!.id, status: "completed", request_hash: failed!.request_hash });
  });

  it("refuses a fixture pinned to a different simulator version (permanent failure)", async () => {
    const s2 = await insertSeason(t.db, "old-sim", "0000000");
    const f = await insertFixture(t.db, s2, home, away, 1, 5);
    await enqueueFixture(t.db, f);
    const w = createWorker({ db: t.db, handlers: { [MATCH_JOB]: matchJobHandler(deps()) } });
    const r = await w.runOnce();
    expect(r!.status).toBe("failed");
  });
});

describe("match API", () => {
  it("serves the match centre payload and the replay file", async () => {
    const f = await insertFixture(t.db, await insertSeason(t.db, "api"), home, away, 5, 31337);
    const { matchId } = await playFixture(deps(), f);
    const { createLogger } = await import("../../log.ts");
    const app = createApp({ db: t.db, store, log: createLogger("error") });
    const res = await app.request(`/api/v1/matches/${matchId}`);
    expect(res.status).toBe(200);
    const body = MatchDetailResponse.parse(await res.json());
    expect(body.fixture.home.name).toBe("Harbour");
    expect(body.lineups.home).toHaveLength(5);
    expect(body.replay?.verified).toBe(true);
    expect(body.events.filter((e) => e.type === "goal").length).toBe(
      (body.match.homeScore ?? 0) + (body.match.awayScore ?? 0),
    );

    const rep = await app.request(`/api/v1/matches/${matchId}/replay`);
    expect(rep.status).toBe(200);
    expect(rep.headers.get("content-type")).toBe("application/gzip");
    const file = JSON.parse(gunzipSync(Buffer.from(await rep.arrayBuffer())).toString());
    expect(file.finalHash).toBe(body.match.finalHash);
    const cached = await app.request(`/api/v1/matches/${matchId}/replay`, {
      headers: { "if-none-match": rep.headers.get("etag")! },
    });
    expect(cached.status).toBe(304);
  });

  it("404s unknown or malformed match ids", async () => {
    const app = createApp({ db: t.db, store });
    expect((await app.request("/api/v1/matches/not-a-uuid")).status).toBe(404);
    expect((await app.request("/api/v1/matches/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
