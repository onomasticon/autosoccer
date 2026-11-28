/**
 * Sweeps every historical public API URL (#93, #101): lists them from the database, fetches each from a
 * running API, and records its status and a hash of its body. Run it before and after a change (a
 * restore, an archive, a cutover) and compare: history must not move.
 *
 *   DATABASE_URL=… bun scripts/url-sweep.ts http://localhost:4300 before.json
 *   DATABASE_URL=… bun scripts/url-sweep.ts http://localhost:4300 after.json --compare before.json
 *
 * Read-only. Completed seasons only (a live season's pages change as it plays). Replays are checked
 * by key, not fetched: the replay store isn't part of a database restore.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createDb } from "@autosoccer/db";

const [base, out, flag, against] = process.argv.slice(2);
if (!base || !out) {
  console.error("usage: url-sweep.ts <api base> <out.json> [--compare <before.json>]");
  process.exit(2);
}
const db = createDb(process.env.DATABASE_URL!, { max: 2 });
const seasons = await db<
  { id: string; slug: string }[]
>`select id, slug from seasons where status = 'completed' order by created_at`;
const ids = seasons.map((s) => s.id);
const matches = await db<{ id: string; fixture_id: string; replay: boolean }[]>`
  select m.id, m.fixture_id, exists (select 1 from replay_artifacts a where a.match_id = m.id) as replay
  from matches m join fixtures f on f.id = m.fixture_id
  where f.season_id = any(${ids}::uuid[]) and m.status = 'completed' order by m.id`;
const teams = await db<{ slug: string }[]>`
  select distinct t.slug from teams t join season_teams st on st.team_id = t.id where st.season_id = any(${ids}::uuid[]) order by 1`;
const players = await db<{ id: string }[]>`
  select distinct r.player_id as id from player_registrations r where r.season_id = any(${ids}::uuid[]) order by 1`;
const articles = await db<
  { slug: string }[]
>`select slug from articles where season_id = any(${ids}::uuid[]) and status = 'published' order by slug`;
const leagues = await db<{ slug: string }[]>`select slug from leagues where status <> 'draft' order by slug`;
await db.end();

const urls = [
  "/seasons",
  "/records",
  "/scorers",
  "/transfers",
  "/teams",
  "/leagues",
  ...leagues.map((l) => `/leagues/${l.slug}`),
  ...seasons.flatMap((s) =>
    ["standings", "fixtures", "scorers", "budget", "dugout"].map((p) => `/seasons/${s.slug}/${p}`),
  ),
  ...seasons.map((s) => `/transfers?season=${s.slug}`),
  ...matches.flatMap((m) => [`/matches/${m.id}`, `/fixtures/${m.fixture_id}/story`]),
  ...teams.flatMap((t) =>
    ["", "/finances", "/careers", "/revisions", "/manager-profile"].map((p) => `/teams/${t.slug}${p}`),
  ),
  ...players.map((p) => `/players/${p.id}`),
  ...articles.map((a) => `/articles/${a.slug}`),
];
const result: Record<string, { status: number; hash: string }> = {};
const queue = [...urls];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      const res = await fetch(`${base}/api/v1${u}`);
      const body = await res.text();
      result[u] = { status: res.status, hash: createHash("sha256").update(body).digest("hex").slice(0, 16) };
    }
  }),
);
const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(out, JSON.stringify({ urls: sorted, replays: matches.filter((m) => m.replay).length }, null, 1));
const bad = Object.entries(sorted).filter(([, r]) => r.status !== 200);
console.log(
  `${urls.length} URLs: ${urls.length - bad.length} ok, ${bad.length} not 200${
    bad.length
      ? ` (${bad
          .slice(0, 5)
          .map(([u, r]) => `${u} ${r.status}`)
          .join(", ")})`
      : ""
  }; ${matches.length} matches, ${matches.filter((m) => m.replay).length} with a replay key`,
);
if (flag === "--compare" && against) {
  const before = JSON.parse(readFileSync(against, "utf8")).urls as typeof sorted;
  const changed = Object.keys({ ...before, ...sorted }).filter(
    (u) => before[u]?.hash !== sorted[u]?.hash || before[u]?.status !== sorted[u]?.status,
  );
  console.log(
    `compared with ${against}: ${changed.length} changed${changed.length ? `:\n  ${changed.slice(0, 40).join("\n  ")}` : ""}`,
  );
  process.exit(bad.length ? 1 : 0);
}
process.exit(bad.length ? 1 : 0);
