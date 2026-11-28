import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertSeason } from "../../testing/fixtures.ts";
import { OfflineLlm } from "../agents/llm.ts";
import { seedManagers } from "../agents/service.ts";
import { apply, leagueBySlug } from "../league/leagues.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { createSeason, seedTeams } from "../league/service.ts";
import { type ContractFacts, offlineFreeAgentOffers, offlineRenewals } from "./decisions.ts";
import {
  contractFacts,
  openMarketWindow,
  registeredTeam,
  runContractDecision,
  settleFreeAgency,
  settleRenewals,
  signContract,
} from "./service.ts";

const llm = new OfflineLlm("claude-opus-5-5", {
  "contracts.renewals": (f) => offlineRenewals(f as ContractFacts),
  "contracts.free_agency": (f) => offlineFreeAgentOffers(f as ContractFacts),
});

describe("transfer/2 contracts, renewals and free agency", () => {
  let t: TestDatabase;
  let seasonId: string;
  let teams: Array<{ id: string; slug: string }>;
  const W = { opens: new Date("2027-04-01T09:00:00Z"), deadline: new Date("2027-04-04T09:00:00Z") };

  beforeAll(async () => {
    t = await createTestDatabase();
    await apply(t.db, "create", { slug: "founders", confirm: "founders", name: "The Founders League" });
    const league = (await leagueBySlug(t.db, "founders"))!;
    await seedTeams(t.db);
    ({ seasonId } = await createSeason(t.db, {
      slug: "founders-season-2",
      name: "Season 2",
      seed: 7,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      leagueId: league.id,
      financeRule: "finance/3",
      transferRule: "transfer/2",
    }));
    await seedManagers(t.db, seasonId, "claude-opus-5-5");
    teams = await t.db<{ id: string; slug: string }[]>`select id, slug from teams order by slug`;
    // Season 1's contracts: half end with season 1 (they expire now), half run to season 3.
    for (const team of teams) {
      const players = await t.db<
        { id: string }[]
      >`select id from players where team_id = ${team.id} order by shirt_number`;
      for (const [i, p] of players.entries())
        await signContract(t.db, {
          playerId: p.id,
          teamId: team.id,
          seasonId,
          wage: 500_000,
          years: i % 2 ? 1 : 3,
          startsSeason: 1,
          via: "founding",
        });
      await t.db`insert into club_ledger (team_id, season_id, kind, amount, key, rule, memo)
        values (${team.id}, null, 'opening', 12000000, ${`opening:${team.id}`}, 'finance/3', 'opening')`;
    }
  });
  afterAll(async () => {
    await t.drop();
  });

  it("refuses a season that doesn't use transfer/2", async () => {
    const legacy = await insertSeason(t.db, "season-1"); // transfer/1-era season: no transfer_rule
    await expect(openMarketWindow(t.db, legacy, "preseason", W.opens, W.deadline)).rejects.toThrow(
      /doesn't use transfer\/2/,
    );
  });

  it("gives each manager its expiring contracts, and records its renew/release calls", async () => {
    const w = await openMarketWindow(t.db, seasonId, "preseason", W.opens, W.deadline);
    expect(w).toMatchObject({ phase: "renewals", effective_round: 1 });
    expect(await openMarketWindow(t.db, seasonId, "preseason", W.opens, W.deadline)).toMatchObject({ id: w.id });
    const facts = await contractFacts(t.db, w, "renewals", teams[0]!.id);
    expect(facts.expiring).toHaveLength(8);
    // Three of four managers decide; the fourth (an outage) never answers.
    for (const team of teams.slice(0, 3)) {
      const out = await runContractDecision({ db: t.db, llm }, w.id, "renewals", team.id);
      expect(out.status).toBe("decided");
      expect(await runContractDecision({ db: t.db, llm }, w.id, "renewals", team.id)).toEqual({
        status: "already-done",
      });
    }
    const [n] = await t.db<
      { n: number }[]
    >`select count(*)::int as n from contract_decisions where window_id = ${w.id}`;
    expect(n!.n).toBe(24);
  });

  it("settles renewals once: releases become free agents, everyone else (and the silent club) is renewed", async () => {
    const [w] = await t.db<{ id: string }[]>`select id from market_windows where season_id = ${seasonId}`;
    const r = await settleRenewals(t.db, w!.id);
    expect(r!.released).toBeGreaterThan(0);
    expect(r!.renewed + r!.released).toBe(32);
    expect(await settleRenewals(t.db, w!.id)).toBeNull(); // exactly once
    const silent = await t.db<{ source: string; decision: string }[]>`
      select source, decision from contract_decisions where window_id = ${w!.id} and team_id = ${teams[3]!.id}`;
    expect(silent.every((d) => d.source === "default" && d.decision === "renew")).toBe(true);
    const free = await t.db<{ id: string }[]>`select id from players where team_id is null`;
    expect(free).toHaveLength(r!.released);
    for (const p of free) {
      expect(await registeredTeam(t.db, seasonId, p.id, 1)).toBeNull();
      const [c] =
        await t.db`select count(*)::int as n from player_contracts where player_id = ${p.id} and status = 'active'`;
      expect(c!.n).toBe(0);
    }
    const renewals = await t.db<
      { n: number }[]
    >`select count(*)::int as n from player_contracts where via = 'renewal' and status = 'active'`;
    expect(renewals[0]!.n).toBe(r!.renewed);
  });

  it("settles free agency together: wages only, one club each, no fee, registered from round 1", async () => {
    const [w] = await t.db<{ id: string }[]>`select id from market_windows where season_id = ${seasonId}`;
    const free = await t.db<{ id: string }[]>`select id from players where team_id is null`;
    for (const team of teams) await runContractDecision({ db: t.db, llm }, w!.id, "free_agency", team.id);
    const offers = await t.db<
      { n: number }[]
    >`select count(*)::int as n from free_agent_offers where window_id = ${w!.id}`;
    expect(offers[0]!.n).toBeGreaterThan(0);
    const res = await settleFreeAgency(t.db, w!.id);
    expect(res!.signed).toBeGreaterThan(0);
    expect(res!.signed).toBeLessThanOrEqual(free.length);
    expect(await settleFreeAgency(t.db, w!.id)).toBeNull();
    const signed = await t.db<{ player_id: string; team_id: string }[]>`
      select player_id, team_id from player_contracts where via = 'free_agent' and status = 'active'`;
    for (const s of signed) expect(await registeredTeam(t.db, seasonId, s.player_id, 1)).toBe(s.team_id);
    const [fees] = await t.db`select count(*)::int as n from club_ledger where kind = 'transfer'`;
    expect(fees!.n).toBe(0);
    const outcomes = await t.db<
      { outcome: string | null }[]
    >`select outcome from free_agent_offers where window_id = ${w!.id}`;
    expect(outcomes.every((o) => o.outcome !== null)).toBe(true);
    // Shirts stay unique per club (the schema would refuse otherwise) and nobody has two active contracts.
    const [dup] =
      await t.db`select count(*)::int as n from (select player_id from player_contracts where status = 'active' group by 1 having count(*) > 1) x`;
    expect(dup!.n).toBe(0);
  });

  it("answers after the step has ended are refused, not applied", async () => {
    const [w] = await t.db<{ id: string }[]>`select id from market_windows where season_id = ${seasonId}`;
    await t.db`delete from agent_runs where idempotency_key like ${`contracts:${w!.id}:free_agency:%`}`;
    expect((await runContractDecision({ db: t.db, llm }, w!.id, "free_agency", teams[0]!.id)).status).toBe("late");
  });

  it("a midseason signing takes effect from the second half: every round reads the club it was played for", async () => {
    const mid = await openMarketWindow(
      t.db,
      seasonId,
      "midseason",
      new Date("2027-04-10T09:00:00Z"),
      new Date("2027-04-11T09:00:00Z"),
    );
    expect(mid).toMatchObject({ phase: "free_agency", effective_round: 4 }); // 4 clubs: 6 rounds
    const [p] = await t.db<{ id: string; team_id: string }[]>`
      select p.id, p.team_id from players p join player_contracts c on c.player_id = p.id and c.status = 'active'
      where c.via = 'renewal' order by p.id limit 1`;
    // Free up a player and room at another club, then sign him there midseason.
    await t.db`update player_contracts set status = 'released', ended_at = now() where player_id = ${p!.id} and status = 'active'`;
    await t.db`update players set team_id = null where id = ${p!.id}`;
    const buyer = teams.find((x) => x.id !== p!.team_id)!;
    await t.db`delete from players where id in (select id from players where team_id = ${buyer.id} and position <> 'GK' order by shirt_number desc limit 2)`;
    await t.db`insert into free_agent_offers (window_id, player_id, team_id, wage_per_season, years, reason)
      values (${mid.id}, ${p!.id}, ${buyer.id}, 5000000, 2, 'test')`;
    expect((await settleFreeAgency(t.db, mid.id))!.signed).toBe(1);
    expect(await registeredTeam(t.db, seasonId, p!.id, 3)).toBe(p!.team_id);
    expect(await registeredTeam(t.db, seasonId, p!.id, 4)).toBe(buyer.id);
  });
});
