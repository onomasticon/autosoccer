import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { seedManagers } from "../agents/service.ts";
import { FINANCE_3 } from "../finance/rules.ts";
import { contractPayroll } from "../finance/settle.ts";
import { apply, leagueBySlug } from "../league/leagues.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { seedTeams } from "../league/service.ts";
import { schedulerTick } from "../ops/scheduler.ts";
import { createPhase2Season, tickMarketWindows } from "./scheduler.ts";
import { signContract } from "./service.ts";

const T0 = new Date("2027-04-01T09:00:00Z");
const LATER = new Date("2027-06-01T09:00:00Z");

describe("a compressed Phase 2 season through the scheduler and worker", () => {
  let t: TestDatabase;
  let seasonId: string;
  const ticks: Array<{ at: string; actions: string[] }> = [];

  beforeAll(async () => {
    t = await createTestDatabase();
    await apply(t.db, "create", { slug: "founders", confirm: "founders", name: "The Founders League" });
    const league = (await leagueBySlug(t.db, "founders"))!;
    await seedTeams(t.db);
    ({ seasonId } = await createPhase2Season(t.db, {
      leagueId: league.id,
      slug: "founders-season-2",
      name: "Season 2",
      seed: 42,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      opens: T0,
      budgetPerTeamMicroUsd: 1_000_000,
    }));
    await seedManagers(t.db, seasonId, "claude-opus-5-5");
    // Season 1's contracts: half end with season 1 (decided in this preseason window), half run on.
    const teams = await t.db<{ id: string }[]>`select id from teams order by slug`;
    for (const team of teams) {
      const ps = await t.db<{ id: string }[]>`select id from players where team_id = ${team.id} order by shirt_number`;
      for (const [i, p] of ps.entries())
        await signContract(t.db, {
          playerId: p.id,
          teamId: team.id,
          seasonId,
          wage: 600_000,
          years: i % 2 ? 1 : 3,
          startsSeason: 1,
          via: "founding",
        });
    }
    await apply(t.db, "activate", { slug: "founders", confirm: "founders" });
    const worker = createWorker({
      db: t.db,
      baseBackoffMs: 1,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm("claude-opus-5-5"),
        halfDurationSec: 10,
      }),
    });
    let now = new Date(T0.getTime() + 60_000);
    for (let i = 0; i < 120; i++) {
      const windows = await tickMarketWindows(t.db, { now }); // also runs inside schedulerTick; recorded here
      ticks.push({ at: now.toISOString(), actions: windows.map((w) => `${w.kind}:${w.action}`) });
      await schedulerTick(t.db, { respectSchedule: false, now });
      await worker.drain();
      const [s] = await t.db<{ status: string }[]>`select status from seasons where id = ${seasonId}`;
      if (s!.status === "completed") break;
      // Once the preseason window has closed, jump ahead: the calendar's midseason window is weeks away.
      const [pre] = await t.db<
        { phase: string }[]
      >`select phase from market_windows where season_id = ${seasonId} and kind = 'preseason'`;
      if (pre!.phase === "closed") now = LATER;
    }
  }, 300_000);
  afterAll(async () => {
    await t.drop();
  });

  it("builds the season from calendar/1, with both market windows and no transfer/1 window", async () => {
    const [s] =
      await t.db`select finance_rule, transfer_rule, insolvency_rule, status from seasons where id = ${seasonId}`;
    expect(s).toEqual({
      finance_rule: "finance/3",
      transfer_rule: "transfer/2",
      insolvency_rule: null,
      status: "completed",
    });
    const w = await t.db<{ kind: string; effective_round: number; phase: string }[]>`
      select kind, effective_round, phase from market_windows where season_id = ${seasonId} order by kind desc`;
    expect(w).toEqual([
      { kind: "preseason", effective_round: 1, phase: "closed" },
      { kind: "midseason", effective_round: 4, phase: "closed" },
    ]);
    const [legacy] = await t.db`select count(*)::int as n from transfer_windows where season_id = ${seasonId}`;
    expect(legacy!.n).toBe(0);
    const [first] = await t.db<
      { at: Date }[]
    >`select min(scheduled_at) as at from fixtures where season_id = ${seasonId}`;
    expect(first!.at.getTime()).toBeGreaterThan(T0.getTime() + 72 * 3_600_000); // after the 72h preseason window
  });

  it("ran every club's renewal and free-agency decisions through its manager, then settled each step once", async () => {
    const [runs] =
      await t.db`select count(*)::int as n from agent_runs where idempotency_key like 'contracts:%' and status = 'succeeded'`;
    expect(runs!.n).toBe(4 * 3); // preseason renewals + free agency, midseason free agency
    const [decisions] = await t.db`select count(*)::int as n from contract_decisions where source = 'manager'`;
    expect(decisions!.n).toBe(32);
    expect(ticks.flatMap((x) => x.actions)).toEqual(
      expect.arrayContaining([
        "preseason:queued",
        "preseason:settled-renewals",
        "preseason:settled-free-agency",
        "midseason:settled-free-agency",
      ]),
    );
  });

  it("holds the second half until the midseason window has closed", async () => {
    const [w] = await t.db<
      { closed_at: Date }[]
    >`select closed_at from market_windows where season_id = ${seasonId} and kind = 'midseason'`;
    const [r4] = await t.db<{ started: Date }[]>`
      select min(m.started_at) as started from matches m join fixtures f on f.id = m.fixture_id where f.season_id = ${seasonId} and f.round = 4`;
    const [r3] = await t.db<{ done: Date }[]>`
      select max(m.completed_at) as done from matches m join fixtures f on f.id = m.fixture_id where f.season_id = ${seasonId} and f.round = 3`;
    expect(r4!.started.getTime()).toBeGreaterThanOrEqual(w!.closed_at.getTime());
    expect(w!.closed_at.getTime()).toBeGreaterThanOrEqual(r3!.done.getTime());
  });

  it("pays wages from contracts, round by round, plus running costs, and the ledger reconciles", async () => {
    const teams = await t.db<{ team_id: string }[]>`select team_id from season_teams where season_id = ${seasonId}`;
    for (const { team_id } of teams)
      for (let round = 1; round <= 6; round++) {
        const [row] = await t.db<{ amount: string }[]>`
          select amount::text from club_ledger where key = ${`payroll:${seasonId}:${round}:${team_id}`}`;
        expect(Number(row!.amount)).toBe(-(await contractPayroll(t.db, seasonId, team_id, round)).perRound);
        expect((await contractPayroll(t.db, seasonId, team_id, round)).uncontracted).toBe(0);
      }
    const ops = await t.db<{ n: number; total: string }[]>`
      select count(*)::int as n, sum(amount)::text as total from club_ledger where season_id = ${seasonId} and kind = 'operating'`;
    expect(ops[0]!.n).toBe(4 * 6);
    expect(Number(ops[0]!.total)).toBe(-4 * 6 * Math.round(FINANCE_3.operatingPerSeason / 6));
    const prizes = await t.db<
      { n: number }[]
    >`select count(*)::int as n from club_ledger where season_id = ${seasonId} and kind = 'prize'`;
    expect(prizes[0]!.n).toBe(4);
    const [fees] = await t.db`select count(*)::int as n from club_ledger where kind = 'transfer'`;
    expect(fees!.n).toBe(0);
  });

  it("every fixture was played (no solvency forfeits in a Phase 2 season)", async () => {
    const [f] =
      await t.db`select count(*)::int as n from fixtures where season_id = ${seasonId} and (status <> 'completed' or outcome is not null)`;
    expect(f!.n).toBe(0);
  });
});
