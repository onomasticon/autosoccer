/**
 * "Since you last checked": what a returning visitor's followed club has played since their last
 * visit, from a small record kept in this browser only (no accounts, nothing sent to the server,
 * so shared edge-cached pages are unaffected). Read and written after hydration, never on the server.
 */
import type { FixtureView } from "@autosoccer/contracts";

export const SEEN_KEY = "autosoccer.lastSeen";
const VERSION = 1;

export interface SeenRecord {
  v: typeof VERSION;
  /** Season slug and club slug the record is about. */
  season: string;
  club: string;
  /** The club's completed fixtures already shown to this visitor. */
  fixtures: string[];
  at: string;
}

/** Parses a stored record; anything malformed or from another version is ignored. */
export function parseSeen(raw: string | null): SeenRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SeenRecord>;
    if (v?.v !== VERSION || typeof v.season !== "string" || typeof v.club !== "string" || !Array.isArray(v.fixtures))
      return null;
    const fixtures = v.fixtures.filter((f): f is string => typeof f === "string").slice(0, 200);
    return { v: VERSION, season: v.season, club: v.club, fixtures, at: typeof v.at === "string" ? v.at : "" };
  } catch {
    return null;
  }
}

export type CatchUp =
  /** First visit with this club (or no usable record): nothing to catch up on, start counting. */
  | { kind: "first" }
  /** A new season has started since the last visit. */
  | { kind: "new-season"; previousSeason: string }
  /** Results the visitor hasn't seen, oldest first. */
  | { kind: "updates"; fixtures: FixtureView[]; since: string }
  | { kind: "none"; since: string };

/** What to tell a returning visitor about `club` in `season`, given what they saw last time. */
export function catchUp(
  seen: SeenRecord | null,
  season: string,
  club: { id: string; slug: string },
  fixtures: readonly FixtureView[],
): CatchUp {
  if (!seen || seen.club !== club.slug) return { kind: "first" };
  if (seen.season !== season) return { kind: "new-season", previousSeason: seen.season };
  const known = new Set(seen.fixtures);
  const fresh = clubResults(fixtures, club.id).filter((f) => !known.has(f.id));
  return fresh.length ? { kind: "updates", fixtures: fresh, since: seen.at } : { kind: "none", since: seen.at };
}

/** The club's completed fixtures, in order. */
export function clubResults(fixtures: readonly FixtureView[], clubId: string): FixtureView[] {
  return fixtures.filter(
    (f) => f.status === "completed" && f.score && (f.homeTeamId === clubId || f.awayTeamId === clubId),
  );
}

/** The record to store after this visit. */
export function nextSeen(
  season: string,
  club: { id: string; slug: string },
  fixtures: readonly FixtureView[],
  now = new Date(),
): SeenRecord {
  return {
    v: VERSION,
    season,
    club: club.slug,
    fixtures: clubResults(fixtures, club.id).map((f) => f.id),
    at: now.toISOString(),
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSeen(): SeenRecord | null {
  try {
    const s = storage();
    const raw = s?.getItem(SEEN_KEY) ?? null;
    const rec = parseSeen(raw);
    if (!rec && raw !== null) s?.removeItem(SEEN_KEY); // drop corrupt or old-format values
    return rec;
  } catch {
    return null;
  }
}

export function writeSeen(rec: SeenRecord) {
  try {
    storage()?.setItem(SEEN_KEY, JSON.stringify(rec));
  } catch {
    // blocked or full storage: the catch-up just won't persist
  }
}

/** One result from the club's side: "won 3–1 v Saltmarsh Athletic (round 4)". */
export function resultLine(f: FixtureView, clubId: string): string {
  const home = f.homeTeamId === clubId;
  const gf = home ? f.score!.home : f.score!.away;
  const ga = home ? f.score!.away : f.score!.home;
  const verb = gf > ga ? "Won" : gf < ga ? "Lost" : "Drew";
  return `${verb} ${gf}–${ga} ${home ? "v" : "at"} ${home ? f.away.name : f.home.name} (round ${f.round})`;
}

/** "in 3 h 20 min", "in 2 days", "now", for a kickoff; null if unknown or past. */
export function untilKickoff(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const min = Math.round(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `in ${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}
