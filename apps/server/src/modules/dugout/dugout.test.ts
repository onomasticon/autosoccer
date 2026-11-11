import { DugoutResponse, TeamDugoutResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { type ComputeGate, managerRoundHook, seedManagers } from "../agents/service.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { tacticChanges } from "./read.ts";

const MODEL = "claude-opus-5-5";

describe("Inside the Dugout read model", () => {
  let t: TestDatabase;
  let seasonId: string;
  let app: ReturnType<typeof createApp>;
  const refused = new Set<string>();
  let worker: ReturnType<typeof createWorker>;
  const gate: ComputeGate = {
    reserve: async ({ teamId }) => !refused.has(teamId),
    settle: async () => {},
    release: async () => {},
  };
  const playRounds = async (n: number) => {
    const hook = managerRoundHook(t.db);
    const done = async () =>
      (
        await t.db<{ n: number }[]>`
          select count(distinct round)::int as n from fixtures f where season_id = ${seasonId}
            and not exists (select 1 from fixtures g where g.season_id = f.season_id and g.round = f.round and g.status <> 'completed')`
      )[0]!.n;
    const target = (await done()) + n;
    for (let i = 0; i < 100 && (await done()) < target; i++) {
      const a = await advanceSeason(t.db, seasonId, { beforeRound: hook });
      await worker.drain();
      if (a.state === "completed") break;
    }
    await worker.drain();
  };
  const dugout = async () => DugoutResponse.parse(await (await app.request("/api/v1/seasons/season-1/dugout")).json());
  const teamId = async (slug: string) =>
    (await t.db<{ id: string }[]>`select id from teams where slug = ${slug}`)[0]!.id;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 99,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
    }));
    await seedManagers(t.db, seasonId, MODEL);
    worker = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm(MODEL),
        gate,
        halfDurationSec: 10,
      }),
    });
    app = createApp({ db: t.db, store: new MemoryReplayStore() });
  }, 60_000);
  afterAll(async () => {
    await t.drop();
  });

  it("before a ball is kicked: one upcoming chapter on the opening plan, nothing featured", async () => {
    const d = await dugout();
    expect(d.contract).toBe("dugout/1");
    expect(d.featured).toBeNull();
    expect(d.stories).toHaveLength(4);
    for (const s of d.stories) {
      expect(s.manager).not.toBeNull();
      expect(s.chapters).toHaveLength(1);
      expect(s.chapters[0]).toMatchObject({ status: "upcoming", round: 1, result: null, reflection: null });
      expect(s.chapters[0]!.decision.status).toBe("opening");
      expect(s.chapters[0]!.decision.rationale).toBeNull();
      expect(s.seasonComplete).toBe(false);
    }
  });

  it("after round 1: decision → result → lesson for every club, and the next fixture", async () => {
    await playRounds(1);
    const d = await dugout();
    for (const s of d.stories) {
      expect(s.chapters.map((c) => c.status)).toEqual(["completed", "upcoming"]);
      const [played, next] = s.chapters as [(typeof s.chapters)[0], (typeof s.chapters)[0]];
      // Round 1: the manager re-deployed the opening plan, giving their own reason.
      expect(["new", "kept"]).toContain(played.decision.status);
      expect(played.decision.rationale).toMatch(/Opening match/);
      expect(played.decision.changes).toEqual([]);
      expect(played.result).not.toBeNull();
      expect(played.reflection).toMatchObject({ status: "reviewed" });
      expect(played.reflection!.lesson).toBeTruthy();
      expect(next.round).toBe(2);
    }
    expect(d.featured).not.toBeNull();
  });

  it("two managers read the same official result differently", async () => {
    const d = await dugout();
    const f = d.featured!;
    const { home, away } = f.sides;
    expect(home.result!.matchId).toBe(f.matchId);
    expect(away.result!.matchId).toBe(f.matchId);
    expect(home.result!.goalsFor).toBe(f.home.score);
    expect(away.result!.goalsFor).toBe(f.away.score);
    expect(home.reflection!.lesson && away.reflection!.lesson).toBeTruthy();
    // If any match of that round produced two different lessons, that's the one featured.
    const roundHasContrast = d.stories.some((s) =>
      s.chapters.some((c) => {
        if (c.round !== f.round || !c.result) return false;
        const opp = d.stories.find((o) => o.team.id === c.opponent.id)!;
        const theirs = opp.chapters.find((x) => x.fixtureId === c.fixtureId)!;
        return c.reflection?.lesson !== theirs.reflection?.lesson;
      }),
    );
    if (roundHasContrast) expect(home.reflection!.lesson).not.toBe(away.reflection!.lesson);
  });

  it("a decision and a review skipped for budget are shown as such, with nothing invented", async () => {
    const hc = await teamId("harbour-city");
    refused.add(hc);
    await playRounds(1);
    refused.delete(hc);
    const s = TeamDugoutResponse.parse(await (await app.request("/api/v1/teams/harbour-city/dugout")).json()).story;
    const r2 = s.chapters.find((c) => c.round === 2)!;
    expect(r2.status).toBe("completed");
    expect(r2.decision.status).toBe("skipped_budget");
    expect(r2.decision.rationale).toBeNull();
    expect(r2.decision.changes).toEqual([]); // kept the last valid tactics
    expect(r2.decision.revisionVersion).toBe(s.chapters[0]!.decision.revisionVersion);
    expect(r2.reflection).toMatchObject({ status: "skipped_budget", lesson: null, summary: null });
  });

  it("successive tactical revisions show what changed", async () => {
    const d = await dugout();
    const changed = d.stories.flatMap((s) => s.chapters).filter((c) => c.decision.changes.length > 0);
    // Offline managers that lost round 1 adjust their setup for round 2.
    expect(changed.length).toBeGreaterThan(0);
    for (const c of changed) {
      expect(c.decision.status).toBe("new");
      for (const x of c.decision.changes) expect(x.from).not.toBe(x.to);
    }
  });

  it("never exposes prompts or private run payloads", async () => {
    const raw = await (await app.request("/api/v1/seasons/season-1/dugout")).text();
    expect(raw).not.toMatch(/You are |"system"|"user"|"prompt"|inputTokens|costMicroUsd|notes/);
  });

  it("season completed: no upcoming chapter and the story says so", async () => {
    await playRounds(10);
    const d = await dugout();
    for (const s of d.stories) {
      expect(s.seasonComplete).toBe(true);
      expect(s.chapters).toHaveLength(6);
      expect(s.chapters.every((c) => c.status === "completed")).toBe(true);
    }
  });

  it("404s for an unknown season or team", async () => {
    expect((await app.request("/api/v1/seasons/nope/dugout")).status).toBe(404);
    expect((await app.request("/api/v1/teams/nope/dugout")).status).toBe(404);
  });
});

describe("tacticChanges", () => {
  it("lists only changed fields, labelled", () => {
    const a = {
      formation: "2-1-1",
      lineHeight: "mid",
      width: "balanced",
      pressing: "mid",
      tempo: "balanced",
      passingRisk: "balanced",
      shooting: "balanced",
      dribbling: "sometimes",
      keeperDistribution: "short",
    } as const;
    expect(tacticChanges(a, { ...a, pressing: "high", formation: "2-2" })).toEqual([
      { field: "formation", label: "Formation", from: "2-1-1", to: "2-2" },
      { field: "pressing", label: "Pressing", from: "mid", to: "high" },
    ]);
    expect(tacticChanges(null, a)).toEqual([]);
  });
});
