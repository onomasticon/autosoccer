/**
 * Re-checks already-published articles against the current validators and the official facts
 * they were written from. Read-only: it reports, it never edits or unpublishes. Corrections to
 * the public record are an explicit editorial step (see docs/editorial/validation.md).
 */
import type { Db } from "@autosoccer/db";
import { matchFacts, roundFacts } from "./facts.ts";
import { checkGrounding } from "./grounding.ts";

export interface AuditFinding {
  slug: string;
  kind: string;
  headline: string;
  publishedAt: string | null;
  errors: string[];
}

export async function auditPublishedArticles(db: Db, opts: { seasonId?: string } = {}): Promise<AuditFinding[]> {
  const rows = await db<
    {
      slug: string;
      kind: string;
      headline: string;
      standfirst: string;
      body: string;
      citations: Array<{ factId: string; text: string }>;
      match_id: string | null;
      season_id: string;
      key: string | null;
      published_at: Date | null;
    }[]
  >`
    select a.slug, a.kind, a.headline, a.standfirst, a.body, a.citations, a.match_id, a.season_id,
      r.idempotency_key as key, a.published_at
    from articles a left join agent_runs r on r.id = a.agent_run_id
    where a.status = 'published' and (${opts.seasonId ?? null}::uuid is null or a.season_id = ${opts.seasonId ?? null}::uuid)
    order by a.published_at`;
  const out: AuditFinding[] = [];
  for (const a of rows) {
    let errors: string[];
    try {
      const round = /^article\.round:[^:]+:(\d+)$/.exec(a.key ?? "")?.[1];
      const facts = a.match_id
        ? await matchFacts(db, a.match_id)
        : round
          ? await roundFacts(db, a.season_id, Number(round))
          : null;
      errors = facts
        ? checkGrounding(
            a,
            facts,
            a.kind === "match_report" && a.match_id ? { requireScoreFact: `match:${a.match_id}:score` } : {},
          )
        : ["cannot audit: no match or round recorded for this article"];
    } catch (e) {
      errors = [`cannot audit: ${(e as Error).message}`];
    }
    if (errors.length)
      out.push({
        slug: a.slug,
        kind: a.kind,
        headline: a.headline,
        publishedAt: a.published_at?.toISOString() ?? null,
        errors,
      });
  }
  return out;
}
