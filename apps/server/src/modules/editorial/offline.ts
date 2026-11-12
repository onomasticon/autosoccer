/**
 * Deterministic template writer used by the OfflineLlm provider (tests, CI, keyless demos).
 * It writes only from the facts it's given and cites each one, so offline articles pass the
 * same grounding checks as model-written ones. Runs are labelled provider "offline".
 */
import type { Fact } from "@autosoccer/contracts";
import { OfflineLlm } from "../agents/llm.ts";
import type { ArticleDraft } from "./grounding.ts";
import type { EditorialContext } from "./prompts.ts";

const byKind = (facts: Fact[], kind: Fact["kind"]) => facts.filter((f) => f.kind === kind);
const cite = (f: Fact, text = f.statement) => ({ factId: f.id, text });

function matchReport(c: EditorialContext): ArticleDraft {
  const m = c.facts.match!;
  const facts = c.facts.facts;
  const score = facts.find((f) => f.kind === "score")!;
  const goals = byKind(facts, "goal").filter((f) => f.id.includes(":goal:"));
  const stat = (k: string) => facts.find((f) => f.id.endsWith(`:stat:${k}`))!;
  const standings = byKind(facts, "standing").filter((f) =>
    [m.home.name, m.away.name].some((n) => f.statement.startsWith(n)),
  );
  const draw = m.home.score === m.away.score;
  const [w, l] = m.home.score >= m.away.score ? [m.home, m.away] : [m.away, m.home];
  const headline = draw
    ? `${m.home.name} and ${m.away.name} share the points, ${m.home.score}–${m.away.score}`
    : `${w.name} beat ${l.name} ${w.score}–${l.score}`;
  const standfirst = `Round ${m.round}: ${draw ? "honours even" : `${w.name} take all three points`} in a match settled by the official record below.`;
  const goalLines = goals.length
    ? goals.map((g) => `${g.statement.replace(/^Goal \d+: /, "")}.`).join(" ")
    : "Neither side found the net.";
  const body = [
    `${score.statement.replace(/^Final score \(round \d+\): /, "")}.`,
    goalLines,
    `${stat("possession").statement}. ${stat("shots").statement}. ${stat("shotsOnTarget").statement}.`,
    standings.map((s) => `${s.statement}.`).join(" "),
  ].join("\n\n");
  return {
    headline,
    standfirst,
    body,
    citations: [
      cite(score),
      ...goals.map((g) => cite(g)),
      cite(stat("possession")),
      cite(stat("shots")),
      cite(stat("shotsOnTarget")),
      ...standings.map((s) => cite(s)),
    ],
  };
}

function analysis(c: EditorialContext): ArticleDraft {
  const facts = c.facts.facts;
  const tactics = byKind(facts, "tactics");
  const heights = facts.filter((f) => f.id.endsWith(":stat:avgTeamHeight"));
  const possession = facts.filter((f) => f.id.endsWith(":stat:possession"));
  const leader = byKind(facts, "standing")[0];
  const parts = tactics.slice(0, 2).map((t, i) => `${t.statement}. ${heights[i] ? `${heights[i]!.statement}.` : ""}`);
  return {
    headline: `Round ${c.round} in shapes and numbers`,
    standfirst: `How the recorded tactics of round ${c.round} showed up in the statistics.`,
    body: [
      `Round ${c.round} offered a clear look at how the AI managers' tactical choices translate into play.`,
      ...parts,
      possession.map((p) => `${p.statement}.`).join(" "),
      leader ? `At the top after the round: ${leader.statement}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    citations: [...tactics.slice(0, 2), ...heights.slice(0, 2), ...possession, ...(leader ? [leader] : [])].map((f) =>
      cite(f),
    ),
  };
}

const teamName = (f: Fact) => (f.value as { team?: { name?: string } } | null)?.team?.name ?? "";
const points = (f: Fact) => Number((f.value as { points?: number } | null)?.points ?? 0);

/** A headline that says what the table says: who leads and by how much (never the same line twice). */
export function columnHeadline(table: Fact[], round: number): string {
  const [top, second] = table;
  if (!top || !second) return `The table after round ${round}`;
  const gap = points(top) - points(second);
  if (gap === 0) return `${teamName(top)} and ${teamName(second)} level on points at the top after round ${round}`;
  return `${teamName(top)} lead by ${gap} point${gap === 1 ? "" : "s"} after round ${round}`;
}

function column(c: EditorialContext): ArticleDraft {
  const table = byKind(c.facts.facts, "standing");
  const [top, , , bottom] = table;
  return {
    headline: columnHeadline(table, c.round),
    standfirst: "Opinion: who the numbers favour, and who needs a rethink.",
    body: [
      `${top!.statement}. For my money, that is the most convincing record in the league so far.`,
      table
        .slice(1, 3)
        .map((s) => `${s.statement}.`)
        .join(" "),
      bottom ? `${bottom.statement}. I think a change of approach is overdue there.` : "",
      "Prediction: the team that adapts its tactics fastest after a defeat will finish top. The managers' notebooks suggest at least one of them is already listening.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    citations: table.map((s) => cite(s)),
  };
}

export function offlineEditorialLlm(pricedAs: string) {
  return new OfflineLlm(pricedAs, {
    "editorial.match_report": (ctx) => matchReport(ctx as EditorialContext),
    "editorial.analysis": (ctx) => analysis(ctx as EditorialContext),
    "editorial.column": (ctx) => column(ctx as EditorialContext),
  });
}
