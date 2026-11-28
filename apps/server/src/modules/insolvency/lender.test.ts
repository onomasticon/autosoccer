import { ClubFinancesResponse, SeasonMarketResponse } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { seedManagers } from "../agents/service.ts";
import { createPhase2Season } from "../contracts/scheduler.ts";
import { registeredTeam, signContract } from "../contracts/service.ts";
import { apply, leagueBySlug } from "../league/leagues.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { seedTeams } from "../league/service.ts";
import { schedulerTick } from "../ops/scheduler.ts";
import { borrowSecured, debtOf, lenderRound } from "./lender.ts";

const T0 = new Date("2027-04-01T09:00:00Z");
const LATER = new Date("2027-06-01T09:00:00Z");

/**
 * A league that can't afford its wages: three clubs pay Ȼ6m a player (a Ȼ96m bill against Ȼ12m of opening
 * cash and about Ȼ11m of income), so the lender has to use every tool it has; the fourth is cheap and
 * has cash to bid at the lender's auctions.
 */
describe("insolvency/2: the league lender under distress", () => {
  let t: TestDatabase;
  let seasonId: string;
  let teams: string[];

  beforeAll(async () => {
    t = await createTestDatabase();
    await apply(t.db, "create", { slug: "founders", confirm: "founders", name: "The Founders League" });
    const league = (await leagueBySlug(t.db, "founders"))!;
    await seedTeams(t.db);
    ({ seasonId } = await createPhase2Season(t.db, {
      leagueId: league.id,
      slug: "founders-season-2",
      name: "Season 2",
      seed: 9,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      opens: T0,
      budgetPerTeamMicroUsd: 1_000_000,
    }));
    await seedManagers(t.db, seasonId, "claude-opus-5-5");
    teams = (await t.db<{ id: string }[]>`select id from teams order by slug`).map((r) => r.id);
    // The cheap club runs the Phase 2 target squad of 14 (room to buy at auctions; the max is 16).
    const spare = await t.db<{ id: string }[]>`
      select id from players where team_id = ${teams[3]!} and position <> 'GK' order by shirt_number desc limit 2`;
    for (const p of spare) {
      await t.db`delete from player_registrations where player_id = ${p.id}`;
      await t.db`update players set team_id = null where id = ${p.id}`;
    }
    // Three clubs far beyond their means; the fourth cheap, with cash to bid at the lender's auctions.
    for (const [i, team] of teams.entries()) {
      const ps = await t.db<{ id: string }[]>`select id from players where team_id = ${team} order by shirt_number`;
      for (const p of ps)
        await signContract(t.db, {
          playerId: p.id,
          teamId: team,
          seasonId,
          wage: i < 3 ? 6_000_000 : 400_000,
          years: 3,
          startsSeason: 2,
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
      await schedulerTick(t.db, { respectSchedule: false, now });
      await worker.drain();
      const [s] = await t.db<{ status: string }[]>`select status from seasons where id = ${seasonId}`;
      if (s!.status === "completed") break;
      const [pre] = await t.db<
        { phase: string }[]
      >`select phase from market_windows where season_id = ${seasonId} and kind = 'preseason'`;
      if (pre!.phase === "closed") now = LATER;
    }
  }, 300_000);
  afterAll(async () => {
    await t.drop();
  });

  it("plays every fixture: no withdrawals, walkovers or void matches", async () => {
    const [s] = await t.db`select status from seasons where id = ${seasonId}`;
    expect(s!.status).toBe("completed");
    const [f] =
      await t.db`select count(*)::int as n from fixtures where season_id = ${seasonId} and (status <> 'completed' or outcome is not null)`;
    expect(f!.n).toBe(0);
    const [w] = await t.db`select count(*)::int as n from club_withdrawals where season_id = ${seasonId}`;
    expect(w!.n).toBe(0);
  });

  it("uses its tools: emergency loans, defaults, forced auctions, administration and support", async () => {
    const outcomes = (
      await t.db<{ outcome: string }[]>`select distinct outcome from lender_checks where season_id = ${seasonId}`
    ).map((r) => r.outcome);
    expect(outcomes).toEqual(expect.arrayContaining(["emergency", "default"]));
    const kinds = (await t.db<{ kind: string }[]>`select distinct kind from club_loans`).map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["emergency", "support"]));
    const [adm] = await t.db`select count(*)::int as n from administrations`;
    expect(adm!.n).toBeGreaterThan(0);
    const [auctions] = await t.db`select count(*)::int as n from collateral_auctions`;
    expect(auctions!.n).toBeGreaterThan(0);
  });

  it("an auctioned player moves with his contract and is registered for his new club from that round", async () => {
    const sold = await t.db<
      { player_id: string; winner_team_id: string; seller_team_id: string; round: number; amount: string }[]
    >`
      select player_id, winner_team_id, seller_team_id, round, amount::text from collateral_auctions where status = 'sold' order by round, player_id`;
    expect(sold.length).toBeGreaterThan(0);
    for (const a of sold) {
      expect(await registeredTeam(t.db, seasonId, a.player_id, a.round)).toBe(a.winner_team_id);
      if (a.round > 1) expect(await registeredTeam(t.db, seasonId, a.player_id, a.round - 1)).toBe(a.seller_team_id);
      const [c] =
        await t.db`select team_id from player_contracts where player_id = ${a.player_id} and status = 'active'`;
      expect(c!.team_id).toBe(a.winner_team_id);
    }
  });

  it("never sells below a viable squad, and every club ends with cash in hand", async () => {
    for (const team of teams) {
      const [sq] = await t.db<{ n: number; gk: number }[]>`
        select count(*)::int as n, count(*) filter (where position = 'GK')::int as gk from players where team_id = ${team}`;
      expect(sq!.n).toBeGreaterThanOrEqual(9);
      expect(sq!.gk).toBeGreaterThanOrEqual(1);
      const [cash] = await t.db<
        { n: string }[]
      >`select coalesce(sum(amount), 0)::text as n from club_ledger where team_id = ${team}`;
      expect(Number(cash!.n)).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the debt books straight: every loan is the sum of its entries, money in equals money out, no free money", async () => {
    const [mismatch] = await t.db`
      select count(*)::int as n from club_loans l
      where (l.status = 'repaid') <> (coalesce((select sum(amount) from loan_entries e where e.loan_id = l.id), 0) <= 0)`;
    expect(mismatch!.n).toBe(0);
    // Cash lent equals disbursements; cash repaid equals repayments.
    const [lent] = await t.db<{ cash: string; debt: string }[]>`
      select (select coalesce(sum(amount), 0) from club_ledger where kind = 'loan')::text as cash,
             (select coalesce(sum(amount), 0) from loan_entries where kind = 'disbursement')::text as debt`;
    expect(lent!.cash).toBe(lent!.debt);
    const [paid] = await t.db<{ cash: string; debt: string }[]>`
      select (select coalesce(sum(amount), 0) from club_ledger where kind = 'repayment')::text as cash,
             (select coalesce(sum(amount), 0) from loan_entries where kind = 'repayment')::text as debt`;
    expect(paid!.cash).toBe(paid!.debt);
    const [auction] = await t.db<
      { n: string }[]
    >`select coalesce(sum(amount), 0)::text as n from club_ledger where kind = 'auction'`;
    expect(Number(auction!.n)).toBe(0);
    const [takeover] = await t.db`select count(*)::int as n from club_ledger where kind = 'takeover'`;
    expect(takeover!.n).toBe(0);
    // Season end: interest accrued on whatever is still owed.
    const [interest] = await t.db`select count(*)::int as n from loan_entries where kind = 'interest'`;
    expect(interest!.n).toBeGreaterThan(0);
  });

  it("publishes each distressed club's debt and recovery, and the auctions (without the sealed bids)", async () => {
    const app = createApp({ db: t.db, store: new MemoryReplayStore() });
    const [seller] = await t.db<{ slug: string; id: string }[]>`
      select t.slug, t.id from collateral_auctions a join teams t on t.id = a.seller_team_id where a.status = 'sold' limit 1`;
    const f = ClubFinancesResponse.parse(await (await app.request(`/api/v1/teams/${seller!.slug}/finances`)).json());
    expect(f.debt).not.toBeNull();
    expect(f.debt!.loans.length).toBeGreaterThan(0);
    expect(f.debt!.events.some((e) => e.outcome === "default")).toBe(true);
    expect(f.debt!.auctions.some((a) => a.role === "sold" && a.amount! > 0 && a.bidders > 0)).toBe(true);
    const [owed] = await t.db<{ n: string }[]>`
      select coalesce(sum(e.amount), 0)::text as n from loan_entries e join club_loans l on l.id = e.loan_id
      where l.team_id = ${seller!.id} and l.status = 'active'`;
    expect(f.debt!.total).toBe(Number(owed!.n));
    // Phase 2 money lines add up to the season's net.
    for (const s of f.seasons) expect(Object.values(s.bySource).reduce((a, b) => a + b, 0)).toBe(s.net);
    const m = SeasonMarketResponse.parse(await (await app.request("/api/v1/seasons/founders-season-2/market")).json());
    expect(m.auctions.length).toBeGreaterThan(0);
    const [bid] = await t.db<{ bids: Array<{ amount: number }> }[]>`
      select bids from collateral_auctions where jsonb_array_length(bids) > 1 limit 1`;
    if (bid) {
      const losing = bid.bids.map((b) => b.amount).filter((a) => !m.auctions.some((x) => x.amount === a));
      for (const a of losing) expect(JSON.stringify(m.auctions)).not.toContain(`"amount":${a}`);
    }
  });

  it("is exactly once: re-running a round's check changes nothing", async () => {
    const before = await t.db`select count(*)::int as n from club_ledger`;
    expect(await lenderRound(t.db, seasonId, 3)).toEqual([]);
    expect(await t.db`select count(*)::int as n from club_ledger`).toEqual(before);
  });
});

describe("insolvency/2: secured borrowing", () => {
  let t: TestDatabase;
  let seasonId: string;
  let team: string;
  let players: string[];

  beforeAll(async () => {
    t = await createTestDatabase();
    await apply(t.db, "create", { slug: "founders", confirm: "founders", name: "The Founders League" });
    const league = (await leagueBySlug(t.db, "founders"))!;
    await seedTeams(t.db);
    ({ seasonId } = await createPhase2Season(t.db, {
      leagueId: league.id,
      slug: "founders-season-2",
      name: "Season 2",
      seed: 3,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      opens: T0,
      budgetPerTeamMicroUsd: 0,
    }));
    team = (await t.db<{ id: string }[]>`select id from teams order by slug limit 1`)[0]!.id;
    players = (await t.db<{ id: string }[]>`select id from players where team_id = ${team} order by shirt_number`).map(
      (r) => r.id,
    );
    // Long contracts for everyone but the last player, whose contract ends this season.
    for (const [i, p] of players.entries())
      await signContract(t.db, {
        playerId: p,
        teamId: team,
        seasonId,
        wage: 600_000,
        years: i === players.length - 1 ? 1 : 4,
        startsSeason: 2,
        via: "founding",
      });
  });
  afterAll(async () => {
    await t.drop();
  });

  it("lends at most the loan-to-value of the pledged players, and never twice against one player", async () => {
    const pledge = players.slice(0, 3);
    const tooMuch = await borrowSecured(t.db, seasonId, team, 50_000_000, pledge);
    expect(tooMuch).toMatchObject({ ok: false, reason: expect.stringMatching(/at most/) });
    const ok = await borrowSecured(t.db, seasonId, team, 500_000, pledge);
    expect(ok.ok).toBe(true);
    expect(await debtOf(t.db, team)).toBe(500_000);
    const [cash] = await t.db<
      { n: string }[]
    >`select coalesce(sum(amount), 0)::text as n from club_ledger where team_id = ${team} and kind = 'loan'`;
    expect(Number(cash!.n)).toBe(500_000);
    const twice = await borrowSecured(t.db, seasonId, team, 100_000, [players[0]!]);
    expect(twice).toMatchObject({ ok: false, reason: expect.stringMatching(/pledged/) });
  });

  it("won't take a player whose contract ends before the loan does, or one from another club", async () => {
    const short = await borrowSecured(t.db, seasonId, team, 100_000, [players.at(-1)!]);
    expect(short).toMatchObject({ ok: false, reason: expect.stringMatching(/contract ends/) });
    const [other] = await t.db<{ id: string }[]>`select id from players where team_id <> ${team} limit 1`;
    expect(await borrowSecured(t.db, seasonId, team, 100_000, [other!.id])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/isn't at the club/),
    });
  });
});
