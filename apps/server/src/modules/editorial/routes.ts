import {
  ArticleDetailResponse,
  ArticleListResponse,
  type EditorialAgent,
  JournalistDetailResponse,
  JournalistListResponse,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, isUuid, notFound } from "../http.ts";

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  role: EditorialAgent["role"];
  bio: string;
  voice: string;
  avatar: EditorialAgent["avatar"];
  model: string;
}
const toAgent = (r: AgentRow): EditorialAgent => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  role: r.role,
  bio: r.bio,
  voice: r.voice,
  avatar: r.avatar,
  model: r.model,
});

interface ArticleRow {
  id: string;
  season_id: string;
  slug: string;
  kind: "match_report" | "preview" | "analysis" | "column";
  status: "draft" | "published" | "rejected";
  editorial_agent_id: string;
  headline: string;
  standfirst: string;
  body: string;
  citations: Array<{ factId: string; text: string }>;
  match_id: string | null;
  fixture_id: string | null;
  team_ids: string[];
  agent_run_id: string | null;
  published_at: Date | null;
  created_at: Date;
  a_slug: string;
  a_name: string;
  a_role: EditorialAgent["role"];
  a_avatar: EditorialAgent["avatar"];
}

const card = (r: ArticleRow) => ({
  id: r.id,
  slug: r.slug,
  kind: r.kind,
  headline: r.headline,
  standfirst: r.standfirst,
  matchId: r.match_id,
  teamIds: r.team_ids,
  aiGenerated: true as const,
  publishedAt: r.published_at?.toISOString() ?? null,
  author: { slug: r.a_slug, name: r.a_name, role: r.a_role, avatar: r.a_avatar },
});

/** Only published articles are ever served; rejected drafts stay internal for audit. */
export function editorialRoutes({ db }: { db: Db }) {
  const r = new Hono();
  const base = (db: Db) => db`
    select a.*, e.slug as a_slug, e.name as a_name, e.role as a_role, e.avatar as a_avatar
    from articles a join editorial_agents e on e.id = a.editorial_agent_id where a.status = 'published'`;

  r.get("/articles", async (c) => {
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 20) || 20));
    const team = c.req.query("team") ?? null;
    const match = c.req.query("match") ?? null;
    if (match && !isUuid(match)) return contractJson(c, ArticleListResponse, { items: [], total: 0 });
    const [teamRow] = team ? await db<{ id: string }[]>`select id from teams where slug = ${team}` : [];
    if (team && !teamRow) return contractJson(c, ArticleListResponse, { items: [], total: 0 });
    const where = db`
      ${base(db)}
      and (${teamRow?.id ?? null}::uuid is null or ${teamRow?.id ?? null}::uuid = any(a.team_ids))
      and (${match}::uuid is null or a.match_id = ${match}::uuid)`;
    const rows = await db<ArticleRow[]>`${where} order by a.published_at desc, a.created_at desc limit ${limit}`;
    const [count] = await db<{ n: number }[]>`select count(*)::int as n from (${where}) x`;
    return contractJson(c, ArticleListResponse, { items: rows.map(card), total: count!.n });
  });

  r.get("/articles/:slug", async (c) => {
    const [a] = await db<ArticleRow[]>`${base(db)} and a.slug = ${c.req.param("slug")}`;
    if (!a) return notFound(c, "Article");
    const [author] = await db<AgentRow[]>`select * from editorial_agents where id = ${a.editorial_agent_id}`;
    const related = await db<ArticleRow[]>`
      ${base(db)} and a.id <> ${a.id} and a.season_id = ${a.season_id}
        and (a.team_ids && ${a.team_ids}::uuid[] or a.match_id = ${a.match_id} or cardinality(${a.team_ids}::uuid[]) = 0)
      order by a.published_at desc limit 3`;
    return contractJson(c, ArticleDetailResponse, {
      article: {
        id: a.id,
        seasonId: a.season_id,
        slug: a.slug,
        kind: a.kind,
        status: a.status,
        editorialAgentId: a.editorial_agent_id,
        headline: a.headline,
        standfirst: a.standfirst,
        body: a.body,
        citations: a.citations,
        matchId: a.match_id,
        fixtureId: a.fixture_id,
        teamIds: a.team_ids,
        agentRunId: a.agent_run_id,
        aiGenerated: true,
        publishedAt: a.published_at?.toISOString() ?? null,
        createdAt: a.created_at.toISOString(),
      },
      author: toAgent(author!),
      related: related.map(card),
    });
  });

  r.get("/journalists", async (c) => {
    const rows = await db<AgentRow[]>`select * from editorial_agents order by created_at, slug`;
    return contractJson(c, JournalistListResponse, { items: rows.map(toAgent) });
  });

  r.get("/journalists/:slug", async (c) => {
    const [j] = await db<AgentRow[]>`select * from editorial_agents where slug = ${c.req.param("slug")}`;
    if (!j) return notFound(c, "Journalist");
    const rows = await db<
      ArticleRow[]
    >`${base(db)} and a.editorial_agent_id = ${j.id} order by a.published_at desc limit 20`;
    return contractJson(c, JournalistDetailResponse, { journalist: toAgent(j), articles: rows.map(card) });
  });

  return r;
}
