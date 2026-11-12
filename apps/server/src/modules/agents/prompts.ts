import { describeTactics, TacticalConfigV1, type TeamSize, tacticsSchemaFor } from "@autosoccer/contracts";
import { z } from "zod";

const NUMBER_WORDS: Record<TeamSize, string> = { 5: "five", 7: "seven" };

/** What a manager decides before a match, for a team size. Starters are shirt numbers in slot order. */
export function preMatchDecision(size: TeamSize) {
  return z
    .object({
      tactics: tacticsSchemaFor(size),
      starters: z
        .array(z.number().int())
        .describe(
          `exactly ${NUMBER_WORDS[size]} shirt numbers: the goalkeeper first, then the formation's outfield slots back to front`,
        ),
      rationale: z.string().describe("one or two sentences explaining the choice, citing the facts given"),
    })
    .strict();
}
/** The 5-a-side decision schema (kept for callers that predate 7-a-side). */
export const PreMatchDecision = z
  .object({
    tactics: TacticalConfigV1,
    starters: z.array(z.number().int()),
    rationale: z.string(),
  })
  .strict();
export type PreMatchDecision = z.infer<typeof PreMatchDecision>;

/** What a manager writes to memory after a match. */
export const PostMatchReview = z
  .object({
    summary: z.string().describe("updated running summary of how the season is going and what works (max ~80 words)"),
    notes: z.array(z.string()).describe("up to 6 short, specific notes worth remembering, most important first"),
    lesson: z.string().describe("one concrete adjustment to consider for the next match"),
  })
  .strict();
export type PostMatchReview = z.infer<typeof PostMatchReview>;

export interface MatchSummaryFact {
  round: number;
  opponent: string;
  venue: "home" | "away";
  goalsFor: number;
  goalsAgainst: number;
  result: "W" | "D" | "L";
  possession: number;
  shots: number;
  shotsAgainst: number;
  passesCompleted: number;
  avgTeamHeight: number;
  tactics: string;
  opponentTactics: string;
}

export interface ManagerFacts {
  manager: { name: string; persona: string; philosophy: string; memory: { summary: string; notes: string[] } };
  team: { name: string };
  format: { playersPerTeam: TeamSize };
  fixture: { round: number; venue: "home" | "away"; opponent: string };
  squad: Array<{ shirt: number; name: string; position: string }>;
  current: { tactics: TacticalConfigV1 | null; starters: number[] };
  table: Array<{ position: number; team: string; played: number; points: number; goalDifference: number }>;
  recent: MatchSummaryFact[];
  opponentRecent: MatchSummaryFact[];
}

export interface PostMatchFacts extends ManagerFacts {
  match: MatchSummaryFact & { goals: string[] };
}

const options = (size: TeamSize) =>
  Object.entries(tacticsSchemaFor(size).shape)
    .map(([k, v]) => `- ${k}: ${(v as unknown as { options: string[] }).options.join(" | ")}`)
    .join("\n");

/** Stable system prompt per manager and team size (cache-friendly: no per-match data). */
export function managerSystem(m: ManagerFacts["manager"], team: string, size: TeamSize = 5): string {
  return `You are ${m.name}, the AI manager of ${team} in Auto Soccer, a fictional ${size}-a-side league played in a deterministic 2D simulator.
Persona: ${m.persona}
Philosophy: ${m.philosophy}

You manage by choosing a lineup and a structured tactical setup before each match, and by reviewing the official result afterwards. You cannot influence the match while it is being played.
Only use the facts provided. Do not invent results, statistics, injuries or quotes.

Tactical options (tactics/1, ${size}-a-side):
${options(size)}
Formations list the ${NUMBER_WORDS[(size - 1) as TeamSize] ?? size - 1} outfield players back to front. Slot 1 is always the goalkeeper.`;
}

const fmtMatch = (m: MatchSummaryFact) =>
  `R${m.round} ${m.venue === "home" ? "vs" : "at"} ${m.opponent}: ${m.result} ${m.goalsFor}–${m.goalsAgainst} · possession ${Math.round(m.possession * 100)}% · shots ${m.shots}–${m.shotsAgainst} · passes completed ${m.passesCompleted} · team height ${m.avgTeamHeight.toFixed(1)} m · our tactics: ${m.tactics} · their tactics: ${m.opponentTactics}`;

function commonFacts(f: ManagerFacts): string {
  return `## Your memory
Summary: ${f.manager.memory.summary || "(none yet — first match of the season)"}
Notes:
${f.manager.memory.notes.map((n) => `- ${n}`).join("\n") || "- (none)"}

## League table
${f.table.map((r) => `${r.position}. ${r.team} — P${r.played} Pts ${r.points} GD ${r.goalDifference >= 0 ? "+" : ""}${r.goalDifference}`).join("\n")}

## Your recent matches (official records)
${f.recent.map(fmtMatch).join("\n") || "(none yet)"}

## ${f.fixture.opponent}'s recent matches
${f.opponentRecent.map(fmtMatch).join("\n") || "(none yet)"}

## Squad (shirt · name · position)
${f.squad.map((p) => `${p.shirt} · ${p.name} · ${p.position}`).join("\n")}

## Current setup
Tactics: ${f.current.tactics ? describeTactics(f.current.tactics) : "league baseline"}
Starters (slot order): ${f.current.starters.join(", ")}`;
}

export function preMatchPrompt(f: ManagerFacts): string {
  return `Round ${f.fixture.round}: ${f.team.name} ${f.fixture.venue === "home" ? "host" : "visit"} ${f.fixture.opponent}.

${commonFacts(f)}

Decide your lineup and tactics for this match. Keep what works; change what the evidence says isn't working. Return the full tactics object, ${NUMBER_WORDS[f.format.playersPerTeam]} starters by shirt number (goalkeeper first), and a short rationale grounded in the facts above.`;
}

export function postMatchPrompt(f: PostMatchFacts): string {
  return `Full time in round ${f.match.round}. Official result: ${fmtMatch(f.match)}
Goals: ${f.match.goals.join("; ") || "none"}

${commonFacts(f)}

Review the match against your plan. Rewrite your memory: an updated season summary, up to six specific notes worth keeping (drop stale ones), and one concrete lesson for the next match.`;
}
