import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newsStory } from "../editorial/news.ts";
import { RULES, rulesFor, wageFor } from "../finance/rules.ts";
import { payrollFor, settleFinances } from "../finance/settle.ts";
import { LEAGUE_CLUBS, rolloverSeason, roundsFor } from "./rollover.ts";
import { EXPANSION_TEAMS, SEED_TEAMS } from "./seed-data.ts";
import { createSeason, seedTeams } from "./service.ts";

const MODEL = "claude-opus-5-5";

describe("finance/2", () => {
  it("pays a six-round season exactly as finance/1, and spreads the same season over 18 rounds", () => {
    const six = rulesFor("finance/2", 6);
    const eighteen = rulesFor("finance/2", 18);
    for (const ovr of [40, 60, 75, 90]) {
      expect(wageFor(ovr, six)).toBe(wageFor(ovr, RULES));
      expect(Math.abs(wageFor(ovr, eighteen) * 18 - wageFor(ovr, RULES) * 6)).toBeLessThanOrEqual(18_000);
    }
    expect(eighteen.result).toEqual({ win: 200_000, draw: 83_000, loss: 0 });
    expect(eighteen.prize).toHaveLength(10);
    expect(eighteen.prize.slice(0, 4)).toEqual(RULES.prize);
    expect(rulesFor("finance/1", 18)).toBe(RULES); // past seasons keep their rule
  });
});

describe("the league expands to ten clubs at rollover", () => {
  let t: TestDatabase;
  let s1: string;
  let s2: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db);
    ({ seasonId: s1 } = await createSeason(t.db, {
      slug: "season-1",
      name: "Season 1",
      seed: 20261126,
      budgetPerTeamMicroUsd: 1_000_000,
      editorialBudgetMicroUsd: 2_000_000,
      teamSlugs: SEED_TEAMS.map((x) => x.slug),
      startsAt: new Date("2026-11-20T04:00:00Z"),
      roundIntervalMinutes: 240,
      playersPerTeam: 7,
    }));
    await t.db`update seasons set status = 'completed', completed_at = now() where id = ${s1}`;
    const slug = await rolloverSeason(t.db, { managerModel: MODEL, editorialModel: MODEL });
    s2 = (await t.db<{ id: string }[]>`select id from seasons where slug = ${slug}`)[0]!.id;
  });
  afterAll(async () => {
    await t.drop();
  });

  it("six new clubs join, each with a full squad, registrations, ratings and an AI manager with an opening plan", async () => {
    const clubs = await t.db<{ slug: string }[]>`
      select t.slug from season_teams st join teams t on t.id = st.team_id where st.season_id = ${s2} order by t.slug`;
    expect(clubs).toHaveLength(LEAGUE_CLUBS);
    expect(clubs.map((c) => c.slug).sort()).toEqual([...SEED_TEAMS, ...EXPANSION_TEAMS].map((x) => x.slug).sort());
    for (const club of EXPANSION_TEAMS) {
      const [row] = await t.db<
        { players: number; registered: number; rated: number; manager: string | null; plans: number }[]
      >`
        select (select count(*)::int from players p where p.team_id = t.id) as players,
          (select count(*)::int from player_registrations r where r.team_id = t.id and r.season_id = ${s2}) as registered,
          (select count(*)::int from player_ratings pr join players p on p.id = pr.player_id
            where p.team_id = t.id and pr.season_id = ${s2}) as rated,
          (select name from manager_agents m where m.team_id = t.id) as manager,
          (select count(*)::int from tactical_revisions v where v.team_id = t.id and v.season_id = ${s2}) as plans
        from teams t where t.slug = ${club.slug}`;
      expect(row).toMatchObject({ players: 16, registered: 16, rated: 16, plans: 1 });
      expect(row!.manager).toBeTruthy();
    }
    // Nobody from the founding clubs moved, and no name is shared.
    const [dupes] = await t.db<{ n: number }[]>`
      select count(*)::int as n from (select name from players group by name having count(*) > 1) d`;
    expect(dupes!.n).toBe(0);
  });

  it("the season is a double round robin of 18 rounds: every club plays every other twice, once a round", async () => {
    expect(roundsFor(LEAGUE_CLUBS)).toBe(18);
    const fixtures = await t.db<{ round: number; home: string; away: string }[]>`
      select round, home_team_id as home, away_team_id as away from fixtures where season_id = ${s2}`;
    expect(fixtures).toHaveLength(90);
    expect(new Set(fixtures.map((f) => f.round)).size).toBe(18);
    const pairs = new Set(fixtures.map((f) => `${f.home}>${f.away}`));
    expect(pairs.size).toBe(90);
    for (let r = 1; r <= 18; r++) {
      const inRound = fixtures.filter((f) => f.round === r).flatMap((f) => [f.home, f.away]);
      expect(new Set(inRound).size).toBe(10);
    }
  });

  it("budgets follow the season's length; wages are a third a round, so a season costs about the same", async () => {
    const [s] = await t.db<{ budget: string; editorial: string; rule: string }[]>`
      select budget_per_team_micro_usd::text as budget, editorial_budget_micro_usd::text as editorial, finance_rule as rule
      from seasons where id = ${s2}`;
    expect(Number(s!.budget)).toBe(3_000_000); // 3× the rounds
    expect(Number(s!.editorial)).toBe(15_000_000); // 7.5× the matches
    expect(s!.rule).toBe("finance/2");
    const [ironbridge] = await t.db<{ id: string }[]>`select id from teams where slug = 'ironbridge-united'`;
    const pay = await payrollFor(t.db, s2, ironbridge!.id);
    const sixRoundEquivalent = pay.players.reduce((a, p) => a + wageFor(p.overall, RULES), 0);
    expect(Math.abs(pay.perRound * 18 - sixRoundEquivalent * 6)).toBeLessThan(sixRoundEquivalent / 5);
    // A new club gets the opening balance like a founder did.
    await t.db`update fixtures set status = 'ready' where season_id = ${s2} and round = 1`;
    await settleFinances(t.db, s2);
    const [open] = await t.db<{ amount: string }[]>`
      select amount::text from club_ledger where team_id = ${ironbridge!.id} and kind = 'opening'`;
    expect(Number(open!.amount)).toBe(RULES.opening);
  });

  it("is news: the league announces the expansion, the new clubs, their managers and the longer season", async () => {
    const story = (await newsStory(t.db, { topic: "league", seasonId: s2 }))!;
    expect(story.priority).toBe(90);
    const text = story.facts.map((f) => f.statement).join("\n");
    expect(text).toContain("The league expands from 4 to 10 clubs for Season 2");
    expect(text).toContain("Ironbridge United");
    expect(text).toContain("is played over 18 rounds, up from 6 last season");
    expect(text).toMatch(/Each new club has its own AI manager: .+ at Ironbridge United/);
    expect(story.teamIds).toHaveLength(6);
  });

  it("runs once: rolling over again changes nothing", async () => {
    expect(await rolloverSeason(t.db, { managerModel: MODEL, editorialModel: MODEL })).toBeNull();
    const [n] = await t.db<{ n: number }[]>`select count(*)::int as n from teams`;
    expect(n!.n).toBe(10);
  });
});
