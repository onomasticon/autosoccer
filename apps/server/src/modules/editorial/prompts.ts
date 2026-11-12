import type { EditorialFacts } from "@autosoccer/contracts";
import type { SeedJournalist } from "./journalists.ts";

export type ArticleKind = "match_report" | "analysis" | "column";

export interface EditorialContext {
  kind: ArticleKind;
  journalist: Pick<SeedJournalist, "name" | "role" | "voice">;
  facts: EditorialFacts;
  round: number;
}

/** Stable system prompt per journalist (cache-friendly). */
export function editorialSystem(j: EditorialContext["journalist"]): string {
  return `You are ${j.name}, an AI ${j.role} for the Auto Soccer league website. Auto Soccer is a fictional small-sided league (7-a-side; the launch season was 5-a-side) played in a deterministic 2D simulator and run by AI managers. Readers know you are an AI.
Voice: ${j.voice}

Rules (articles that break them are rejected automatically):
- Use only the official facts provided. Every factual claim must be supported by a citation of a fact id from the list.
- Never invent results, scores, statistics, events or players. Write scores with an en dash, e.g. 2–1, and only scores that appear in the facts. Write formations with hyphens, e.g. 2-1-1.
- No quotations of any kind: nobody was interviewed, so there is nothing to quote. Don't use quotation marks.
- Times are simulator clocks within a half (e.g. "1:28 into the second half"), never football minutes.
- Players are simulated agents; don't describe emotions, injuries or crowds that aren't in the record.
- Inferences are checked against the facts taken together. A generalisation ("the side with less of the ball won both matches", "both winners…", "home sides won every match") must hold for every match it covers; results, possession and shot comparisons, table positions, points, records and round numbers are verified. If a pattern only holds for some matches, say which.`;
}

const BRIEF: Record<ArticleKind, string> = {
  match_report:
    "Write the match report: the result first, then the goals in order, then what the statistics say about how the match went, then where it leaves both teams in the table. If the facts include an earlier meeting or a run of form, you may use it for context; never imply history the facts don't show.",
  analysis:
    "Write a tactical analysis of the round: pick the most instructive contrast between teams' recorded tactics and their recorded statistics, and explain what the numbers show. Finish with what to watch next round.",
  column:
    "Write an opinion column about the state of the league after this round: who is rising, who is struggling, and one bold but fair prediction. Opinions are welcome; facts must be cited.",
};

export function editorialPrompt(c: EditorialContext): string {
  return `${BRIEF[c.kind]}

Official facts (id → statement):
${c.facts.facts.map((f) => `- ${f.id} → ${f.statement}`).join("\n")}

Return a headline, a one-sentence standfirst, a body of 3–6 short paragraphs separated by blank lines, and one citation per factual claim (fact id + the claim as written).`;
}
