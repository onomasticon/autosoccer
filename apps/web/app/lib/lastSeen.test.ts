// @vitest-environment jsdom
import type { FixtureView } from "@autosoccer/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catchUp, nextSeen, parseSeen, readSeen, resultLine, SEEN_KEY, untilKickoff, writeSeen } from "./lastSeen";
import { mockFixtures, mockTeams } from "./mocks";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const club = mockTeams[0]!;
const mine = (fs: readonly FixtureView[]) =>
  fs.filter((f) => f.status === "completed" && f.score && (f.homeTeamId === club.id || f.awayTeamId === club.id));

describe("since you last checked", () => {
  it("first visit (or another club): nothing to catch up on; the next visit only shows new results", () => {
    expect(catchUp(null, "season-5", club, mockFixtures)).toEqual({ kind: "first" });
    const seen = nextSeen("season-5", club, mockFixtures, new Date("2026-11-15T10:00:00Z"));
    expect(catchUp(seen, "season-5", club, mockFixtures)).toEqual({ kind: "none", since: "2026-11-15T10:00:00.000Z" });
    expect(catchUp({ ...seen, club: "someone-else" }, "season-5", club, mockFixtures)).toEqual({ kind: "first" });
  });

  it("lists exactly the results played since, oldest first, with no duplicates or false 'new' items", () => {
    const played = mine(mockFixtures);
    expect(played.length).toBeGreaterThan(0);
    // Last time, only the first result had been played.
    const before = mockFixtures.map((f) =>
      played.slice(1).includes(f) ? { ...f, status: "scheduled" as const, score: null } : f,
    );
    const seen = nextSeen("season-5", club, before);
    const c = catchUp(seen, "season-5", club, mockFixtures);
    expect(c.kind).toBe(played.length > 1 ? "updates" : "none");
    if (c.kind === "updates") expect(c.fixtures.map((f) => f.id)).toEqual(played.slice(1).map((f) => f.id));
    // Other clubs' results and unplayed fixtures never count.
    if (c.kind === "updates") for (const f of c.fixtures) expect([f.homeTeamId, f.awayTeamId]).toContain(club.id);
  });

  it("a new season resets the count and says so", () => {
    const seen = nextSeen("season-4", club, mockFixtures);
    expect(catchUp(seen, "season-5", club, mockFixtures)).toEqual({ kind: "new-season", previousSeason: "season-4" });
  });

  it("missing, corrupt, foreign-version or blocked storage degrade to a first visit", () => {
    for (const bad of [
      "{",
      "null",
      "[]",
      JSON.stringify({ v: 2, season: "s", club: "c", fixtures: [] }),
      JSON.stringify({ v: 1 }),
    ]) {
      localStorage.setItem(SEEN_KEY, bad);
      expect(readSeen()).toBeNull();
      expect(localStorage.getItem(SEEN_KEY)).toBeNull(); // cleaned up
    }
    expect(parseSeen(JSON.stringify({ v: 1, season: "s", club: "c", fixtures: ["a", 3] }))).toMatchObject({
      fixtures: ["a"],
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSeen()).toBeNull();
    expect(() => writeSeen(nextSeen("s", club, mockFixtures))).not.toThrow();
  });

  it("says results from the club's side, and counts down to kick-off", () => {
    const f = mine(mockFixtures)[0]!;
    expect(resultLine(f, club.id)).toMatch(/^(Won|Lost|Drew) \d+–\d+ (v|at) .+ \(round \d+\)$/);
    const now = Date.parse("2026-11-15T10:00:00Z");
    expect(untilKickoff("2026-11-15T13:20:00Z", now)).toBe("in 3 h 20 min");
    expect(untilKickoff("2026-11-15T10:30:00Z", now)).toBe("in 30 min");
    expect(untilKickoff("2026-11-18T10:00:00Z", now)).toBe("in 3 days");
    expect(untilKickoff("2026-11-15T09:00:00Z", now)).toBeNull();
    expect(untilKickoff(null, now)).toBeNull();
  });
});
