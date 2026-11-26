/**
 * Helpers for the homepage spotlight (spotlight/1): where its action goes, the replay focus for a
 * player's goals, and short, distinct reasons to pick each club. All from the official record.
 */
import {
  type MatchDetailResponse,
  type OfficialEvent,
  playerHref,
  type ScorerRow,
  type SeasonSummary,
  type Spotlight,
  type StandingRow,
  type Team,
} from "@autosoccer/contracts";
import type { ReplayFocus } from "../components/match-viewer/MatchViewer";
import { matchdayHref } from "./matchday";

export const surname = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;
export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Match centre with the player's clip cued and playing. */
export const clipHref = (matchId: string, playerId: string) =>
  `/matches/${matchId}?clip=${encodeURIComponent(playerId)}#replay`;

/** Where the spotlight's primary action goes: the clip, else the match record, else the next match or career. */
export function spotlightHref(s: Spotlight): string {
  if (s.matchId && s.replay) return clipHref(s.matchId, s.player.id);
  if (s.matchId) return `/matches/${s.matchId}`;
  if (s.next) return matchdayHref(s.next.fixtureId);
  return playerHref(s.player);
}

/** Simulator slot id ("blue-3") of a starter, from the match's lineups (slot order). */
type Lineups = Record<"home" | "away", ReadonlyArray<{ id: string; name: string }>>;

export function simIdOf(lineups: Lineups, playerId: string): string | null {
  const h = lineups.home.findIndex((p) => p.id === playerId);
  if (h >= 0) return `blue-${h + 1}`;
  const a = lineups.away.findIndex((p) => p.id === playerId);
  return a >= 0 ? `red-${a + 1}` : null;
}

/** The replay focus for one player's goals in a match (null if they didn't score in it). */
export function focusFor(
  detail: { events: MatchDetailResponse["events"]; lineups: Lineups },
  playerId: string,
  opts: { autoplay?: boolean; label?: string } = {},
): ReplayFocus | null {
  const goals = detail.events.filter(
    (e): e is Extract<OfficialEvent, { type: "goal" }> => e.type === "goal" && !e.ownGoal && e.scorerId === playerId,
  );
  if (!goals.length) return null;
  const p = [...detail.lineups.home, ...detail.lineups.away].find((x) => x.id === playerId);
  const name = p?.name ?? "Player";
  const n = goals.length;
  return {
    simId: simIdOf(detail.lineups, playerId),
    playerId,
    name,
    ticks: goals.map((g) => g.tick),
    label: opts.label ?? `Watch ${possessive(surname(name))} ${n > 1 ? `${WORDS[n] ?? n} goals` : "goal"}`,
    autoplay: opts.autoplay,
  };
}

/** "won their last 3", "unbeaten in 4", from the form guide (oldest first). */
function formRun(form: readonly string[]): { kind: "wins" | "unbeaten"; n: number } | null {
  let wins = 0;
  for (const r of [...form].reverse()) {
    if (r !== "W") break;
    wins++;
  }
  if (wins >= 2) return { kind: "wins", n: wins };
  let unbeaten = 0;
  for (const r of [...form].reverse()) {
    if (r === "L") break;
    unbeaten++;
  }
  return unbeaten >= 3 ? { kind: "unbeaten", n: unbeaten } : null;
}

const LEAD_DID: Record<Spotlight["kind"], (goals: number) => string> = {
  hat_trick: (n) => `scored ${WORDS[n] ?? n}`,
  brace: () => "scored twice",
  winner: () => "scored the winner",
  equaliser: () => "scored the equaliser",
  goal: () => "scored",
  quiet: () => "leads the scoring",
};

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/**
 * One short reason per club to pick it, each from a different angle where possible (honours,
 * players, recent form), so the four choices don't read alike. Deterministic: candidates are
 * tried in a fixed order and each angle is used once before any repeats.
 */
export function clubReasons(input: {
  teams: readonly Team[];
  seasons: readonly SeasonSummary[];
  allTimeScorers: readonly ScorerRow[];
  standings: readonly StandingRow[] | null;
  lead: Spotlight | null;
}): Record<string, string> {
  const { teams, seasons, allTimeScorers, standings, lead } = input;
  const done = seasons.filter((s) => s.season.status === "completed");
  const holders = done[0]?.leader?.team.id ?? null;
  const titles = (id: string) => done.filter((s) => s.leader?.team.id === id);
  const topAllTime = allTimeScorers[0];
  type Cand = { angle: "honours" | "players" | "form"; text: string };
  const options = new Map<string, Cand[]>();
  for (const t of teams) {
    const c: Cand[] = [];
    const won = titles(t.id);
    const row = standings?.find((r) => r.team.id === t.id);
    if (lead && lead.kind !== "quiet" && lead.team.id === t.id)
      c.push({
        angle: "players",
        text: `${lead.player.name} ${LEAD_DID[lead.kind](lead.goals.length)} in round ${lead.round}`,
      });
    if (holders === t.id)
      c.push({
        angle: "honours",
        text: `Defending champions${won.length > 1 ? `, ${won.length} titles in all` : ""}`,
      });
    if (topAllTime && topAllTime.team.id === t.id)
      c.push({
        angle: "players",
        text: `Home of ${topAllTime.name}, the league's all-time top scorer (${topAllTime.goals})`,
      });
    if (row && row.played > 0 && row.position === 1)
      c.push({ angle: "form", text: `Top of the table on ${row.points} points` });
    const run = row ? formRun(row.form) : null;
    if (run) c.push({ angle: "form", text: run.kind === "wins" ? `Won their last ${run.n}` : `Unbeaten in ${run.n}` });
    const best = allTimeScorers.find((s) => s.team.id === t.id && s !== topAllTime);
    if (best) c.push({ angle: "players", text: `${best.name}: ${best.goals} league goals and counting` });
    if (won.length && holders !== t.id)
      c.push({
        angle: "honours",
        text: `${won.length} title${won.length === 1 ? "" : "s"}, last in ${won[0]!.season.name}`,
      });
    if (!won.length && done.length) c.push({ angle: "honours", text: "Still chasing a first league title" });
    if (row && row.played > 0) c.push({ angle: "form", text: `${ordinal(row.position)} on ${row.points} points` });
    options.set(t.id, c);
  }
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const usedText = new Set<string>();
  // Clubs with the fewest options choose first, so everyone gets something distinct.
  const order = [...teams].sort(
    (a, b) => options.get(a.id)!.length - options.get(b.id)!.length || a.name.localeCompare(b.name),
  );
  for (const t of order) {
    const c = options.get(t.id)!.filter((x) => !usedText.has(x.text));
    const pick = c.find((x) => !used.has(x.angle)) ?? c[0];
    if (!pick) continue;
    out[t.id] = pick.text;
    used.add(pick.angle);
    usedText.add(pick.text);
    if (used.size === 3) used.clear();
  }
  return out;
}
