import type { EditorialFacts, NewsTopic } from "@autosoccer/contracts";
import type { SeedJournalist } from "./journalists.ts";

export type ArticleKind = "match_report" | "preview" | "analysis" | "column" | "news";

export interface EditorialContext {
  kind: ArticleKind;
  journalist: Pick<SeedJournalist, "name" | "role" | "voice">;
  facts: EditorialFacts;
  round: number;
  /** League news only: what the story is about. */
  topic?: NewsTopic;
}

/** Stable system prompt per journalist (cache-friendly). */
export function editorialSystem(j: EditorialContext["journalist"]): string {
  return `You are ${j.name}, an AI ${j.role} for the Auto Soccer league website. Auto Soccer is a fictional league played in a deterministic 2D simulator and run by AI managers. It started 5-a-side and now plays 7-a-side; the facts give each season's format. Readers know you are an AI.
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
  preview:
    'Write a match preview. This match has NOT been played: never state or imply its result, its scorers or the table after it. Explain why it matters using only what the facts say was known before kickoff: where both clubs stand, the title race, earlier meetings, form and leading scorers, and any tactics a manager has already committed. If a fact is missing (round 1 has no table), say less rather than guessing. You may end with one clearly labelled prediction (start the sentence with "Prediction:" and use could/might), but never present it as fact.',
  analysis:
    "Write a tactical analysis of the round: pick the most instructive contrast between teams' recorded tactics and their recorded statistics, and explain what the numbers show. Finish with what to watch next round.",
  column:
    "Write an opinion column about the state of the league after this round: who is rising, who is struggling, and one bold but fair prediction. Opinions are welcome; facts must be cited.",
  news: "Write a league news story.",
};

/**
 * League news is reported from inside the league: what happened, who it affects and what it means
 * for the coming season, in the league's own terms (the league, the clubs, their owners and
 * managers), never as software release notes.
 */
const NEWS_BRIEF: Record<NewsTopic, string> = {
  champions:
    "Write the news story of the season's champions: who won the title and how (points, margin), what it means for their record, the season's top scorer, and how the rest of the table finished.",
  league:
    "Write the news story of the league's changes for the new season: which clubs join (and how many there are now), how the season is shaped, and any new rules clubs now play under, explained in plain terms for supporters.",
  takeover:
    "Write the news story of a club's takeover: who the club were, why they withdrew, what the new owners have put in, the club's new name and what it keeps.",
  withdrawal:
    "Write the breaking news story of a club declared bankrupt mid-season: why, from which round, what happens to its remaining fixtures and to the table.",
  transfers:
    "Write the transfer window round-up: the deals completed (biggest first) with their fees, and how busy the market was.",
  finances:
    "Write the story of the money each club takes into the season: who has the most, the wage bills, and who has the least room for error.",
  retirements:
    "Write the story of the players who have retired: who, at what age, their record in the league, and the academy graduates who replace them.",
};
const NEWS_RULES =
  "Report it as news from inside the league. Never use software words such as update, patch, release, feature, version, rule id, database or simulator setting. Don't invent quotes, owners' names, reasons or numbers that aren't in the facts.";

export function editorialPrompt(c: EditorialContext): string {
  const brief = c.kind === "news" && c.topic ? `${NEWS_BRIEF[c.topic]} ${NEWS_RULES}` : BRIEF[c.kind];
  return `${brief}

Official facts (id → statement):
${c.facts.facts.map((f) => `- ${f.id} → ${f.statement}`).join("\n")}

Return a headline, a one-sentence standfirst, a body of 3–6 short paragraphs separated by blank lines, and one citation per factual claim (fact id + the claim as written).`;
}
