import { ClubFinancesResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { managerFacts } from "../agents/facts.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { preMatchPrompt } from "../agents/prompts.ts";
import { managerRoundHook, seedManagers } from "../agents/service.ts";
import { rolloverSeason } from "../league/rollover.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { formatCredits, prizeFor, RULES, resultIncome, wageFor } from "./rules.ts";
import { clubPosition, settleFinances } from "./settle.ts";

const MODEL = "claude-opus-5-5";

describe("finance/1 rules", () => {
  it("wages rise with ability, rounded and floored; prizes by position; result income", () => {
    expect(wageFor(45)).toBe(30_000);
    expect(wageFor(62)).toBe(81_000);
    expect(wageFor(70)).toBeGreaterThan(wageFor(62));
    expect(wageFor(10)).toBe(RULES.wage.min);
    expect([1, 2, 3, 4, 9].map((p) => prizeFor(p))).toEqual([4_000_000, 2_500_000, 1_500_000, 800_000, 800_000]);
    expect([resultIncome(2, 1), resultIncome(1, 1), resultIncome(0, 3)]).toEqual([600_000, 250_000, 0]);
    expect([formatCredits(1_250_000), formatCredits(2_000_000), formatCredits(-450_000)]).toEqual([
      "1.25m cr",
      "2m cr",
      "−450k cr",
    ]);
  });
});

describe("club finances through the season lifecycle", () => {
  let t: TestDatabase;
  let legacy: string;
  let s1: string;
  let s2: string;
  const app = () => createApp({ db: t.db, store: new MemoryReplayStore() });
  const ledger = (where = t.db`true`) =>
    t.db<
      { team_id: string; season_id: string | null; round: number | null; kind: string; amount: string; key: string }[]
    >`
      select team_id, season_id, round, kind, amount::text, key from club_ledger where ${where} order by created_at, key`;

  async function play(seasonId: string, rounds = 99) {
    const worker = createWorker({
      db: t.db,
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
      if (open?.round != null && open.round > rounds) break;
      const a = await advanceSeason(t.db, seasonId, { beforeRound: hook });
      // A repeated scheduler tick (as with several workers or a retry) must change nothing.
      await advanceSeason(t.db, seasonId, { beforeRound: hook });
      if (a.state === "completed") break;
      await worker.drain();
    }
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    const base = {
      seed: 20261125,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-15T12:00:00Z"),
      roundIntervalMinutes: 240,
      playersPerTeam: 7 as const,
    };
    // A season from before club finances (the adoption boundary): never settled.
    ({ seasonId: legacy } = await createSeason(t.db, {
      ...base,
      slug: "season-0",
      name: "Season 0",
      financeRule: null,
    }));
    await seedManagers(t.db, legacy, MODEL);
    await play(legacy);
    ({ seasonId: s1 } = await createSeason(t.db, { ...base, slug: "season-1", name: "Season 1" }));
    await seedManagers(t.db, s1, MODEL);
    await play(s1);
    s2 = (
      await t.db<{ id: string }[]>`
      select id from seasons where slug = ${(await rolloverSeason(t.db, { managerModel: MODEL, editorialModel: MODEL }))!}`
    )[0]!.id;
    await play(s2, 1);
  }, 600_000);
  afterAll(async () => {
    await t.drop();
  });

  it("a season from before club finances settles nothing", async () => {
    expect(await ledger(t.db`season_id = ${legacy}`)).toEqual([]);
    expect(await settleFinances(t.db, legacy)).toBe(0);
  });

  it("settles each obligation exactly once: opening, distribution, wages per round, results, prize", async () => {
    const rows = await ledger(t.db`season_id = ${s1} or season_id is null`);
    for (const team of await t.db<{ id: string }[]>`select team_id as id from season_teams where season_id = ${s1}`) {
      const mine = rows.filter((r) => r.team_id === team.id);
      const count = (k: string) => mine.filter((r) => r.kind === k).length;
      expect(count("opening")).toBe(1);
      expect(count("distribution")).toBe(1);
      expect(count("prize")).toBe(1);
      expect(mine.filter((r) => r.kind === "payroll").map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(mine.filter((r) => r.kind === "payroll").every((r) => Number(r.amount) < 0)).toBe(true);
    }
    // Result income matches the official results exactly.
    const results = await t.db<{ home: string; away: string; hs: number; as: number }[]>`
      select f.home_team_id as home, f.away_team_id as away, m.home_score as hs, m.away_score as as
      from fixtures f join matches m on m.fixture_id = f.id where f.season_id = ${s1} and m.status = 'completed'`;
    const expected = results.reduce((s, r) => s + resultIncome(r.hs, r.as) + resultIncome(r.as, r.hs), 0);
    const paid = rows.filter((r) => r.kind === "result").reduce((s, r) => s + Number(r.amount), 0);
    expect(paid).toBe(expected);
    const prizes = rows
      .filter((r) => r.kind === "prize")
      .map((r) => Number(r.amount))
      .sort((a, b) => b - a);
    expect(prizes).toEqual(RULES.prize);
    // Running the reconciler again (a retry) writes nothing new.
    expect(await settleFinances(t.db, s1)).toBe(0);
  });

  it("carries the treasury across rollover: no second opening balance, a new distribution and wages", async () => {
    const { rule } = (await t.db<{ rule: string }[]>`select finance_rule as rule from seasons where id = ${s2}`)[0]!;
    expect(rule).toBe("finance/1");
    const rows = await ledger(t.db`season_id = ${s2}`);
    expect(rows.filter((r) => r.kind === "distribution")).toHaveLength(SEED_TEAMS.length);
    expect(rows.filter((r) => r.kind === "payroll").every((r) => r.round === 1)).toBe(true);
    expect(await ledger(t.db`kind = 'opening'`)).toHaveLength(SEED_TEAMS.length);
  });

  it("reconciles: the API balance is the sum of every entry, and by-season totals add up", async () => {
    for (const team of SEED_TEAMS) {
      const res = await app().request(`/api/v1/teams/${team.slug}/finances`);
      expect(res.status).toBe(200);
      const f = ClubFinancesResponse.parse(await res.json());
      const { sum } = (
        await t.db<{ sum: string }[]>`
        select sum(l.amount)::text as sum from club_ledger l join teams tm on tm.id = l.team_id where tm.slug = ${team.slug}`
      )[0]!;
      expect(f.balance).toBe(Number(sum));
      expect(f.active).toBe(true);
      expect(f.balance).toBe(RULES.opening + f.seasons.reduce((s, x) => s + x.net, 0));
      expect(f.payroll.roundsToPay).toBe(5);
      expect(f.headroom).toBe(f.balance - f.payroll.perRound * 5);
      expect(f.seasons.map((s) => s.season.slug)).toEqual(["season-1", "season-2"]);
    }
    expect((await app().request("/api/v1/teams/nobody/finances")).status).toBe(404);
  });

  it("managers see cash, wages still due and headroom before deciding", async () => {
    const [fx] = await t.db<
      { id: string; season_id: string; round: number; home_team_id: string; away_team_id: string }[]
    >`
      select id, season_id, round, home_team_id, away_team_id from fixtures where season_id = ${s2} and round = 2 limit 1`;
    const [mgr] = await t.db`select * from manager_agents where team_id = ${fx!.home_team_id}`;
    const facts = await managerFacts(t.db, fx!, fx!.home_team_id, mgr as never, { includeRound: false });
    const pos = await clubPosition(t.db, s2, fx!.home_team_id);
    expect(facts.finances).toMatchObject({ balance: pos!.balance, roundsToPay: 5 });
    expect(preMatchPrompt(facts)).toContain("## Club finances (fictional credits)");
    expect(preMatchPrompt(facts)).toContain("Headroom after those wages");
  });
});
