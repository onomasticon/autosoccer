import type { Team } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import { closestPair, type GoalEvent, type MatchInput, pickLead, pickMoment, type SpotlightContext } from "./rule.ts";

const team = (id: string, name: string): Team => ({
  id,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  shortName: name.slice(0, 3).toUpperCase(),
  city: name,
  colors: { primary: "#245EFF", secondary: "#FFFFFF" },
  crest: { shape: "shield", glyph: name[0]! },
});
const T = {
  north: team("00000000-0000-4000-8000-000000000001", "Northgate"),
  salt: team("00000000-0000-4000-8000-000000000002", "Saltmarsh Athletic"),
  harbour: team("00000000-0000-4000-8000-000000000003", "Harbour City"),
  rovers: team("00000000-0000-4000-8000-000000000004", "Kestrel Rovers"),
};
const teams = new Map(Object.values(T).map((t) => [t.id, t]));
const P = {
  nyberg: { id: "p-nyberg", name: "Tove Nyberg", shirtNumber: 9, position: "FW" as const, teamId: T.north.id },
  mwangi: { id: "p-mwangi", name: "Amani Mwangi", shirtNumber: 10, position: "MF" as const, teamId: T.harbour.id },
  moon: { id: "p-moon", name: "Jae Moon", shirtNumber: 11, position: "FW" as const, teamId: T.harbour.id },
  salt1: { id: "p-salt", name: "Ines Varga", shirtNumber: 7, position: "FW" as const, teamId: T.salt.id },
  rov1: { id: "p-rov", name: "Kit Adeyemi", shirtNumber: 8, position: "MF" as const, teamId: T.rovers.id },
};
const players = new Map(Object.values(P).map((p) => [p.id, p]));
const season = { slug: "season-15", name: "Season 15" };

let n = 0;
/** Goals as [side, scorerId, period, clockSec]; the running score is filled in. */
function match(
  home: Team,
  away: Team,
  goals: Array<[GoalEvent["side"], string, GoalEvent["period"], number]>,
  replay = true,
): MatchInput {
  const score = { home: 0, away: 0 };
  n++;
  return {
    matchId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    fixtureId: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`,
    round: 1,
    season,
    home,
    away,
    replay,
    events: goals.map(([side, scorerId, period, clockSec]) => {
      score[side]++;
      return {
        type: "goal",
        tick: (period === "secondHalf" ? 10_000 : 0) + Math.round(clockSec * 60),
        period,
        clockSec,
        side,
        scorerId,
        ownGoal: false,
        score: { ...score },
      };
    }),
  };
}
const ctx = (over: Partial<SpotlightContext> = {}): SpotlightContext => ({
  players,
  allTime: new Map([
    [P.moon.id, { goals: 53, starts: 61 }],
    [P.nyberg.id, { goals: 40, starts: 70 }],
    [P.mwangi.id, { goals: 12, starts: 60 }],
  ]),
  season: new Map([
    [P.nyberg.id, { goals: 3, starts: 1 }],
    [P.mwangi.id, { goals: 1, starts: 1 }],
  ]),
  next: new Map([
    [
      T.north.id,
      {
        fixtureId: "00000000-0000-4000-8000-000000000999",
        round: 2,
        venue: "away" as const,
        opponent: T.rovers,
        scheduledAt: null,
      },
    ],
  ]),
  ...over,
});

describe("spotlight/1", () => {
  // Season 15 round one, as in the live review: Nyberg's three (two 26 seconds apart) beat Mwangi's winner.
  const round1 = [
    match(T.north, T.salt, [
      ["home", P.nyberg.id, "firstHalf", 40],
      ["away", P.salt1.id, "firstHalf", 95],
      ["home", P.nyberg.id, "secondHalf", 7],
      ["home", P.nyberg.id, "secondHalf", 33],
    ]),
    match(T.harbour, T.rovers, [["home", P.mwangi.id, "secondHalf", 110]]),
  ];

  it("leads with the standout performance, a named verified detail and a specific action", () => {
    const lead = pickLead({ round: 1, season, matches: round1 }, ctx(), teams)!;
    expect(lead.kind).toBe("hat_trick");
    expect(lead.player.name).toBe("Tove Nyberg");
    expect(lead.headline).toBe("Tove Nyberg scored three as Northgate beat Saltmarsh Athletic 3–1.");
    expect(lead.detail).toBe("Two of them came 26 match seconds apart.");
    expect(lead.action).toBe("Watch Nyberg's three goals");
    expect(lead.goals.map((g) => g.clockSec)).toEqual([40, 7, 33]);
    expect(lead.next?.opponent.name).toBe("Kestrel Rovers");
  });

  it("is deterministic: match order never changes the choice", () => {
    const a = pickLead({ round: 1, season, matches: round1 }, ctx(), teams);
    const b = pickLead({ round: 1, season, matches: [...round1].reverse() }, ctx(), teams);
    expect(b).toEqual(a);
  });

  it("a decisive goal beats a consolation; the winner reads as one", () => {
    const m = [
      match(T.harbour, T.rovers, [
        ["away", P.rov1.id, "firstHalf", 10],
        ["home", P.mwangi.id, "secondHalf", 20],
        ["home", P.moon.id, "secondHalf", 115],
      ]),
    ];
    const lead = pickLead({ round: 1, season, matches: m }, ctx({ season: new Map() }), teams)!;
    expect(lead.player.name).toBe("Jae Moon");
    expect(lead.kind).toBe("winner");
    expect(lead.headline).toBe("Jae Moon scored the winner as Harbour City beat Kestrel Rovers 2–1.");
    // The all-time record outranks the clock: Moon leads the league's scorers.
    expect(lead.detail).toBe("Jae Moon is the league's all-time top scorer: 53 goals in 61 starts.");
    expect(lead.action).toBe("Watch Moon's winner");
  });

  it("an equaliser in a draw; a lone 1–0 goal is 'the only goal'", () => {
    const draw = [
      match(T.salt, T.rovers, [
        ["away", P.rov1.id, "firstHalf", 30],
        ["home", P.salt1.id, "secondHalf", 90],
      ]),
    ];
    const eq = pickLead({ round: 1, season, matches: draw }, ctx({ allTime: new Map(), season: new Map() }), teams)!;
    expect(eq.kind).toBe("equaliser");
    expect(eq.player.name).toBe("Ines Varga");
    expect(eq.detail).toBe("The equaliser came at 2H 1:30.");
    const one = [match(T.rovers, T.salt, [["home", P.rov1.id, "firstHalf", 30]])];
    const w = pickLead({ round: 1, season, matches: one }, ctx({ allTime: new Map(), season: new Map() }), teams)!;
    expect(w.detail).toBe("It was the only goal of the match.");
  });

  it("a transfer or rescue with sporting significance: a new signing scores, a rescued club wins (#80)", () => {
    const one = [match(T.rovers, T.salt, [["home", P.rov1.id, "firstHalf", 30]])];
    const quiet = { allTime: new Map(), season: new Map() };
    const signed = pickLead(
      { round: 1, season, matches: one },
      ctx({
        ...quiet,
        signings: new Map([[P.rov1.id, { from: "Harbour City", fee: "2.9m cr", season: season.slug }]]),
      }),
      teams,
    )!;
    expect(signed.detail).toMatch(/^A new signing: .+ joined from Harbour City for 2\.9m cr before Season 15\.$/);
    const rescued = pickLead(
      { round: 1, season, matches: one },
      ctx({
        ...quiet,
        rescued: new Map([[T.rovers.id, { from: "Old Rovers", withdrewFrom: "Season 14", season: season.slug }]]),
      }),
      teams,
    )!;
    expect(rescued.detail).toBe(
      `It's ${T.rovers.name}' first season under new owners, after Old Rovers withdrew from Season 14.`,
    );
    // Last season's signing is old news.
    const old = pickLead(
      { round: 1, season, matches: one },
      ctx({
        ...quiet,
        signings: new Map([[P.rov1.id, { from: "Harbour City", fee: "2.9m cr", season: "season-14" }]]),
      }),
      teams,
    )!;
    expect(old.detail).toBe("It was the only goal of the match.");
  });

  it("no replay: the action reads the record instead of promising a clip", () => {
    const m = [match(T.harbour, T.rovers, [["home", P.mwangi.id, "secondHalf", 110]], false)];
    const lead = pickLead({ round: 1, season, matches: m }, ctx(), teams)!;
    expect(lead.replay).toBe(false);
    expect(lead.action).toBe("Read the record of Mwangi's match");
  });

  it("a scoreless round leads with the season's top scorer and their next match", () => {
    const quiet = [match(T.north, T.salt, []), match(T.harbour, T.rovers, [])];
    const lead = pickLead({ round: 2, season, matches: quiet }, ctx(), teams)!;
    expect(lead.kind).toBe("quiet");
    expect(lead.player.name).toBe("Tove Nyberg");
    expect(lead.headline).toBe("Round 2 ended without a goal. Tove Nyberg still leads the Season 15 scoring with 3.");
    expect(lead.matchId).toBeNull();
    expect(lead.action).toBe("See Nyberg's next match");
  });

  it("new season, no goals yet: the all-time leader, and their career when nothing is scheduled", () => {
    const lead = pickLead(
      { round: 12, season, matches: [match(T.north, T.salt, [])] },
      ctx({ season: new Map(), next: new Map() }),
      teams,
    )!;
    expect(lead.player.name).toBe("Jae Moon");
    expect(lead.headline).toContain("still leads the all-time scorers with 53");
    expect(lead.action).toBe("See Moon's career");
    expect(
      pickLead({ round: 1, season, matches: [] }, ctx({ season: new Map(), allTime: new Map() }), teams),
    ).toBeNull();
  });

  it("club moments only consider that club's scorers; own goals never count", () => {
    const m = match(T.north, T.salt, [
      ["home", P.nyberg.id, "firstHalf", 40],
      ["away", P.salt1.id, "firstHalf", 95],
    ]);
    expect(pickMoment([m], ctx(), { teamId: T.salt.id })?.player.name).toBe("Ines Varga");
    const og = { ...m, events: m.events.map((e) => ({ ...e, ownGoal: true })) };
    expect(pickMoment([og], ctx())).toBeNull();
  });

  it("closest pair ignores goals in different halves", () => {
    const g = (period: GoalEvent["period"], clockSec: number) =>
      ({
        type: "goal",
        tick: 0,
        period,
        clockSec,
        side: "home",
        scorerId: "x",
        ownGoal: false,
        score: { home: 0, away: 0 },
      }) as GoalEvent;
    expect(closestPair([g("firstHalf", 170), g("secondHalf", 5)])).toBeNull();
    expect(closestPair([g("secondHalf", 7), g("secondHalf", 33), g("secondHalf", 100)])).toBe(26);
  });
});
