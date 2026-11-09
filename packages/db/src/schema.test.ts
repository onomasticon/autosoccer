import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./testing.ts";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

async function team(slug: string) {
  const [row] = await t.db<{ id: string }[]>`
    insert into teams (slug, name, short_name, primary_color, secondary_color, crest)
    values (${slug}, ${slug}, 'TST', '#245EFF', '#FFFFFF', ${t.db.json({ shape: "shield", glyph: "T" })})
    returning id`;
  return row!.id;
}
async function season(slug: string) {
  const [row] = await t.db<{ id: string }[]>`
    insert into seasons (slug, name, seed, sim_version, budget_per_team_micro_usd)
    values (${slug}, ${slug}, 1, '38b8c6f', 1000000) returning id`;
  return row!.id;
}
const fixture = (s: string, round: number, home: string, away: string) =>
  t.db<{ id: string }[]>`insert into fixtures (season_id, round, home_team_id, away_team_id, seed)
    values (${s}, ${round}, ${home}, ${away}, ${round}) returning id`;

describe("domain schema constraints", () => {
  it("rejects invalid slugs, colours and positions", async () => {
    await expect(
      t.db`insert into teams (slug, name, short_name, primary_color, secondary_color, crest) values ('Bad Slug', 'x', 'XX', '#000000', '#000000', '{}')`,
    ).rejects.toThrow(/check/);
    await expect(
      t.db`insert into teams (slug, name, short_name, primary_color, secondary_color, crest) values ('ok', 'x', 'XX', 'red', '#000000', '{}')`,
    ).rejects.toThrow(/check/);
    const id = await team("pos-team");
    await expect(
      t.db`insert into players (team_id, name, shirt_number, position) values (${id}, 'p', 1, 'ST')`,
    ).rejects.toThrow(/check/);
  });

  it("enforces unique shirt numbers per team and one manager per team", async () => {
    const id = await team("shirts");
    await t.db`insert into players (team_id, name, shirt_number, position) values (${id}, 'a', 9, 'FW')`;
    await expect(
      t.db`insert into players (team_id, name, shirt_number, position) values (${id}, 'b', 9, 'FW')`,
    ).rejects.toThrow(/unique/);
    await t.db`insert into manager_agents (team_id, slug, name, persona, philosophy, model) values (${id}, 'm1', 'M', 'p', 'p', 'x')`;
    await expect(
      t.db`insert into manager_agents (team_id, slug, name, persona, philosophy, model) values (${id}, 'm2', 'M', 'p', 'p', 'x')`,
    ).rejects.toThrow(/unique/);
  });

  it("fixtures: no self-play, each ordered pairing once, one fixture per team per round", async () => {
    const s = await season("fx");
    const [a, b, c, d] = [await team("fx-a"), await team("fx-b"), await team("fx-c"), await team("fx-d")];
    await expect(fixture(s, 1, a!, a!)).rejects.toThrow(/check/);
    await fixture(s, 1, a!, b!);
    await fixture(s, 1, c!, d!);
    await expect(fixture(s, 2, a!, b!)).rejects.toThrow(/unique/);
    await expect(fixture(s, 1, a!, c!)).rejects.toThrow(/already has a fixture in round 1/);
    await fixture(s, 4, b!, a!); // the return leg is fine
  });

  it("allows exactly one match per fixture and requires a full result when completed", async () => {
    const s = await season("mx");
    const [a, b] = [await team("mx-a"), await team("mx-b")];
    const [f] = await fixture(s, 1, a!, b!);
    const hash = "0".repeat(64);
    const insert = () => t.db`insert into matches (fixture_id, seed, request_hash, request, versions)
      values (${f!.id}, 1, ${hash}, '{}', '{}')`;
    await insert();
    await expect(insert()).rejects.toThrow(/unique/);
    await expect(t.db`update matches set status = 'completed' where fixture_id = ${f!.id}`).rejects.toThrow(/check/);
    await t.db`update matches set status = 'completed', home_score = 1, away_score = 0, final_hash = 'h', completed_at = now()
      where fixture_id = ${f!.id}`;
  });

  it("tactical revisions are versioned per team+season and the deployment kind is constrained", async () => {
    const s = await season("tr");
    const a = await team("tr-a");
    const rev = (v: number, kind: string, status = "valid", errors: string[] = []) =>
      t.db`insert into tactical_revisions (team_id, season_id, version, deployment, lineup, status, validation_errors, source)
        values (${a}, ${s}, ${v}, ${t.db.json({ kind })}, '{}', ${status}, ${t.db.json(errors)}, 'seed')`;
    await rev(1, "tactical");
    await expect(rev(1, "tactical")).rejects.toThrow(/unique/);
    await expect(rev(2, "live-llm")).rejects.toThrow(/check/);
    await expect(rev(3, "tactical", "valid", ["bad"])).rejects.toThrow(/check/);
    await rev(4, "tactical", "rejected", ["formation must have five slots"]);
  });

  it("agent runs and jobs are idempotent by key", async () => {
    const s = await season("idem");
    const run = () => t.db`insert into agent_runs (agent_kind, agent_id, purpose, season_id, idempotency_key)
      values ('manager', gen_random_uuid(), 'pre_match', ${s}, 'pre:fixture-1:team-a')`;
    await run();
    await expect(run()).rejects.toThrow(/unique/);
    const job = () =>
      t.db<{ id: string }[]>`insert into jobs (kind, idempotency_key) values ('match.play', 'match.play:f1')
        on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key returning id`;
    const [j1] = await job();
    const [j2] = await job();
    expect(j2!.id).toBe(j1!.id);
  });

  it("compute ledger signs are enforced per transaction kind", async () => {
    const s = await season("ledger");
    const a = await team("ledger-a");
    const tx = (kind: string, amount: number) =>
      t.db`insert into compute_transactions (season_id, team_id, kind, amount_micro_usd) values (${s}, ${a}, ${kind}, ${amount})`;
    await tx("grant", 1_000_000);
    await tx("reserve", -5000);
    await tx("release", 1000);
    await tx("charge", -4000);
    await expect(tx("grant", -1)).rejects.toThrow(/check/);
    await expect(tx("reserve", 10)).rejects.toThrow(/check/);
    await expect(tx("charge", 10)).rejects.toThrow(/check/);
    const [bal] = await t.db<
      { sum: number }[]
    >`select sum(amount_micro_usd)::int as sum from compute_transactions where team_id = ${a}`;
    expect(bal!.sum).toBe(992_000);
  });

  it("articles are always AI-disclosed and published ones carry a date", async () => {
    const s = await season("art");
    const [ed] = await t.db<{ id: string }[]>`insert into editorial_agents (slug, name, role, bio, voice, avatar, model)
      values ('nia', 'Nia', 'reporter', 'b', 'v', '{}', 'x') returning id`;
    const art = (slug: string, status: string, ai = true) =>
      t.db`insert into articles (season_id, slug, kind, status, editorial_agent_id, headline, body, ai_generated)
        values (${s}, ${slug}, 'match_report', ${status}, ${ed!.id}, 'h', 'b', ${ai})`;
    await art("draft-1", "draft");
    await expect(art("pub-1", "published")).rejects.toThrow(/check/);
    await expect(art("human-1", "draft", false)).rejects.toThrow(/check/);
  });
});
