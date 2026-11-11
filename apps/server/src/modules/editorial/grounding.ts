/**
 * Grounding checks for AI-written articles. An article is publishable only if:
 *  - it cites at least one fact, every citation points at an existing official fact,
 *    and match reports cite the official score;
 *  - it contains no quotations (no invented quotes — nobody is interviewed);
 *  - every scoreline it mentions (e.g. "2–1") is an official final or running score;
 *  - it doesn't present invented football minutes ("in the 63rd minute");
 *  - every recognised claim (results, comparisons, aggregates across fixtures, table positions,
 *    chronology) is consistent with the facts taken together, not just individually (claims.ts).
 */
import type { EditorialFacts } from "@autosoccer/contracts";
import { z } from "zod";
import { checkCitationClaims, checkClaims } from "./claims.ts";

export const ArticleDraft = z
  .object({
    headline: z.string().describe("max ~90 characters, no quotation marks"),
    standfirst: z.string().describe("one sentence summary"),
    body: z.string().describe("3–6 short paragraphs separated by blank lines; plain prose, no quotes"),
    citations: z
      .array(
        z
          .object({ factId: z.string(), text: z.string().describe("the claim in the article this fact supports") })
          .strict(),
      )
      .describe("one entry per factual claim"),
  })
  .strict();
export type ArticleDraft = z.infer<typeof ArticleDraft>;

const SCORELINE = /\b(\d{1,2})\s*[–—-]\s*(\d{1,2})\b/g;
const QUOTES = /["“”«»]|(?:^|\s)'[^']{3,}'(?=\s|[.,;!?]|$)/;
const MINUTES = /\b\d{1,3}(?:st|nd|rd|th)[ -]minute\b|\bminute \d{1,3}\b/i;

/**
 * A number pair is a formation, not a score, when it's part of a three-part shape ("2-1-1",
 * or "2–1–1" typed with dashes) or a hyphenated pair followed by "formation/shape/system/setup".
 * A two-part pair written with an en dash ("2–1") is always a score and always checked.
 */
function isFormation(text: string, index: number, token: string): boolean {
  const before = text.slice(Math.max(0, index - 2), index);
  const after = text.slice(index + token.length, index + token.length + 16);
  if (/\d[–—-]$/.test(before) || /^[–—-]\d/.test(after)) return true;
  return token.includes("-") && /^\s+(formation|shape|system|setup)\b/i.test(after);
}

export function allowedScorelines(facts: EditorialFacts): Set<string> {
  const ok = new Set<string>();
  for (const f of facts.facts) {
    if (f.kind === "score" || f.kind === "goal") {
      const v = f.value as { home?: number; away?: number; score?: { home: number; away: number } } | number;
      const s =
        typeof v === "object" ? (v.score ?? (v.home !== undefined ? { home: v.home, away: v.away! } : null)) : null;
      if (s) {
        ok.add(`${s.home}-${s.away}`);
        ok.add(`${s.away}-${s.home}`);
      }
    }
  }
  return ok;
}

export function checkGrounding(
  draft: ArticleDraft,
  facts: EditorialFacts,
  opts: { requireScoreFact?: string } = {},
): string[] {
  const errors: string[] = [];
  const ids = new Set(facts.facts.map((f) => f.id));
  if (draft.citations.length === 0) errors.push("cite at least one official fact");
  for (const c of draft.citations) if (!ids.has(c.factId)) errors.push(`unknown fact id "${c.factId}"`);
  if (opts.requireScoreFact && !draft.citations.some((c) => c.factId === opts.requireScoreFact)) {
    errors.push(`a match report must cite the official score (${opts.requireScoreFact})`);
  }
  const text = `${draft.headline}\n${draft.standfirst}\n${draft.body}`;
  if (QUOTES.test(text)) errors.push("remove quotation marks: no quotes are on record, so none may be printed");
  if (MINUTES.test(text))
    errors.push('use the simulator clock (e.g. "1:28 into the second half"), not football minutes');
  const allowed = allowedScorelines(facts);
  for (const m of text.matchAll(SCORELINE)) {
    if (allowed.has(`${m[1]}-${m[2]}`)) continue;
    if (isFormation(text, m.index, m[0])) continue;
    errors.push(`scoreline ${m[1]}–${m[2]} is not an official score`);
  }
  if (!draft.headline.trim() || draft.headline.length > 140) errors.push("headline must be 1–140 characters");
  errors.push(...checkClaims(text, facts), ...checkCitationClaims(draft.citations, facts));
  return [...new Set(errors)];
}
