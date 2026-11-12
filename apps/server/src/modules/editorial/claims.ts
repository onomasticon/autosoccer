/**
 * Cross-fact claim checks. The grounding checks prove every citation exists and every scoreline
 * is official; they can't see an inference that's false even though each cited fact is true
 * ("the side with less of the ball won both matches" when one winner had 55%). This module
 * rebuilds a small structured ledger from the facts (results, team stats, the table snapshot)
 * and evaluates the claim shapes journalists actually make against it, deterministically:
 *
 *  - results: "A beat B", "A lost to B", "A drew with B", "A won/lost", "A opened the scoring"
 *  - comparisons: "A had 55% possession", "A had more/less of the ball", "A took 5 shots"
 *  - aggregates across fixtures: "the side with less possession won both matches",
 *    "home sides won every match", "the team with more shots lost all of them"
 *  - the table: "A are top / second / bottom", "on N points", "unbeaten", "perfect record"
 *  - chronology: "round N" beyond the snapshot, "after N rounds" vs the snapshot
 *
 * A recognised claim that contradicts the ledger, or that the ledger can't resolve, is an error,
 * so the draft is repaired, replaced by the template writer, or rejected — never published.
 * Prose this module doesn't recognise is not judged (see docs/editorial/validation.md).
 */
import type { EditorialFacts } from "@autosoccer/contracts";

type Side = "home" | "away";
const STAT_KEYS = [
  "possession",
  "shots",
  "shotsOnTarget",
  "passesCompleted",
  "tacklesWon",
  "interceptions",
  "fouls",
] as const;
type StatKey = (typeof STAT_KEYS)[number];

interface MatchRec {
  id: string;
  round: number | null;
  home: { name: string; score: number };
  away: { name: string; score: number };
  scoreFact: string;
  stats: Partial<Record<StatKey, { home: number; away: number; factId: string }>>;
  firstGoal: { side: Side; factId: string } | null;
}
interface StandingRec {
  name: string;
  position: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** Last (up to five) results, oldest first. */
  form: Array<"W" | "D" | "L">;
  teams: number;
  factId: string;
}
export interface Ledger {
  matches: MatchRec[];
  standings: StandingRec[];
  afterRound: number | null;
  /** Round of the article's own match (match reports); null for round-wide pieces. */
  currentRound: number | null;
  /** alias (lower case) → canonical team name, longest aliases first */
  aliases: Array<[string, string]>;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : null;
const matchIdOf = (factId: string) => /^match:([^:]+):/.exec(factId)?.[1] ?? null;

/** Generic club words that would be ambiguous on their own. */
const GENERIC = new Set(["city", "united", "town", "athletic", "fc", "club", "the", "rovers fc"]);

function aliasesFor(name: string): string[] {
  const words = name.split(/\s+/);
  const out = new Set([name]);
  if (words.length > 1) {
    out.add(words.slice(0, -1).join(" "));
    out.add(words[0]!);
    out.add(words.at(-1)!);
  }
  return [...out].filter((a) => a.length >= 4 && !GENERIC.has(a.toLowerCase()));
}

export function buildLedger(ef: EditorialFacts): Ledger {
  const matches = new Map<string, MatchRec>();
  for (const f of ef.facts) {
    if (f.kind !== "score") continue;
    const v = obj(f.value);
    const ht = obj(v?.homeTeam);
    const at = obj(v?.awayTeam);
    const id = matchIdOf(f.id);
    if (!v || !id || !num(v.home) || !num(v.away) || typeof ht?.name !== "string" || typeof at?.name !== "string")
      continue;
    matches.set(id, {
      id,
      round: num(v.round) ? v.round : (ef.match?.round ?? null),
      home: { name: ht.name, score: v.home },
      away: { name: at.name, score: v.away },
      scoreFact: f.id,
      stats: {},
      firstGoal: null,
    });
  }
  for (const f of ef.facts) {
    const m = matches.get(matchIdOf(f.id) ?? "");
    if (!m) continue;
    const v = obj(f.value);
    if (f.kind === "stat") {
      const key = /:stat:(\w+)$/.exec(f.id)?.[1] as StatKey | undefined;
      if (key && STAT_KEYS.includes(key) && num(v?.home) && num(v?.away))
        m.stats[key] = { home: v.home, away: v.away, factId: f.id };
    }
    if (f.kind === "goal" && /:goal:1$/.test(f.id) && (v?.side === "home" || v?.side === "away"))
      m.firstGoal = { side: v.side, factId: f.id };
  }
  const standings: StandingRec[] = [];
  for (const f of ef.facts) {
    if (f.kind !== "standing") continue;
    const v = obj(f.value);
    const team = obj(v?.team);
    if (!v || typeof team?.name !== "string" || !num(v.position) || !num(v.points)) continue;
    standings.push({
      name: team.name,
      position: v.position,
      points: v.points,
      played: Number(v.played),
      won: Number(v.won),
      drawn: Number(v.drawn),
      lost: Number(v.lost),
      form: Array.isArray(v.form)
        ? (v.form as unknown[]).filter((x): x is "W" | "D" | "L" => x === "W" || x === "D" || x === "L")
        : [],
      teams: num(v.teams) ? v.teams : 0,
      factId: f.id,
    });
  }
  for (const s of standings) s.teams ||= standings.length;
  const names = new Set([...matches.values()].flatMap((m) => [m.home.name, m.away.name]));
  for (const s of standings) names.add(s.name);
  const count = new Map<string, number>();
  for (const n of names)
    for (const a of aliasesFor(n)) count.set(a.toLowerCase(), (count.get(a.toLowerCase()) ?? 0) + 1);
  const aliases: Array<[string, string]> = [];
  for (const n of names)
    for (const a of aliasesFor(n)) if (count.get(a.toLowerCase()) === 1) aliases.push([a.toLowerCase(), n]);
  aliases.sort((a, b) => b[0].length - a[0].length);
  return {
    matches: [...matches.values()],
    standings,
    afterRound: ef.generatedFrom.standingsAfterRound,
    currentRound: ef.match?.round ?? null,
    aliases,
  };
}

interface Mention {
  team: string;
  start: number;
  end: number;
}

function mentions(sentence: string, ledger: Ledger): Mention[] {
  const lower = sentence.toLowerCase();
  const taken: boolean[] = [];
  const out: Mention[] = [];
  for (const [alias, team] of ledger.aliases) {
    const re = new RegExp(`(?<![\\w-])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g");
    for (const m of lower.matchAll(re)) {
      const start = m.index;
      const end = start + alias.length;
      if (taken.slice(start, end).some(Boolean)) continue;
      for (let i = start; i < end; i++) taken[i] = true;
      out.push({ team, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Sentences, without breaking decimals ("27.9") or clocks ("1:28"). */
export function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9“"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const short = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);
const score = (m: MatchRec) => `${m.home.name} ${m.home.score}–${m.away.score} ${m.away.name}`;
const sideOf = (m: MatchRec, team: string): Side | null =>
  m.home.name === team ? "home" : m.away.name === team ? "away" : null;
const other = (s: Side): Side => (s === "home" ? "away" : "home");
const outcome = (m: MatchRec, s: Side): "won" | "lost" | "drew" => {
  const d = m[s].score - m[other(s)].score;
  return d > 0 ? "won" : d < 0 ? "lost" : "drew";
};
const pct = (v: number) => Math.round(v * 100);

/** Words that point a sentence at an earlier meeting rather than the article's own match. */
const EARLIER =
  /\b(?:earlier|previous|first|last|reverse|this season|season'?s|both meetings|both matches|twice|again)\b/i;

function roundScope(sentence: string, ledger: Ledger): MatchRec[] {
  const r = /\bround (\d+)\b/i.exec(sentence);
  if (!r) {
    // In a match report, an unqualified result claim is about this match, not an earlier meeting.
    if (ledger.currentRound !== null && !EARLIER.test(sentence)) {
      const own = ledger.matches.filter((m) => m.round === ledger.currentRound);
      if (own.length) return own;
    }
    return ledger.matches;
  }
  const n = Number(r[1]);
  const inRound = ledger.matches.filter((m) => m.round === n);
  return inRound.length ? inRound : ledger.matches;
}
const teamMatches = (sentence: string, ledger: Ledger, team: string) =>
  roundScope(sentence, ledger).filter((m) => sideOf(m, team));

// ——— results ————————————————————————————————————————————————————————————————

const WIN_VS =
  /^\s*(?:,\s*)?(?:beat|defeated|edged(?: past| out)?|saw off|thrashed|overcame|outscored|won (?:against|at|away at|away to|over))\s*$/i;
const LOSE_VS =
  /^\s*(?:,\s*)?(?:lost(?: away)? (?:to|at|against)|fell to|went down to|were beaten by|was beaten by|were defeated by)\s*$/i;
const DRAW_VS = /^\s*(?:,\s*)?(?:drew(?: with| at| against)?|held|and)\s*$/i;

function checkResults(sentence: string, ms: Mention[], ledger: Ledger, errors: string[]) {
  for (let i = 0; i + 1 < ms.length; i++) {
    const a = ms[i]!;
    const b = ms[i + 1]!;
    const gap = sentence.slice(a.end, b.start).replace(/^'s?\s*/, "");
    let claim: "won" | "lost" | "drew" | null = null;
    if (WIN_VS.test(gap)) claim = "won";
    else if (LOSE_VS.test(gap)) claim = "lost";
    else if (DRAW_VS.test(gap)) {
      if (/^\s*and\s*$/i.test(gap)) {
        const after = sentence.slice(b.end, b.end + 30);
        if (!/^\s+(?:drew|shared the points|played out a draw|could not be separated)/i.test(after)) continue;
      } else if (/^\s*held\s*$/i.test(gap) && !/^\s+(?:to a draw|to a \d+[–—-]\d+ draw)/i.test(sentence.slice(b.end))) {
        continue;
      }
      claim = "drew";
    }
    if (!claim || a.team === b.team) continue;
    const meetings = roundScope(sentence, ledger).filter((m) => sideOf(m, a.team) && sideOf(m, b.team));
    if (!meetings.length) {
      errors.push(`cannot verify "${short(sentence)}": no official result between ${a.team} and ${b.team}`);
      continue;
    }
    if (!meetings.some((m) => outcome(m, sideOf(m, a.team)!) === claim)) {
      const m = meetings[0]!;
      errors.push(
        `contradiction: "${short(sentence)}" says ${a.team} ${claim === "drew" ? "drew with" : claim === "won" ? "beat" : "lost to"} ${b.team}, but the official result is ${score(m)} (${m.scoreFact})`,
      );
    }
  }
  // "A won 1–0", "A lost", "A won again": a result claim with no opponent named.
  for (const a of ms) {
    const after = sentence.slice(a.end);
    const r =
      /^(?:'s?)?\s+(?:(?:have|had|also|again|duly|eventually|ultimately|still|then)\s+)?(won|lost|drew)(?=\s*(?:$|[,.;:!?)]|\s+(?:\d{1,2}\s*[–—-]\s*\d{1,2}|by\b|at\b|away\b|again\b|in round\b|on the road\b|at home\b|the match\b|the game\b|their match\b|their game\b|it\b|comfortably\b|narrowly\b|convincingly\b)))/i.exec(
        after,
      );
    if (!r) continue;
    const claim = r[1]!.toLowerCase() as "won" | "lost" | "drew";
    const games = teamMatches(sentence, ledger, a.team);
    if (!games.length) {
      errors.push(`cannot verify "${short(sentence)}": no official result for ${a.team}`);
      continue;
    }
    if (!games.some((m) => outcome(m, sideOf(m, a.team)!) === claim)) {
      const m = games[0]!;
      errors.push(
        `contradiction: "${short(sentence)}" says ${a.team} ${claim}, but the official result is ${score(m)} (${m.scoreFact})`,
      );
    }
  }
  // "A opened the scoring" / "opened the scoring for A"
  const open = /opened the scoring(?: for)?/i.exec(sentence);
  if (open) {
    const before = [...ms].reverse().find((m) => m.end <= open.index && open.index - m.end < 25);
    const after = /for$/i.test(open[0]) ? ms.find((m) => m.start >= open.index + open[0].length) : undefined;
    const who = after ?? before;
    if (who) {
      const games = teamMatches(sentence, ledger, who.team);
      const ok = games.some((m) => m.firstGoal && m.firstGoal.side === sideOf(m, who.team));
      if (games.length && !ok)
        errors.push(
          `contradiction: "${short(sentence)}" says ${who.team} opened the scoring, but the official first goal went to their opponent${games[0]!.firstGoal ? ` (${games[0]!.firstGoal.factId})` : " (no goals were scored)"}`,
        );
    }
  }
}

// ——— team statistics ————————————————————————————————————————————————————————

const STAT_NOUN: Array<[RegExp, StatKey]> = [
  [/^shots? on target\b/i, "shotsOnTarget"],
  [/^shots?\b(?! on target)/i, "shots"],
  [/^(?:completed passes|passes completed|completed pass|passes)\b/i, "passesCompleted"],
  [/^tackles?(?: won)?\b/i, "tacklesWon"],
  [/^interceptions?\b/i, "interceptions"],
  [/^fouls?\b/i, "fouls"],
];
const SUBJECT_VERB =
  /^(?:'s?)?\s+(?:(?:only|just|still|also)\s+)?(?:had|took|managed|registered|mustered|made|committed|completed|won|attempted|produced|fired|put|enjoyed|kept|held)\s+/i;
const CHAIN =
  /^\s*(?:,\s*)?(?:and|but|yet|while|,)\s+(?:(?:only|just|still|also)\s+)?(?:had|took|managed|registered|mustered|made|committed|completed|won|attempted|produced|fired|put|enjoyed|kept|held)\s+/i;

function checkStats(sentence: string, ms: Mention[], ledger: Ledger, errors: string[]) {
  for (const [i, a] of ms.entries()) {
    const nextStart = ms[i + 1]?.start ?? sentence.length;
    let rest = sentence.slice(a.end, nextStart);
    let lead = SUBJECT_VERB.exec(rest);
    const games = teamMatches(sentence, ledger, a.team);
    while (lead) {
      rest = rest.slice(lead[0].length);
      const claim = parseStat(rest);
      if (!claim) break;
      if (games.length === 1) {
        const m = games[0]!;
        const s = sideOf(m, a.team)!;
        const stat = m.stats[claim.key];
        if (stat) {
          const actual = stat[s];
          const ok =
            claim.key === "possession"
              ? claim.kind === "value"
                ? Math.abs(pct(actual) - claim.value) <= 1
                : claim.kind === "more"
                  ? actual > stat[other(s)]
                  : actual < stat[other(s)]
              : claim.kind === "value"
                ? actual === claim.value
                : claim.kind === "more"
                  ? actual > stat[other(s)]
                  : actual < stat[other(s)];
          if (!ok)
            errors.push(
              `contradiction: "${short(sentence)}" — official ${claim.key === "possession" ? "possession" : claim.key}: ${m.home.name} ${fmt(claim.key, stat.home)}, ${m.away.name} ${fmt(claim.key, stat.away)} (${stat.factId})`,
            );
        }
      }
      rest = rest.slice(claim.length);
      lead = CHAIN.exec(rest);
    }
  }
}
const fmt = (k: StatKey, v: number) => (k === "possession" ? `${pct(v)}%` : String(v));

function parseStat(s: string): { key: StatKey; kind: "value" | "more" | "less"; value: number; length: number } | null {
  const p = /^(?:(?:only|just)\s+)?(\d{1,3})%\s+(?:of\s+(?:the\s+)?(?:ball|possession)|possession)\b/i.exec(s);
  if (p) return { key: "possession", kind: "value", value: Number(p[1]), length: p[0].length };
  const c =
    /^(?:(?:much|far|slightly|a little)\s+)?(more|less|the majority|the minority|most|least)\s+(?:of\s+)?(?:the\s+)?(?:ball|possession)\b/i.exec(
      s,
    );
  if (c) {
    const more = /more|majority|most/i.test(c[1]!);
    return { key: "possession", kind: more ? "more" : "less", value: 0, length: c[0].length };
  }
  const n = /^(?:(?:only|just)\s+)?(\d{1,3})\s+/i.exec(s);
  if (!n) return null;
  const tail = s.slice(n[0].length);
  for (const [re, key] of STAT_NOUN) {
    const m = re.exec(tail);
    if (m) return { key, kind: "value", value: Number(n[1]), length: n[0].length + m[0].length };
  }
  return null;
}

// ——— aggregates across fixtures ——————————————————————————————————————————————

type Group = { label: string; pick: (m: MatchRec) => Side | null };
const statGroup = (key: StatKey, dir: "more" | "less", label: string): Group => ({
  label,
  pick: (m) => {
    const s = m.stats[key];
    if (!s || s.home === s.away) return null;
    return (dir === "more") === s.home > s.away ? "home" : "away";
  },
});
const GROUPS: Array<[RegExp, Group]> = [
  [
    /\b(?:less|lower|smaller share|minority|least|fewer)\b[^,;.]{0,25}\b(?:possession|of the ball|ball)\b|\b(?:lower|less|low)-possession\b|\bwithout the ball\b/i,
    statGroup("possession", "less", "the side with less possession"),
  ],
  [
    /\b(?:more|higher|bigger share|larger share|majority|most|greater share)\b[^,;.]{0,25}\b(?:possession|of the ball|ball)\b|\b(?:higher|more|high)-possession\b|\bdominated possession\b/i,
    statGroup("possession", "more", "the side with more possession"),
  ],
  [/\bfewer shots\b|\bless shots\b/i, statGroup("shots", "less", "the side with fewer shots")],
  [/\bmore shots\b|\bmost shots\b/i, statGroup("shots", "more", "the side with more shots")],
  [/\bhome (?:side|team|club)s?\b|\bhosts\b/i, { label: "the home side", pick: () => "home" }],
  [
    /\baway (?:side|team|club)s?\b|\bvisitors\b|\bvisiting (?:side|team)s?\b/i,
    { label: "the away side", pick: () => "away" },
  ],
];

function checkAggregates(sentence: string, ledger: Ledger, errors: string[]) {
  const q =
    /\b(both|all|every|each|neither|none|no)\b(?:\s+(?:of\s+)?(?:the\s+)?(?:two\s+|three\s+|four\s+|opening\s+|round[- ]\d+\s+)?(?:matches|games|fixtures|match|game|fixture|of them|occasions))?/i;
  const verb = /\b(won|win|wins|lost|lose|loses|drew|draw|draws|were won|were lost|ended level)\b/i.exec(sentence);
  if (!verb) return;
  const qm = q.exec(sentence);
  if (!qm || !/match|game|fixture|of them|occasion|both|neither|every|each|all/i.test(qm[0])) return;
  if (/^(?:all|no)$/i.test(qm[0])) return; // "all" / "no" alone is too loose to be a claim
  const found = GROUPS.find(([re]) => re.test(sentence));
  if (!found) return;
  const [, group] = found;
  const v = verb[1]!.toLowerCase();
  // "were won by the side with ..." / "the side with ... won"
  const want: "won" | "lost" | "drew" = /^(?:won|win|wins|were won)$/.test(v)
    ? "won"
    : /^(?:lost|lose|loses|were lost)$/.test(v)
      ? "lost"
      : "drew";
  const quant = qm[1]!.toLowerCase();
  const negative = quant === "neither" || quant === "none" || quant === "no";
  const scope = roundScope(sentence, ledger);
  if (!scope.length) {
    errors.push(`cannot verify "${short(sentence)}": no official results in the record to compare`);
    return;
  }
  if (quant === "both" && scope.length !== 2) {
    errors.push(`contradiction: "${short(sentence)}" says both matches, but the record has ${scope.length}`);
    return;
  }
  const bad: string[] = [];
  for (const m of scope) {
    const s = group.pick(m);
    const holds = s !== null && (want === "drew" ? outcome(m, "home") === "drew" : outcome(m, s) === want);
    if (holds === negative) {
      const stat = group.label.includes("possession")
        ? m.stats.possession
        : group.label.includes("shots")
          ? m.stats.shots
          : null;
      bad.push(
        `${score(m)}${stat ? `, ${group.label.includes("possession") ? "possession" : "shots"} ${fmt(group.label.includes("possession") ? "possession" : "shots", stat.home)}–${fmt(group.label.includes("possession") ? "possession" : "shots", stat.away)}` : ""} (${[m.scoreFact, stat?.factId].filter(Boolean).join(", ")})`,
      );
    }
  }
  if (bad.length)
    errors.push(
      `contradiction: "${short(sentence)}" — ${group.label} ${negative ? "did" : "did not"} ${want === "won" ? "win" : want === "lost" ? "lose" : "draw"} in: ${bad.join("; ")}`,
    );
}

/** "Both winners had less of the ball", "each beaten side had more shots": a comparison across matches. */
function checkWinnerComparisons(sentence: string, ledger: Ledger, errors: string[]) {
  const subj =
    /\b(both|all|every|each)\b(?:\s+(?:of\s+)?(?:the\s+)?(?:two\s+|three\s+|round[- ]\d+\s+)?)?\s*(winners?|winning (?:sides?|teams?)|victors?|losers?|losing (?:sides?|teams?)|beaten (?:sides?|teams?))\b/i.exec(
      sentence,
    );
  if (!subj) return;
  const pred =
    /\b(more|less|fewer|most|least|majority|minority|bigger share|smaller share)\b[^,;.]{0,20}?\b(possession|of the ball|ball|shots)\b/i.exec(
      sentence.slice(subj.index + subj[0].length),
    );
  if (!pred) return;
  const winners = /^(?:winn|victor)/i.test(subj[2]!);
  const key: StatKey = /shots/i.test(pred[2]!) ? "shots" : "possession";
  const more = /more|most|majority|bigger/i.test(pred[1]!);
  const decided = roundScope(sentence, ledger).filter((m) => m.home.score !== m.away.score);
  if (subj[1]!.toLowerCase() === "both" && decided.length !== 2) {
    errors.push(`contradiction: "${short(sentence)}" says both, but the record has ${decided.length} decided matches`);
    return;
  }
  const bad: string[] = [];
  for (const m of decided) {
    const w: Side = m.home.score > m.away.score ? "home" : "away";
    const s = winners ? w : other(w);
    const st = m.stats[key];
    if (!st) {
      errors.push(`cannot verify "${short(sentence)}": no ${key} record for ${score(m)}`);
      return;
    }
    if (!(more ? st[s] > st[other(s)] : st[s] < st[other(s)]))
      bad.push(`${score(m)}, ${key} ${fmt(key, st.home)}–${fmt(key, st.away)} (${st.factId})`);
  }
  if (bad.length)
    errors.push(
      `contradiction: "${short(sentence)}" — not true of the ${winners ? "winners" : "beaten sides"} in: ${bad.join("; ")}`,
    );
}

// ——— the table ——————————————————————————————————————————————————————————————

const ORD: Record<string, number> = {
  first: 1,
  "1st": 1,
  top: 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
};

function checkTable(sentence: string, ms: Mention[], ledger: Ledger, errors: string[]) {
  if (!ledger.standings.length) return;
  for (const [i, a] of ms.entries()) {
    const rest = sentence.slice(a.end, ms[i + 1]?.start ?? sentence.length);
    const row = ledger.standings.find((s) => s.name === a.team);
    const pos =
      /^(?:'s?)?\s+(?:are|is|sit|sits|stay|stays|remain|remains|go|goes|went|move|moves|moved|climb|climbs|climbed|drop|drops|dropped|lie|lies|were|was|finish|finished|end|ends|ended|now)\s+(?:up\s+|down\s+|clear\s+)?(?:(?:in|to|at)\s+)?(?:the\s+)?(top|first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|bottom|last)\b(?!\s+(?:goal|half|shot|match|game|win|defeat|loss|time|half|round|minute|of the (?:half|match|game)))/i.exec(
        rest,
      ) ??
      /^(?:'s?)?\s+(top|lead|leads|led|head|heads)\s+(?:the\s+)?(?:table|league|standings)\b/i.exec(rest) ??
      /^(?:'s?)?\s+(?:are\s+|sit\s+|is\s+)?(?:at\s+the\s+)?(top|bottom)\s+of\s+the\s+(?:table|league|standings)\b/i.exec(
        rest,
      ) ??
      /^(?:'s?)?\s+(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|bottom|last)\s+(?=on\s+\d+\s+points?|with\s+\d+\s+points?|in the table|place\b)/i.exec(
        rest,
      );
    if (pos) {
      const w = pos[1]!.toLowerCase();
      const claimed = /^(?:bottom|last)$/.test(w)
        ? -1
        : (ORD[w] ?? (/^(?:lead|leads|led|head|heads)$/.test(w) ? 1 : 0));
      if (!row) errors.push(`cannot verify "${short(sentence)}": ${a.team} is not in the table snapshot`);
      else if (claimed && (claimed === -1 ? row.position !== row.teams : row.position !== claimed))
        errors.push(
          `contradiction: "${short(sentence)}" — in the table after round ${ledger.afterRound ?? "?"}, ${a.team} are ${ordinal(row.position)} (${row.factId})`,
        );
    }
    const pts = /^[^.;]{0,40}?\b(?:on|with)\s+(\d{1,3})\s+points?\b/i.exec(rest);
    if (pts && row && Number(pts[1]) !== row.points && !/\bfrom\b|\bbehind\b|\bclear\b|\bgap\b/i.test(pts[0]))
      errors.push(
        `contradiction: "${short(sentence)}" — ${a.team} have ${row.points} point${row.points === 1 ? "" : "s"} after round ${ledger.afterRound ?? "?"} (${row.factId})`,
      );
    const rec =
      /^,?[^.;,]{0,40}?\b(unbeaten|undefeated|perfect record|maximum points|100% record|winless|without a win|yet to win|yet to lose|without a point|pointless)\b/i.exec(
        rest,
      );
    if (rec && row) {
      const k = rec[1]!.toLowerCase();
      // "unbeaten in their last two" is about the recent run (form), not the whole season.
      const win =
        /\b(?:in|from|over|across)\s+(?:(?:their|its|the|his|her)\s+)?(?:(?:last|past|previous)\s+)?(\d|one|two|three|four|five|six)\b(?!\s*(?:points?|goals?|[–-]))/i.exec(
          rest,
        ) ??
        /\b(\d|one|two|three|four|five|six)\s+(?:league\s+)?(?:games|matches|outings|fixtures)\s+(?:without|unbeaten)\b/i.exec(
          sentence,
        );
      const n = win ? (WORDS[win[1]!.toLowerCase()] ?? Number(win[1])) : null;
      let results: Array<"W" | "D" | "L"> | null = null;
      let label = `record after round ${ledger.afterRound ?? "?"}: W${row.won} D${row.drawn} L${row.lost}`;
      if (n === null || n >= row.played) {
        results = [
          ...Array<"W">(row.won).fill("W"),
          ...Array<"D">(row.drawn).fill("D"),
          ...Array<"L">(row.lost).fill("L"),
        ];
      } else if (n <= row.form.length) {
        results = row.form.slice(-n);
        label = `last ${n} result${n === 1 ? "" : "s"} after round ${ledger.afterRound ?? "?"}: ${results.join("")}`;
      }
      if (!results) {
        errors.push(
          `cannot verify "${short(sentence)}": form only covers the last ${row.form.length} results (${row.factId})`,
        );
      } else {
        const ok = /unbeaten|undefeated|yet to lose/.test(k)
          ? !results.includes("L")
          : /perfect|maximum|100%/.test(k)
            ? results.length > 0 && results.every((r) => r === "W")
            : /winless|without a win|yet to win/.test(k)
              ? !results.includes("W")
              : results.every((r) => r === "L");
        if (!ok) errors.push(`contradiction: "${short(sentence)}" — ${a.team} ${label} (${row.factId})`);
      }
    }
  }
}
const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

// ——— chronology —————————————————————————————————————————————————————————————

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const FUTURE =
  /\b(next|will|upcoming|ahead|await|awaits|face|faces|visit|visits|host|hosts|travel|travels|coming|before)\b/i;

function checkChronology(sentence: string, ledger: Ledger, errors: string[]) {
  const now = ledger.afterRound ?? Math.max(0, ...ledger.matches.map((m) => m.round ?? 0));
  if (!now) return;
  for (const m of sentence.matchAll(/\bround (\d{1,2})\b/gi)) {
    const n = Number(m[1]);
    if (n > now && !FUTURE.test(sentence))
      errors.push(`chronology: "${short(sentence)}" describes round ${n}, but the record only runs to round ${now}`);
  }
  const after = /\bafter (one|two|three|four|five|six|\d{1,2}) rounds?\b/i.exec(sentence);
  if (after) {
    const n = WORDS[after[1]!.toLowerCase()] ?? Number(after[1]);
    if (n !== now) errors.push(`chronology: "${short(sentence)}" — the table snapshot is after round ${now}, not ${n}`);
  }
}

// ——— entry point ————————————————————————————————————————————————————————————

/** Checks every recognised claim in the text against the facts. Returns human-readable errors. */
export function checkClaims(text: string, facts: EditorialFacts, ledger = buildLedger(facts)): string[] {
  const errors: string[] = [];
  for (const s of sentences(text)) {
    const ms = mentions(s, ledger);
    checkResults(s, ms, ledger, errors);
    checkStats(s, ms, ledger, errors);
    checkAggregates(s, ledger, errors);
    checkWinnerComparisons(s, ledger, errors);
    checkTable(s, ms, ledger, errors);
    checkChronology(s, ledger, errors);
  }
  return [...new Set(errors)];
}

/** Each citation's own text must be consistent with the record too. */
export function checkCitationClaims(
  citations: Array<{ factId: string; text: string }>,
  facts: EditorialFacts,
): string[] {
  const ledger = buildLedger(facts);
  return citations.flatMap((c) => checkClaims(c.text, facts, ledger).map((e) => `citation ${c.factId}: ${e}`));
}
