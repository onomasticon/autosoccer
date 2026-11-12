import {
  ArticleDetailResponse,
  ArticleListResponse,
  EditorialFacts,
  JournalistDetailResponse,
  JournalistListResponse,
} from "@autosoccer/contracts";
import { createTestDatabase, type TestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { buildHandlers } from "../../jobs/handlers.ts";
import { createWorker } from "../../jobs/worker.ts";
import type { LlmClient, LlmRequest } from "../agents/llm.ts";
import { offlineManagerLlm } from "../agents/offline.ts";
import { managerRoundHook, seedManagers } from "../agents/service.ts";
import { SEED_TEAMS } from "../league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../league/service.ts";
import { auditPublishedArticles } from "./audit.ts";
import { matchFacts, roundFacts } from "./facts.ts";
import { type ArticleDraft, checkGrounding } from "./grounding.ts";
import { offlineEditorialLlm } from "./offline.ts";
import { seedJournalists, writeMatchReport } from "./service.ts";

const MODEL = "claude-opus-5-5";
const facts = (over: Partial<EditorialFacts> = {}): EditorialFacts => ({
  contract: "editorial-facts/1",
  seasonId: "00000000-0000-4000-8000-000000000001",
  matchId: "m",
  generatedFrom: { resultFinalHash: "h", standingsAfterRound: 1 },
  match: null,
  facts: [
    {
      id: "match:m:score",
      kind: "score",
      statement: "A 2–1 B",
      value: { home: 2, away: 1 },
      source: { table: "matches", id: "m" },
    },
    {
      id: "match:m:goal:1",
      kind: "goal",
      statement: "x",
      value: { score: { home: 1, away: 0 } },
      source: { table: "matches", id: "m" },
    },
    {
      id: "match:m:goal:2",
      kind: "goal",
      statement: "x",
      value: { score: { home: 1, away: 1 } },
      source: { table: "matches", id: "m" },
    },
  ],
  ...over,
});
const draft = (over: Partial<ArticleDraft> = {}): ArticleDraft => ({
  headline: "A beat B 2–1",
  standfirst: "A late goal settled it.",
  body: "A won 2–1. B levelled at 1–1 before that. A lined up in a 2-1-1 shape; B in a 3-1 formation.",
  citations: [{ factId: "match:m:score", text: "A won 2–1" }],
  ...over,
});

describe("grounding checks", () => {
  it("accepts an article that only uses official scorelines and cites real facts", () => {
    expect(checkGrounding(draft(), facts(), { requireScoreFact: "match:m:score" })).toEqual([]);
  });
  it("rejects invented scores, quotes, football minutes, unknown or missing citations", () => {
    const cases: Array<[Partial<ArticleDraft>, RegExp]> = [
      [{ body: "A won 3–1." }, /3–1 is not an official score/],
      [{ body: "A won 3-1 on the night." }, /3–1 is not an official score/],
      [{ body: "The coach said “we were brilliant”." }, /quotation/],
      [{ body: 'He said "great".' }, /quotation/],
      [{ body: "A scored in the 63rd minute." }, /football minutes/],
      [{ citations: [{ factId: "match:m:invented", text: "x" }] }, /unknown fact id/],
      [{ citations: [] }, /cite at least one/],
      [{ citations: [{ factId: "match:m:goal:1", text: "x" }] }, /must cite the official score/],
    ];
    for (const [over, re] of cases) {
      expect(checkGrounding(draft(over), facts(), { requireScoreFact: "match:m:score" }).join("\n")).toMatch(re);
    }
  });
});

/** Wraps the offline writer, optionally corrupting drafts, and counts calls. */
function newsroom(corrupt?: (n: number, d: ArticleDraft) => ArticleDraft) {
  const base = offlineEditorialLlm(MODEL);
  let n = 0;
  const llm: LlmClient = {
    provider: base.provider,
    model: base.model,
    async complete<T>(r: LlmRequest<T>) {
      const res = await base.complete(r);
      n++;
      return corrupt ? { ...res, output: corrupt(n, res.output as ArticleDraft) as T } : res;
    },
  };
  return { llm, calls: () => n };
}

describe("AI newsroom over a season", () => {
  let t: TestDatabase;
  let seasonId: string;
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
    await seedJournalists(t.db, MODEL);
    const worker = createWorker({
      db: t.db,
      handlers: buildHandlers({
        db: t.db,
        store: new MemoryReplayStore(),
        llm: offlineManagerLlm(MODEL),
        editorialLlm: newsroom().llm,
        halfDurationSec: 10,
      }),
    });
    const hook = managerRoundHook(t.db);
    for (let i = 0; i < 100; i++) {
      const a = await advanceSeason(t.db, seasonId, { beforeRound: hook });
      if (a.state === "completed") break;
      await worker.drain();
    }
    await worker.drain();
  }, 180_000);
  afterAll(async () => {
    await t.drop();
  });

  it("projects official facts with stable ids that match the record (no manager free text)", async () => {
    const [m] = await t.db<
      { id: string; home_score: number; away_score: number }[]
    >`select id, home_score, away_score from matches limit 1`;
    const f = EditorialFacts.parse(await matchFacts(t.db, m!.id));
    const score = f.facts.find((x) => x.id === `match:${m!.id}:score`)!;
    expect(score.value).toMatchObject({ home: m!.home_score, away: m!.away_score });
    expect(f.facts.filter((x) => x.id.includes(":goal:"))).toHaveLength(m!.home_score + m!.away_score);
    expect(f.facts.filter((x) => x.kind === "standing")).toHaveLength(4);
    for (const x of f.facts.filter((y) => y.kind === "tactics")) expect(x.statement).not.toMatch(/reasoning|rationale/);
    expect((await matchFacts(t.db, m!.id)).facts.map((x) => x.id)).toEqual(f.facts.map((x) => x.id));
  });

  it("standings facts are a snapshot as of the article's round, even when built after the season", async () => {
    const [m] = await t.db<{ id: string }[]>`
      select m.id from matches m join fixtures f on f.id = m.fixture_id where f.round = 1 limit 1`;
    const standings = (await matchFacts(t.db, m!.id)).facts.filter((f) => f.kind === "standing");
    expect(standings.map((f) => (f.value as { played: number }).played)).toEqual([1, 1, 1, 1]);
    expect(standings.every((f) => f.id.includes(":r1:"))).toBe(true);
    const r3 = (await roundFacts(t.db, seasonId, 3)).facts.filter((f) => f.kind === "standing");
    expect(r3.map((f) => (f.value as { played: number }).played)).toEqual([3, 3, 3, 3]);
  });

  it("continuity facts come only from stored history: earlier meetings and runs of form", async () => {
    const [first] = await t.db<{ id: string }[]>`
      select m.id from matches m join fixtures f on f.id = m.fixture_id where f.round = 1 limit 1`;
    const f1 = await matchFacts(t.db, first!.id);
    expect(f1.facts.filter((x) => x.statement.startsWith("Earlier meeting"))).toEqual([]); // no history yet
    expect(f1.facts.filter((x) => x.kind === "form")).toEqual([]);
    const [second] = await t.db<{ id: string; home: string; away: string }[]>`
      select m.id, f.home_team_id as home, f.away_team_id as away from matches m join fixtures f on f.id = m.fixture_id
      where f.round = 6 limit 1`;
    const f6 = await matchFacts(t.db, second!.id);
    const earlier = f6.facts.filter((x) => x.statement.startsWith("Earlier meeting"));
    expect(earlier).toHaveLength(1);
    const prevId = earlier[0]!.id.split(":")[1]!;
    const [prev] = await t.db<{ home_score: number; away_score: number; home: string; away: string }[]>`
      select m.home_score, m.away_score, f.home_team_id as home, f.away_team_id as away
      from matches m join fixtures f on f.id = m.fixture_id where m.id = ${prevId}`;
    expect(new Set([prev!.home, prev!.away])).toEqual(new Set([second!.home, second!.away]));
    expect(earlier[0]!.value).toMatchObject({ home: prev!.home_score, away: prev!.away_score });
    for (const x of f6.facts.filter((y) => y.kind === "form")) {
      const v = x.value as { recentFirst: string[] };
      const n = Number(/last (\d+)/.exec(x.statement)![1]);
      const head = v.recentFirst.slice(0, n);
      if (/have won/.test(x.statement)) expect(head.every((r) => r === "W")).toBe(true);
      if (/unbeaten/.test(x.statement)) expect(head.every((r) => r !== "L")).toBe(true);
      if (/without a win/.test(x.statement)) expect(head.every((r) => r !== "W")).toBe(true);
      expect(n).toBeGreaterThanOrEqual(2);
    }
  });

  it("publishes one grounded match report per match and one round piece per round", async () => {
    const rows = await t.db<
      { kind: string; status: string; n: number }[]
    >`select kind, status, count(*)::int as n from articles group by 1, 2 order by 1, 2`;
    expect(rows).toEqual([
      { kind: "analysis", status: "published", n: 3 },
      { kind: "column", status: "published", n: 3 },
      { kind: "match_report", status: "published", n: 12 },
    ]);
    const reports = await t.db<
      { match_id: string; citations: Array<{ factId: string }>; headline: string; standfirst: string; body: string }[]
    >`
      select match_id, citations, headline, standfirst, body from articles where kind = 'match_report'`;
    expect(new Set(reports.map((r) => r.match_id)).size).toBe(12);
    for (const r of reports) {
      const f = await matchFacts(t.db, r.match_id);
      expect(
        checkGrounding({ ...r, citations: r.citations.map((c) => ({ ...c, text: "" })) }, f, {
          requireScoreFact: `match:${r.match_id}:score`,
        }),
      ).toEqual([]);
    }
    for (const round of [1, 2, 3, 4, 5, 6]) {
      const [p] = await t.db<{ citations: Array<{ factId: string }> }[]>`
        select a.citations from articles a join agent_runs r on r.id = a.agent_run_id where r.idempotency_key = ${`article.round:${seasonId}:${round}`}`;
      const ids = new Set((await roundFacts(t.db, seasonId, round)).facts.map((f) => f.id));
      for (const c of p!.citations) expect(ids.has(c.factId)).toBe(true);
    }
    const [runs] =
      await t.db`select count(*)::int as n from agent_runs where agent_kind = 'editorial' and status = 'succeeded'`;
    expect(runs!.n).toBe(18);
  });

  it("the published-content audit passes the season's articles and flags a contradicting one, read-only", async () => {
    expect(await auditPublishedArticles(t.db)).toEqual([]);
    const [a] = await t.db<{ id: string; body: string; match_id: string }[]>`
      select a.id, a.body, a.match_id from articles a join matches m on m.id = a.match_id
      where a.kind = 'match_report' and m.home_score <> m.away_score order by m.completed_at, a.id limit 1`;
    const f = await matchFacts(t.db, a!.match_id);
    const { home, away } = f.match!;
    const loser = home.score < away.score ? home : away;
    const winner = loser === home ? away : home;
    const planted = `${a!.body}\n\n${loser.name} beat ${winner.name}.`;
    await t.db`update articles set body = ${planted} where id = ${a!.id}`;
    try {
      const findings = await auditPublishedArticles(t.db);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.errors.join()).toMatch(/contradiction|cannot verify/);
      const [still] = await t.db<
        { status: string; body: string }[]
      >`select status, body from articles where id = ${a!.id}`;
      expect(still).toEqual({ status: "published", body: planted });
    } finally {
      await t.db`update articles set body = ${a!.body} where id = ${a!.id}`;
    }
  });

  it("is idempotent: rewriting a report returns the existing one", async () => {
    const [m] = await t.db<{ match_id: string }[]>`select match_id from articles where kind = 'match_report' limit 1`;
    const { llm, calls } = newsroom();
    expect(await writeMatchReport({ db: t.db, llm }, m!.match_id)).toEqual({ status: "already-done" });
    expect(calls()).toBe(0);
  });

  it("serves articles and journalists, with AI disclosure, filters and related stories", async () => {
    const app = createApp({ db: t.db, store: new MemoryReplayStore() });
    const list = ArticleListResponse.parse(await (await app.request("/api/v1/articles?limit=50")).json());
    expect(list.total).toBe(18);
    expect(list.items.every((a) => a.aiGenerated)).toBe(true);
    const team = ArticleListResponse.parse(
      await (await app.request("/api/v1/articles?team=harbour-city&limit=50")).json(),
    );
    expect(team.items.filter((a) => a.kind === "match_report")).toHaveLength(6);
    const report = list.items.find((a) => a.kind === "match_report")!;
    const byMatch = ArticleListResponse.parse(
      await (await app.request(`/api/v1/articles?match=${report.matchId}`)).json(),
    );
    expect(byMatch.items.map((a) => a.id)).toEqual([report.id]);
    const detail = ArticleDetailResponse.parse(await (await app.request(`/api/v1/articles/${report.slug}`)).json());
    expect(detail.author.role).toBe("reporter");
    expect(detail.article.citations.length).toBeGreaterThan(0);
    expect(detail.related.length).toBeGreaterThan(0);
    const js = JournalistListResponse.parse(await (await app.request("/api/v1/journalists")).json());
    expect(js.items.map((j) => j.role).sort()).toEqual(["analyst", "pundit", "reporter"]);
    const nia = JournalistDetailResponse.parse(await (await app.request("/api/v1/journalists/nia-park")).json());
    expect(nia.articles).toHaveLength(12);
    expect((await app.request("/api/v1/articles/nope")).status).toBe(404);
  });

  it("an article with an invented score is repaired once, else stored as rejected and never served", async () => {
    const [m] = await t.db<{ id: string }[]>`select id from matches order by id limit 1`;
    await t.db`delete from articles where match_id = ${m!.id}`;
    await t.db`delete from agent_runs where idempotency_key = ${`article.match_report:${m!.id}`}`;
    const liar = newsroom((_n, d) => ({ ...d, headline: `${d.headline} (it finished 9–9)` }));
    const out = await writeMatchReport({ db: t.db, llm: liar.llm }, m!.id);
    expect(out.status).toBe("rejected");
    expect(liar.calls()).toBe(2);
    const [a] = await t.db<
      { status: string; published_at: Date | null; slug: string }[]
    >`select status, published_at, slug from articles where match_id = ${m!.id}`;
    expect(a).toMatchObject({ status: "rejected", published_at: null });
    const app = createApp({ db: t.db, store: new MemoryReplayStore() });
    expect((await app.request(`/api/v1/articles/${a!.slug}`)).status).toBe(404);
    const [run] =
      await t.db`select status, error from agent_runs where idempotency_key = ${`article.match_report:${m!.id}`}`;
    expect(run!.status).toBe("failed");
    expect(run!.error).toMatch(/9–9 is not an official score/);
  });

  it("a model draft with a false inference that survives the repair is replaced by the free template writer", async () => {
    const [m] = await t.db<{ id: string }[]>`select id from matches order by id limit 1 offset 1`;
    await t.db`delete from articles where match_id = ${m!.id}`;
    await t.db`delete from agent_runs where idempotency_key = ${`article.match_report:${m!.id}`}`;
    const f = await matchFacts(t.db, m!.id);
    const { home, away } = f.match!;
    // Every citation is real; the inference is not: the loser (or, in a draw, either side) "beat" the other.
    const loser = home.score < away.score ? home : away;
    const winner = loser === home ? away : home;
    const liar = newsroom((_n, d) => ({ ...d, standfirst: `${loser.name} beat ${winner.name}.` }));
    const reserves: number[] = [];
    const gate = {
      reserve: async ({ estimateMicroUsd }: { estimateMicroUsd: number }) => {
        reserves.push(estimateMicroUsd);
        return true;
      },
      settle: async () => {},
      release: async () => {},
    };
    const out = await writeMatchReport(
      { db: t.db, llm: liar.llm, gate: gate as never, fallback: offlineEditorialLlm(MODEL) },
      m!.id,
    );
    expect(out.status).toBe("published");
    expect(liar.calls()).toBe(2); // first draft + one repair; the template writer is not metered
    expect(reserves).toHaveLength(2);
    const [run] = await t.db<{ status: string; prompt: { rejected?: { errors: string[] } } }[]>`
      select status, prompt from agent_runs where idempotency_key = ${`article.match_report:${m!.id}`}`;
    expect(run!.status).toBe("succeeded");
    expect(run!.prompt.rejected?.errors.join()).toMatch(/contradiction|cannot verify/);
    const [a] = await t.db<{ standfirst: string }[]>`select standfirst from articles where match_id = ${m!.id}`;
    expect(a!.standfirst).not.toContain(`${loser.name} beat`);
  });

  it("a draft fixed on the repair attempt is published", async () => {
    const [m] = await t.db<{ id: string }[]>`select id from matches order by id desc limit 1`;
    await t.db`delete from articles where match_id = ${m!.id}`;
    await t.db`delete from agent_runs where idempotency_key = ${`article.match_report:${m!.id}`}`;
    const once = newsroom((n, d) => (n === 1 ? { ...d, body: `${d.body}\n\nThe manager said “a fair result”.` } : d));
    expect((await writeMatchReport({ db: t.db, llm: once.llm }, m!.id)).status).toBe("published");
    expect(once.calls()).toBe(2);
  });
});
