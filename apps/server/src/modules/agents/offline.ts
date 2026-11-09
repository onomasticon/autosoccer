/**
 * Rule-based manager "brain" used by the OfflineLlm provider (tests, CI, keyless demos).
 * It reads exactly the facts the real prompt contains and reacts to them deterministically,
 * so the pre/post-match loop, memory and adaptation can be exercised end to end without a
 * model. It's a stand-in, not a model, and runs are labelled provider "offline".
 */
import { DEFAULT_TACTICS, describeTactics, type TacticalConfigV1 } from "@autosoccer/contracts";
import { OfflineLlm } from "./llm.ts";
import type { ManagerFacts, PostMatchFacts, PostMatchReview, PreMatchDecision } from "./prompts.ts";

const up = <T extends string>(scale: readonly T[], v: T) => scale[Math.min(scale.length - 1, scale.indexOf(v) + 1)]!;
const PRESS = ["low", "mid", "high"] as const;
const LINE = ["deep", "mid", "high"] as const;
const TEMPO = ["patient", "balanced", "direct"] as const;
const SHOOT = ["selective", "balanced", "early"] as const;
const FORMATIONS: TacticalConfigV1["formation"][] = ["2-1-1", "1-2-1", "2-2", "1-1-2", "3-1"];

export function offlinePreMatch(f: ManagerFacts): PreMatchDecision {
  const t: TacticalConfigV1 = { ...(f.current.tactics ?? DEFAULT_TACTICS) };
  const [last, prev] = f.recent;
  let why: string;
  if (!last) {
    why = `Opening match: starting with our planned setup (${describeTactics(t)}).`;
  } else if (last.result === "L" && prev?.result === "L") {
    t.formation = FORMATIONS[(FORMATIONS.indexOf(t.formation) + 1) % FORMATIONS.length]!;
    t.pressing = up(PRESS, t.pressing);
    why = `Two defeats in a row (${last.goalsFor}–${last.goalsAgainst} at R${last.round}); changing shape to ${t.formation} and pressing harder.`;
  } else if (last.result === "L") {
    if (last.avgTeamHeight < 15) t.lineHeight = up(LINE, t.lineHeight);
    else t.tempo = up(TEMPO, t.tempo);
    if (last.shots <= last.shotsAgainst) t.shooting = up(SHOOT, t.shooting);
    why = `Lost ${last.goalsFor}–${last.goalsAgainst} to ${last.opponent} with ${Math.round(last.possession * 100)}% possession and ${last.shots}–${last.shotsAgainst} shots; adjusting to a ${t.lineHeight} line, ${t.tempo} tempo, ${t.shooting} shooting.`;
  } else if (last.result === "D" && last.shots <= last.shotsAgainst) {
    t.shooting = up(SHOOT, t.shooting);
    why = `Drew ${last.goalsFor}–${last.goalsAgainst} but were out-shot ${last.shots}–${last.shotsAgainst}; shooting earlier.`;
  } else {
    why = `${last.result === "W" ? "Won" : "Drew"} ${last.goalsFor}–${last.goalsAgainst} at R${last.round}; keeping the same setup.`;
  }
  return { tactics: t, starters: f.current.starters, rationale: why };
}

export function offlinePostMatch(f: PostMatchFacts): PostMatchReview {
  const m = f.match;
  const note = `R${m.round} ${m.venue === "home" ? "vs" : "at"} ${m.opponent}: ${m.result} ${m.goalsFor}–${m.goalsAgainst}, possession ${Math.round(m.possession * 100)}%, shots ${m.shots}–${m.shotsAgainst}, height ${m.avgTeamHeight.toFixed(1)} m (${m.tactics}).`;
  const all = [m, ...f.recent.filter((r) => r.round !== m.round)];
  const w = all.filter((r) => r.result === "W").length;
  const d = all.filter((r) => r.result === "D").length;
  const l = all.filter((r) => r.result === "L").length;
  const lesson =
    m.result === "L"
      ? m.avgTeamHeight < 15
        ? "We sat too deep; push the line up."
        : m.shots <= m.shotsAgainst
          ? "We created too little; be more direct and shoot earlier."
          : "Chances came but didn't go in; keep the structure."
      : m.result === "D"
        ? "Solid, but we need more cutting edge."
        : "This setup works; keep it unless the opponent demands a change.";
  return {
    summary: `${f.team.name} have ${w} win${w === 1 ? "" : "s"}, ${d} draw${d === 1 ? "" : "s"} and ${l} defeat${l === 1 ? "" : "s"} in our last ${all.length} league matches. Latest: ${m.result} ${m.goalsFor}–${m.goalsAgainst} ${m.venue === "home" ? "vs" : "at"} ${m.opponent}.`,
    notes: [note, ...f.manager.memory.notes].slice(0, 6),
    lesson,
  };
}

export function offlineManagerLlm(pricedAs: string) {
  return new OfflineLlm(pricedAs, {
    "manager.pre_match": (c) => offlinePreMatch(c as ManagerFacts),
    "manager.post_match": (c) => offlinePostMatch(c as PostMatchFacts),
  });
}
