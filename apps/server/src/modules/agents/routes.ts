import { AgentRunListResponse } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { Hono } from "hono";
import { contractJson, notFound } from "../http.ts";
import { currentSeason } from "../league/read.ts";
import { type TeamRow, toTeam } from "../mappers.ts";

interface AgentRunRow {
  id: string;
  agent_kind: "manager" | "editorial";
  agent_id: string;
  purpose: "pre_match" | "post_match" | "article";
  season_id: string;
  fixture_id: string | null;
  idempotency_key: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped_budget";
  attempt: number;
  provider: string | null;
  model: string | null;
  prompt: unknown;
  output: unknown;
  input_tokens: number;
  output_tokens: number;
  cost_micro_usd: number;
  error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

export const toAgentRun = (r: AgentRunRow) => ({
  id: r.id,
  agentKind: r.agent_kind,
  agentId: r.agent_id,
  purpose: r.purpose,
  seasonId: r.season_id,
  fixtureId: r.fixture_id,
  idempotencyKey: r.idempotency_key,
  status: r.status,
  attempt: r.attempt,
  provider: r.provider,
  model: r.model,
  prompt: r.prompt,
  output: r.output,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  costMicroUsd: r.cost_micro_usd,
  error: r.error,
  startedAt: r.started_at?.toISOString() ?? null,
  finishedAt: r.finished_at?.toISOString() ?? null,
});

export function agentRoutes({ db }: { db: Db }) {
  const r = new Hono();
  r.get("/teams/:team/agent-runs", async (c) => {
    const [t] = await db<TeamRow[]>`select * from teams where slug = ${c.req.param("team")}`;
    const season = await currentSeason(db);
    if (!t || !season) return notFound(c, "Team");
    const rows = await db<AgentRunRow[]>`
      select r.* from agent_runs r join manager_agents m on m.id = r.agent_id
      where m.team_id = ${t.id} and r.season_id = ${season.id} order by r.created_at`;
    return contractJson(c, AgentRunListResponse, { team: toTeam(t), items: rows.map(toAgentRun) });
  });
  return r;
}
