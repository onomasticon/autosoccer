import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { apply, leagueBySlug } from "../league/leagues.ts";
import { REGISTRY } from "../models/registry.ts";
import { schedulerTick } from "../ops/scheduler.ts";
import { startInaugural, tickInaugural } from "./inaugural.ts";
import { offlineFounder } from "./offline.ts";
import { ROLLOVER_RULE, rolloverPhase2 } from "./rollover.ts";

const T0 = new Date("2027-05-01T09:00:00Z");
const MODELS = REGISTRY.filter((m) => m.status !== "reserve")
  .slice(4, 8)
  .map((m) => m.slug);

type Season = { id: string; slug: string; status: string };

describe("Phase 2 rollover: a new league runs on into its next season", () => {
  let t: TestDatabase;
  let leagueId: string;
  let s1: Season;
  let s2: Season;
  let veteran = { id: "", team_id: "" };
  let modelsBefore: string[] = [];
  let secondCall: unknown;

  beforeAll(async () => {
    t = await createTestDatabase();
    const db = t.db;
    await apply(db, "create", { slug: "relay", confirm: "relay", name: "The Relay League" });
    leagueId = (await leagueBySlug(db, "relay"))!.id;
    await startInaugural(db, "relay", { opens: T0, seed: 33, models: MODELS, budgetPerTeamMicroUsd: 1_000_000 });
    const worker = createWorker({
      db,
      baseBackoffMs: 1,
      handlers: buildHandlers({
        db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm("claude-opus-5-5"),
        llmFor: (m) => offlineManagerLlm(m),
        founderLlmFor: () => offlineFounder(),
        halfDurationSec: 10,
      }),
    });
    const seasons = () =>
      db<Season[]>`select id, slug, status from seasons where league_id = ${leagueId} order by created_at`;
    let now = new Date(T0.getTime() + 60_000);
    let activated = false;
    for (let i = 0; i < 400; i++) {
      await schedulerTick(db, { respectSchedule: false, now });
      await worker.drain();
      if (!activated) {
        const [tick] = await tickInaugural(db, { now });
        if (tick?.state === "ready") {
          await apply(db, "activate", { slug: "relay", confirm: "relay" });
          activated = true;
          // A 36-year-old always retires before the next season (ageing/1).
          [veteran = veteran] = await db<{ id: string; team_id: string }[]>`
            select p.id, p.team_id from players p join player_contracts c on c.player_id = p.id and c.status = 'active'
            where p.position <> 'GK' order by p.id limit 1`;
          await db`update players set born_season = ${2 - 36} where id = ${veteran.id}`;
          modelsBefore = (await db<{ model: string }[]>`select model from manager_agents order by team_id`).map(
            (m) => m.model,
          );
        }
      }
      const all = await seasons();
      s1 = all[0]!;
      if (all[1] && !s2) {
        s2 = all[1];
        secondCall = await rolloverPhase2(db, { now });
        // Season 2 is announced as the league's last, so it concludes instead of rolling over again.
        await apply(db, "final-season", { slug: "relay", confirm: "relay", season: s2.slug });
      }
      if (s2) {
        const [x] = await db<Season[]>`select id, slug, status from seasons where id = ${s2.id}`;
        s2 = x!;
        if (s2.status === "completed") {
          await schedulerTick(db, { respectSchedule: false, now });
          break;
        }
      }
      now = new Date(now.getTime() + 12 * 3_600_000);
    }
  }, 900_000);
  afterAll(async () => {
    await t.drop();
  });

  it("creates the next season with the same clubs and Phase 2 rules", async () => {
    expect(s1.status).toBe("completed");
    const [s] = await t.db`select slug, finance_rule, transfer_rule, insolvency_rule from seasons where id = ${s2.id}`;
    expect(s).toMatchObject({
      slug: "relay-season-2",
      finance_rule: "finance/3",
      transfer_rule: "transfer/2",
      insolvency_rule: "insolvency/2",
    });
    const clubs = async (id: string) =>
      (
        await t.db<{ team_id: string }[]>`select team_id from season_teams where season_id = ${id} order by team_id`
      ).map((r) => r.team_id);
    expect(await clubs(s2.id)).toEqual(await clubs(s1.id));
    const [phase] = await t.db<{ status: string; summary: Record<string, unknown> }[]>`
      select status, summary from league_phases where league_id = ${leagueId} and kind = 'rollover' and round = 2`;
    expect(phase).toMatchObject({ status: "settled", summary: { rule: ROLLOVER_RULE, from: "relay-season-1" } });
    // One graduate per retiree; emergency cover (injury/1) leaves at season end and isn't a retirement.
    expect(phase!.summary.retired).toBe(phase!.summary.graduates);
    expect(secondCall).toEqual([]); // idempotent: nothing more to do once the season exists
  });

  it("retires the veteran, ends his contract, and signs an academy graduate in his place", async () => {
    const [v] = await t.db`select retired_season_id from players where id = ${veteran.id}`;
    expect(v!.retired_season_id).toBe(s1.id);
    const [c] =
      await t.db`select count(*)::int as n from player_contracts where player_id = ${veteran.id} and status = 'active'`;
    expect(c!.n).toBe(0);
    const grads = await t.db<{ team_id: string; via: string; starts_season: number; wage: string }[]>`
      select p.team_id, c.via, c.starts_season, c.wage_per_season::text as wage from players p
      join player_contracts c on c.player_id = p.id and c.status = 'active' where p.academy_season_id = ${s1.id}`;
    expect(grads.length).toBeGreaterThanOrEqual(1);
    expect(grads.find((g) => g.team_id === veteran.team_id)).toMatchObject({ via: "academy", starts_season: 2 });
    for (const g of grads) expect(Number(g.wage)).toBeGreaterThan(0);
  });

  it("develops every club player and free agent for the new season", async () => {
    const [missing] = await t.db`
      select count(*)::int as n from players p
      where p.retired_season_id is null
        and (p.team_id in (select team_id from season_teams where season_id = ${s2.id}) or p.pool_league_id = ${leagueId})
        and not exists (select 1 from player_ratings r where r.player_id = p.id and r.season_id = ${s2.id})`;
    expect(missing!.n).toBe(0);
    const [aged] = await t.db`
      select count(*)::int as n from player_ratings where season_id = ${s2.id} and rule <> 'baseline'`;
    expect(aged!.n).toBeGreaterThan(0);
  });

  it("opens with the preseason window: renewals of the contracts that ended, then free agency", async () => {
    const w = await t.db<{ kind: string; phase: string; summary: { renewed?: number; released?: number } }[]>`
      select kind, phase, summary from market_windows where season_id = ${s2.id} order by opens_at`;
    expect(w.map((x) => [x.kind, x.phase])).toEqual([
      ["preseason", "closed"],
      ["midseason", "closed"],
    ]);
    expect((w[0]!.summary.renewed ?? 0) + (w[0]!.summary.released ?? 0)).toBeGreaterThan(0);
    // No contract that ended with season 1 is still active.
    const [stale] =
      await t.db`select count(*)::int as n from player_contracts where status = 'active' and ends_season < 2
      and team_id in (select team_id from season_teams where season_id = ${s2.id})`;
    expect(stale!.n).toBe(0);
  });

  it("carries cash and managers over: no second opening balance, the same models", async () => {
    const [opening] = await t.db`select count(*)::int as n from club_ledger where kind = 'opening'`;
    expect(opening!.n).toBe(MODELS.length);
    const models = (await t.db<{ model: string }[]>`select model from manager_agents order by team_id`).map(
      (m) => m.model,
    );
    expect(models).toEqual(modelsBefore);
  });

  it("plays season 2 in full, then concludes the league at its announced final season", async () => {
    expect(s2.status).toBe("completed");
    const [f] =
      await t.db`select count(*)::int as n from fixtures where season_id = ${s2.id} and status <> 'completed'`;
    expect(f!.n).toBe(0);
    const [l] = await t.db`select status from leagues where id = ${leagueId}`;
    expect(l!.status).toBe("concluded");
    const [n] = await t.db`select count(*)::int as n from seasons where league_id = ${leagueId}`;
    expect(n!.n).toBe(2);
  });
});
