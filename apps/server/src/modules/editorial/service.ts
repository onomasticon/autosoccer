import type { EditorialFacts } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { enqueue } from "../../jobs/queue.ts";
import { PermanentJobError } from "../../jobs/worker.ts";
import type { Logger } from "../../log.ts";
import type { LlmClient } from "../agents/llm.ts";
import { costMicroUsd } from "../agents/pricing.ts";
import type { EditorialGate } from "../ledger/service.ts";
import { matchFacts, roundFacts } from "./facts.ts";
import { ArticleDraft, checkGrounding } from "./grounding.ts";
import { SEED_JOURNALISTS } from "./journalists.ts";
import { type ArticleKind, type EditorialContext, editorialPrompt, editorialSystem } from "./prompts.ts";

export const REPORT_JOB = "article.match_report";
export const ROUND_JOB = "article.round";

export interface EditorialDeps {
  db: Db;
  llm: LlmClient;
  log?: Logger;
  maxOutputTokens?: number;
  /** Meters model calls against the season's editorial budget. Without it, spend is unlimited. */
  gate?: EditorialGate;
  /**
   * Writes the piece when the budget can't cover a model call (the offline template writer:
   * grounded in the same facts, no model, no cost). Without it, the article is skipped.
   */
  fallback?: LlmClient;
}

/** Output-token cap per journalist call; also the worst case reserved against the budget. */
export const EDITORIAL_MAX_OUTPUT_TOKENS = 8000;

/** Creates the league's AI journalists. Idempotent. */
export async function seedJournalists(db: Db, model: string) {
  for (const j of SEED_JOURNALISTS) {
    await db`
      insert into editorial_agents (slug, name, role, bio, voice, avatar, model)
      values (${j.slug}, ${j.name}, ${j.role}, ${j.bio}, ${j.voice}, ${db.json(j.avatar)}, ${model})
      on conflict (slug) do nothing`;
  }
}

/** Which journalist writes which kind of piece: reporter → reports; odd rounds analysis, even rounds a column. */
const ROLE_FOR: Record<ArticleKind, "reporter" | "analyst" | "pundit"> = {
  match_report: "reporter",
  analysis: "analyst",
  column: "pundit",
};
export const roundPieceKind = (round: number): ArticleKind => (round % 2 === 1 ? "analysis" : "column");

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_–-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    // Cutting at 60 can end on a hyphen; with the id suffix that made "--", which breaks the slug contract.
    .replace(/-+$/, "");

export type ArticleOutcome =
  | { status: "already-done" }
  | { status: "skipped-budget" }
  | { status: "published"; articleId: string; slug: string }
  | { status: "rejected"; errors: string[] };

interface WriteTarget {
  key: string;
  kind: ArticleKind;
  seasonId: string;
  round: number;
  facts: EditorialFacts;
  matchId: string | null;
  fixtureId: string | null;
  teamIds: string[];
  requireScoreFact?: string;
}

/**
 * Writes one article asynchronously from the official facts: model draft → grounding checks
 * → one repair attempt → publish (or store as rejected for audit). Never runs at page render.
 */
async function writeArticle(deps: EditorialDeps, t: WriteTarget): Promise<ArticleOutcome> {
  const { db, llm } = deps;
  const [j] = await db<{ id: string; name: string; role: "reporter" | "analyst" | "pundit"; voice: string }[]>`
    select id, name, role, voice from editorial_agents where role = ${ROLE_FOR[t.kind]} order by created_at limit 1`;
  if (!j) throw new PermanentJobError(`no ${ROLE_FOR[t.kind]} on staff`);

  await db`insert into agent_runs (agent_kind, agent_id, purpose, season_id, fixture_id, idempotency_key)
    values ('editorial', ${j.id}, 'article', ${t.seasonId}, ${t.fixtureId}, ${t.key}) on conflict (idempotency_key) do nothing`;
  const [run] = await db<
    { id: string; status: string }[]
  >`select id, status from agent_runs where idempotency_key = ${t.key}`;
  if (run!.status === "succeeded") return { status: "already-done" };
  await db`update agent_runs set status = 'running', attempt = attempt + 1, started_at = now(), error = null where id = ${run!.id}`;

  const ctx: EditorialContext = { kind: t.kind, journalist: j, facts: t.facts, round: t.round };
  const system = editorialSystem(j);
  const prompt = editorialPrompt(ctx);
  const audit: {
    system: string;
    user: string;
    repair?: string;
    /** The model's last draft, when it failed the fact check and the template writer stood in. */
    rejected?: { draft: ArticleDraft; errors: string[] };
  } = { system, user: prompt };
  const task = `editorial.${t.kind}`;
  const maxTokens = deps.maxOutputTokens ?? EDITORIAL_MAX_OUTPUT_TOKENS;
  let inTok = 0;
  let outTok = 0;
  let model = llm.model;
  let provider = llm.provider;
  // What the metered model calls really cost (fallback calls are free and never charged).
  const metered = { calls: 0, cost: 0, inTok: 0, outTok: 0, model: llm.model, provider: llm.provider };
  let fellBack = false;
  const call = async (p: string) => {
    let client = llm;
    if (deps.gate) {
      // Worst case: the whole prompt (≈3 chars per token, generous) plus the full output cap.
      const estimate = costMicroUsd(llm.model, Math.ceil((system.length + p.length) / 3), maxTokens);
      if (!(await deps.gate.reserve({ seasonId: t.seasonId, runId: run!.id, estimateMicroUsd: estimate }))) {
        if (!deps.fallback) throw new BudgetExhausted();
        client = deps.fallback;
        fellBack = true;
      }
    }
    const r = await client.complete({ system, prompt: p, schema: ArticleDraft, task, context: ctx, maxTokens });
    inTok += r.inputTokens;
    outTok += r.outputTokens;
    model = r.model;
    provider = r.provider;
    if (client === llm) {
      metered.calls += 1;
      metered.cost += costMicroUsd(r.model, r.inputTokens, r.outputTokens);
      metered.inTok += r.inputTokens;
      metered.outTok += r.outputTokens;
      metered.model = r.model;
      metered.provider = r.provider;
    }
    return r.output;
  };
  try {
    let draft = await call(prompt);
    let errors = checkGrounding(draft, t.facts, { requireScoreFact: t.requireScoreFact });
    if (errors.length) {
      audit.repair = `${prompt}\n\nYour draft was rejected by the fact checker:\n${errors.map((e) => `- ${e}`).join("\n")}\nFix every problem and answer again.`;
      draft = await call(audit.repair);
      errors = checkGrounding(draft, t.facts, { requireScoreFact: t.requireScoreFact });
    }
    // Still failing after the repair: the template writer (same facts, no model, no cost, never
    // metered) writes the piece instead. It's checked like any draft; if it fails too, nothing is
    // published. The model's draft and the checker's errors stay in the run audit.
    if (errors.length && deps.fallback && !fellBack) {
      const r = await deps.fallback.complete({ system, prompt, schema: ArticleDraft, task, context: ctx, maxTokens });
      const alt = r.output;
      const altErrors = checkGrounding(alt, t.facts, { requireScoreFact: t.requireScoreFact });
      if (!altErrors.length) {
        audit.rejected = { draft, errors };
        deps.log?.warn("draft failed the fact check after repair; template writer used", { kind: t.kind, errors });
        draft = alt;
        errors = [];
        inTok += r.inputTokens;
        outTok += r.outputTokens;
        model = r.model;
        provider = r.provider;
      }
    }
    const status = errors.length ? "rejected" : "published";
    const slug = `${slugify(draft.headline) || t.kind}-${run!.id.slice(0, 6)}`;
    const cost = metered.cost;
    if (deps.gate && metered.calls > 0) {
      await deps.gate.settle({
        seasonId: t.seasonId,
        runId: run!.id,
        costMicroUsd: metered.cost,
        provider: metered.provider,
        model: metered.model,
        inputTokens: metered.inTok,
        outputTokens: metered.outTok,
      });
    }
    if (fellBack) deps.log?.info("editorial budget exhausted; template writer used", { kind: t.kind });
    const [article] = await db.begin(async (tx) => {
      const rows = await tx<{ id: string; slug: string }[]>`
        insert into articles (season_id, slug, kind, status, editorial_agent_id, headline, standfirst, body, citations, match_id, fixture_id, team_ids, agent_run_id, published_at)
        values (${t.seasonId}, ${slug}, ${t.kind}, ${status}, ${j.id}, ${draft.headline.slice(0, 140)}, ${draft.standfirst.slice(0, 300)}, ${draft.body},
          ${tx.json(draft.citations)}, ${t.matchId}, ${t.fixtureId}, ${t.teamIds}, ${run!.id}, ${status === "published" ? new Date() : null})
        returning id, slug`;
      await tx`
        update agent_runs set status = ${errors.length ? "failed" : "succeeded"}, prompt = ${tx.json(audit)}, output = ${tx.json(draft as never)},
          provider = ${provider}, model = ${model}, input_tokens = ${inTok}, output_tokens = ${outTok}, cost_micro_usd = ${cost},
          error = ${errors.length ? `fact check failed: ${errors.join("; ")}` : null}, finished_at = now()
        where id = ${run!.id}`;
      return rows;
    });
    deps.log?.info(`article ${status}`, { kind: t.kind, slug: article!.slug });
    return errors.length
      ? { status: "rejected", errors }
      : { status: "published", articleId: article!.id, slug: article!.slug };
  } catch (e) {
    await deps.gate?.release({ seasonId: t.seasonId, runId: run!.id });
    if (e instanceof BudgetExhausted) {
      await db`update agent_runs set status = 'skipped_budget', error = ${e.message}, finished_at = now() where id = ${run!.id}`;
      deps.log?.info("article skipped: editorial budget exhausted", { kind: t.kind });
      return { status: "skipped-budget" };
    }
    await db`update agent_runs set status = 'failed', error = ${(e as Error).message}, finished_at = now() where id = ${run!.id}`;
    throw e;
  }
}

class BudgetExhausted extends Error {
  constructor() {
    super("season editorial budget exhausted");
  }
}

export async function writeMatchReport(deps: EditorialDeps, matchId: string): Promise<ArticleOutcome> {
  const facts = await matchFacts(deps.db, matchId);
  const [f] = await deps.db<{ fixture_id: string; season_id: string; round: number }[]>`
    select m.fixture_id, f.season_id, f.round from matches m join fixtures f on f.id = m.fixture_id where m.id = ${matchId}`;
  return writeArticle(deps, {
    key: `${REPORT_JOB}:${matchId}`,
    kind: "match_report",
    seasonId: f!.season_id,
    round: f!.round,
    facts,
    matchId,
    fixtureId: f!.fixture_id,
    teamIds: [facts.match!.home.teamId, facts.match!.away.teamId],
    requireScoreFact: `match:${matchId}:score`,
  });
}

export async function writeRoundPiece(deps: EditorialDeps, seasonId: string, round: number): Promise<ArticleOutcome> {
  const facts = await roundFacts(deps.db, seasonId, round);
  if (!facts.matchIds.length) throw new PermanentJobError(`round ${round} has no results`);
  const { matchIds: _ids, ...ef } = facts;
  return writeArticle(deps, {
    key: `${ROUND_JOB}:${seasonId}:${round}`,
    kind: roundPieceKind(round),
    seasonId,
    round,
    facts: ef,
    matchId: null,
    fixtureId: null,
    teamIds: [],
  });
}

/** After a result: a match report, and a round piece once the whole round is complete. */
export async function enqueueEditorial(db: Db, fixtureId: string) {
  const [f] = await db<{ match_id: string; season_id: string; round: number; open: number }[]>`
    select m.id as match_id, f.season_id, f.round,
      (select count(*)::int from fixtures g where g.season_id = f.season_id and g.round = f.round and g.status <> 'completed') as open
    from fixtures f join matches m on m.fixture_id = f.id where f.id = ${fixtureId}`;
  if (!f) return;
  await enqueue(db, { kind: REPORT_JOB, key: `${REPORT_JOB}:${f.match_id}`, payload: { matchId: f.match_id } });
  if (f.open === 0) {
    await enqueue(db, {
      kind: ROUND_JOB,
      key: `${ROUND_JOB}:${f.season_id}:${f.round}`,
      payload: { seasonId: f.season_id, round: f.round },
    });
  }
}

export function editorialJobHandlers(deps: EditorialDeps) {
  return {
    [REPORT_JOB]: async (job: { payload: Record<string, unknown> }) => {
      const out = await writeMatchReport(deps, String(job.payload.matchId));
      return { result: out, artifacts: out.status === "published" ? [{ kind: "article", id: out.articleId }] : [] };
    },
    [ROUND_JOB]: async (job: { payload: Record<string, unknown> }) => {
      const out = await writeRoundPiece(deps, String(job.payload.seasonId), Number(job.payload.round));
      return { result: out, artifacts: out.status === "published" ? [{ kind: "article", id: out.articleId }] : [] };
    },
  };
}
