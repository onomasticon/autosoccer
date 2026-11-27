import { CharterResponse, crestSvg, type FoundingCharter, kitSvg } from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { apply, leagueBySlug } from "../league/leagues.ts";
import { seedTeams } from "../league/service.ts";
import { REGISTRY } from "../models/registry.ts";
import { offlineFounder } from "./offline.ts";
import { inviteFounders, MAX_ROUNDS, priority, runFounding, runFoundingRound } from "./service.ts";
import { charterProblems, clubSlug, emptyTaken, normaliseName } from "./validate.ts";

const MODELS = REGISTRY.filter((m) => m.status !== "reserve").map((m) => m.slug);

const charter = (over: Partial<FoundingCharter> = {}): FoundingCharter => ({
  name: "Quarry Lane",
  shortName: "QLA",
  nickname: "The Masons",
  city: "Quarry",
  stadium: "The Stoneyard",
  motto: "Built to last",
  culture: "Patient and local, stubborn about doing things properly.",
  philosophy: "Possession with purpose and a high line.",
  recruitment: "Young players with room to grow.",
  brand: {
    primaryColor: "#1F3A93",
    secondaryColor: "#F5F0E6",
    crest: { shape: "shield", glyph: "QL", pattern: "chevron" },
    home: { shirt: "#1F3A93", shorts: "#F5F0E6", socks: "#1F3A93", pattern: "hoops", trim: "#F5F0E6" },
    away: { shirt: "#F5F0E6", shorts: "#1F3A93", socks: "#F5F0E6", pattern: "plain", trim: "#1F3A93" },
  },
  ...over,
});

describe("charter validation", () => {
  it("accepts a clean charter", () => {
    expect(charterProblems(charter(), emptyTaken())).toEqual([]);
  });

  it("rejects unsafe text, real clubs, model names, taken names, illegible colours and clashing kits", () => {
    const taken = emptyTaken();
    taken.names.add(normaliseName("Quarry Lane FC"));
    taken.shortNames.add("QLA");
    const bad = charter({
      motto: "Visit www.example.com",
      culture: "We are the gpt club of the north, proudly.",
      brand: {
        ...charter().brand,
        secondaryColor: "#2A4AA0",
        away: { ...charter().brand.home, pattern: "plain" },
      },
    });
    const p = charterProblems(bad, taken);
    expect(p).toEqual(
      expect.arrayContaining([
        "motto contains a link",
        "culture names an AI model or company",
        'name "Quarry Lane" is already taken',
        "short name QLA is already taken",
        "home and away shirts are too similar to tell apart",
      ]),
    );
    expect(p.some((x) => x.startsWith("primary and secondary colours contrast"))).toBe(true);
    expect(charterProblems(charter({ name: "Real Madrid Reserves" }), emptyTaken())).toContain(
      "name imitates a real club",
    );
  });

  it("treats names that differ only in case, accents or 'FC' as the same", () => {
    expect(normaliseName("Árbol  F.C.")).toBe(normaliseName("arbol"));
    expect(clubSlug("Quarry Lane", new Set(["quarry-lane"]))).toBe("quarry-lane-2");
  });

  it("renders crests and kits deterministically, escaping text", () => {
    const b = charter().brand;
    expect(crestSvg(b)).toBe(crestSvg(b));
    expect(kitSvg(b.home)).toBe(kitSvg(b.home));
    expect(crestSvg(b, 'A "<b>" crest')).toContain("A &#34;&#60;b&#62;&#34; crest");
    expect(crestSvg(b)).toContain("<svg");
    expect(kitSvg(b.home)).not.toBe(kitSvg(b.away));
  });
});

describe("the founding event", () => {
  let t: TestDatabase;
  let leagueId: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    await seedTeams(t.db); // the original league's clubs: their names can't be reused
    await apply(t.db, "create", { slug: "founders", confirm: "founders", name: "The Founders League" });
    leagueId = (await leagueBySlug(t.db, "founders"))!.id;
    await inviteFounders(t.db, leagueId, MODELS);
  });
  afterAll(async () => {
    await t.drop();
  });

  it("settles a round's clashes in a fixed order, not by who answered first", async () => {
    const founders = await t.db<{ slug: string }[]>`select slug from founders where league_id = ${leagueId}`;
    expect(founders).toHaveLength(20);
    const order = [...founders].sort((a, b) => priority(leagueId, a.slug).localeCompare(priority(leagueId, b.slug)));
    expect(order.map((f) => f.slug)).not.toEqual(founders.map((f) => f.slug).sort()); // not alphabetical
    const llm = offlineFounder({ malformed: ["founder-zai-glm-5-3"], stubborn: ["founder-xai-grok-4-7"] });
    const r1 = await runFoundingRound(t.db, leagueId, () => llm);
    expect(r1.round).toBe(1);
    expect(r1.founded.length).toBeGreaterThan(5);
    expect(r1.rejected.length).toBeGreaterThan(0);
    const reasons = r1.rejected.flatMap((r) => r.reasons);
    expect(reasons.some((x) => x.includes("already taken"))).toBe(true);
    expect(reasons.some((x) => x.includes("valid charter"))).toBe(true);
    // A retried round changes nothing.
    const [n] = await t.db`select count(*)::int as n from founding_submissions`;
    expect(n!.n).toBe(20);
  });

  it("lets rejected founders resubmit, then leaves a founder that never fixes its charter awaiting an operator", async () => {
    const llm = offlineFounder({ stubborn: ["founder-xai-grok-4-7"] });
    await runFounding(t.db, leagueId, () => llm);
    const status = await t.db<{ slug: string; status: string; rounds: number }[]>`
      select slug, status, rounds from founders where league_id = ${leagueId} order by slug`;
    const stubborn = status.find((s) => s.slug === "founder-xai-grok-4-7")!;
    expect(stubborn).toMatchObject({ status: "awaiting", rounds: MAX_ROUNDS });
    expect(status.filter((s) => s.status === "founded").length).toBe(19);
    // No identity was invented for it.
    const [team] = await t.db`select team_id from founders where slug = 'founder-xai-grok-4-7'`;
    expect(team!.team_id).toBeNull();
  });

  it("founds unique clubs with the founder as manager, under its exact model", async () => {
    const clubs = await t.db<{ name: string; short_name: string; model: string; manager: string }[]>`
      select t.name, t.short_name, f.model, m.name as manager from founders f
      join teams t on t.id = f.team_id join manager_agents m on m.team_id = t.id where f.league_id = ${leagueId}`;
    expect(new Set(clubs.map((c) => normaliseName(c.name))).size).toBe(clubs.length);
    expect(new Set(clubs.map((c) => c.short_name)).size).toBe(clubs.length);
    for (const c of clubs) expect(c.manager).toBe(c.model);
    const original = await t.db<
      { name: string }[]
    >`select name from teams where slug in ('harbour-city', 'red-rock-rovers')`;
    for (const o of original) expect(clubs.map((c) => normaliseName(c.name))).not.toContain(normaliseName(o.name));
  });

  it("keeps the founding charter immutable", async () => {
    await expect(t.db`update club_charters set charter = '{}'`).rejects.toThrow(/immutable/);
    await expect(t.db`delete from club_charters`).rejects.toThrow(/immutable/);
  });

  it("publishes the charter only once the league is out of draft, labelled as offline", async () => {
    const [club] = await t.db<
      { slug: string }[]
    >`select t.slug from founders f join teams t on t.id = f.team_id limit 1`;
    const app = createApp({ db: t.db, store: new MemoryReplayStore() });
    expect((await app.request(`/api/v1/teams/${club!.slug}/charter`)).status).toBe(404);
    await t.db`update leagues set status = 'active', activated_at = now() where id = ${leagueId}`;
    const res = await app.request(`/api/v1/teams/${club!.slug}/charter`);
    const body = CharterResponse.parse(await res.json());
    expect(body.founder.live).toBe(false);
    expect(body.founder.provider).toBe("offline");
    expect(body.submissions.at(-1)!.accepted).toBe(true);
    expect(body.assets.crestSvg).toContain("<svg");
  });
});
