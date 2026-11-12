/**
 * Adversarial fixtures for the cross-fact claim checks. The facts below mirror the official
 * round-1 record of the launch season (Harbour City 0–4 Red Rock Rovers, Saltmarsh Athletic
 * 1–0 Northgate Comets); the reviewed analysis is reproduced verbatim from the published piece.
 */
import type { EditorialFacts, Fact } from "@autosoccer/contracts";
import { describe, expect, it } from "vitest";
import { buildLedger, checkClaims, sentences } from "./claims.ts";
import { type ArticleDraft, checkGrounding } from "./grounding.ts";

const SEASON = "00000000-0000-4000-8000-000000000001";
const team = (id: string, name: string) => ({ id, name });
const HBC = team("t-hbc", "Harbour City");
const RRR = team("t-rrr", "Red Rock Rovers");
const SMA = team("t-sma", "Saltmarsh Athletic");
const NGC = team("t-ngc", "Northgate Comets");
const src = (id: string) => ({ table: "matches", id });

interface M {
  id: string;
  round: number;
  home: { id: string; name: string };
  away: { id: string; name: string };
  score: [number, number];
  goals: Array<{ side: "home" | "away"; score: [number, number]; ownGoal?: boolean }>;
  stats: Record<string, [number, number]>;
}

function matchFactsOf(m: M): Fact[] {
  const f: Fact[] = [
    {
      id: `match:${m.id}:score`,
      kind: "score",
      statement: `Final score (round ${m.round}): ${m.home.name} ${m.score[0]}–${m.score[1]} ${m.away.name}`,
      value: { home: m.score[0], away: m.score[1], round: m.round, homeTeam: m.home, awayTeam: m.away },
      source: src(m.id),
    },
  ];
  for (const [i, g] of m.goals.entries())
    f.push({
      id: `match:${m.id}:goal:${i + 1}`,
      kind: "goal",
      statement: `Goal ${i + 1}`,
      value: { side: g.side, ownGoal: !!g.ownGoal, score: { home: g.score[0], away: g.score[1] } },
      source: src(m.id),
    });
  for (const [k, [h, a]] of Object.entries(m.stats))
    f.push({
      id: `match:${m.id}:stat:${k}`,
      kind: "stat",
      statement: k,
      value: { home: h, away: a },
      source: src(m.id),
    });
  return f;
}

function standing(
  round: number,
  t: { id: string; name: string },
  p: number,
  pts: number,
  w: number,
  d: number,
  l: number,
): Fact {
  return {
    id: `standing:${SEASON}:r${round}:${t.id}`,
    kind: "standing",
    statement: `${t.name} are ${p}`,
    value: {
      team: t,
      afterRound: round,
      teams: 4,
      position: p,
      points: pts,
      played: w + d + l,
      won: w,
      drawn: d,
      lost: l,
    },
    source: { table: "matches", id: `season:${SEASON}` },
  };
}

const R1: M[] = [
  {
    id: "49edc6ae",
    round: 1,
    home: HBC,
    away: RRR,
    score: [0, 4],
    goals: [
      { side: "away", score: [0, 1] },
      { side: "away", score: [0, 2], ownGoal: true },
      { side: "away", score: [0, 3] },
      { side: "away", score: [0, 4] },
    ],
    stats: {
      possession: [0.55, 0.45],
      shots: [0, 5],
      shotsOnTarget: [0, 5],
      passesCompleted: [16, 5],
      tacklesWon: [4, 4],
      interceptions: [15, 10],
      fouls: [3, 6],
      avgTeamHeight: [14.8, 27.9],
    },
  },
  {
    id: "acb2b79d",
    round: 1,
    home: SMA,
    away: NGC,
    score: [1, 0],
    goals: [{ side: "home", score: [1, 0], ownGoal: true }],
    stats: {
      possession: [0.55, 0.45],
      shots: [1, 3],
      shotsOnTarget: [1, 3],
      passesCompleted: [11, 6],
      tacklesWon: [3, 7],
      interceptions: [10, 8],
      fouls: [1, 3],
      avgTeamHeight: [12.9, 11.2],
    },
  },
];

const round1: EditorialFacts = {
  contract: "editorial-facts/1",
  seasonId: SEASON,
  matchId: null,
  generatedFrom: { resultFinalHash: null, standingsAfterRound: 1 },
  match: null,
  facts: [
    ...R1.flatMap(matchFactsOf),
    standing(1, RRR, 1, 3, 1, 0, 0),
    standing(1, SMA, 2, 3, 1, 0, 0),
    standing(1, NGC, 3, 0, 0, 0, 1),
    standing(1, HBC, 4, 0, 0, 0, 1),
  ],
};

const errs = (text: string, facts = round1) => checkClaims(text, facts);

/** The published round-1 analysis (status: published 11 Nov), verbatim. */
const REVIEWED: ArticleDraft = {
  headline: "Red Rock Rovers turn a 27.9-metre average height into five shots and a 0–4 win",
  standfirst:
    "In round 1, the side with less of the ball won both matches, and Red Rock Rovers' high, direct setup offers the clearest lesson in why possession alone did not produce shots.",
  body: [
    "The most instructive contrast of round 1 came at Harbour City. The hosts had 55% possession and completed 16 passes to Red Rock Rovers' 5, yet they finished with 0 shots and lost 0–4. Red Rock Rovers had less of the ball but took 5 shots, and all 5 were on target.",
    "Saltmarsh Athletic against Northgate Comets reinforces the point that the possession share did not decide the result. Saltmarsh had 55% of the ball but only 1 shot. Northgate, sitting in a deep, narrow 2-1-1 with a low press and direct tempo, put 3 shots on target and won 7 tackles to Saltmarsh's 3. The match was settled by an own goal 0:12 into the second half, giving Saltmarsh a 1–0 win.",
    "The table after one round has Red Rock Rovers first on 3 points with a goal difference of +4. Saltmarsh Athletic are second on 3 points at +1, Northgate Comets third at -1, and Harbour City fourth at -4.",
  ].join("\n\n"),
  citations: [
    { factId: "match:49edc6ae:stat:possession", text: "Harbour City had 55% possession" },
    { factId: "match:49edc6ae:stat:shots", text: "0 shots for Harbour City, 5 for Red Rock Rovers" },
    { factId: "match:49edc6ae:score", text: "lost 0–4" },
    { factId: "match:acb2b79d:stat:possession", text: "Saltmarsh had 55% of the ball" },
    { factId: "match:acb2b79d:stat:shots", text: "Saltmarsh had only 1 shot" },
    { factId: "standing:00000000-0000-4000-8000-000000000001:r1:t-rrr", text: "Red Rock Rovers first on 3 points" },
  ],
};

describe("the reviewed round-1 analysis (regression)", () => {
  it("every citation in it exists — the old checks alone would publish it", () => {
    const ids = new Set(round1.facts.map((f) => f.id));
    expect(REVIEWED.citations.every((c) => ids.has(c.factId))).toBe(true);
  });

  it("is rejected for the false possession inference, citing the contradicting record", () => {
    const e = checkGrounding(REVIEWED, round1);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/the side with less possession did not win in: Saltmarsh Athletic 1–0 Northgate Comets/);
    expect(e[0]).toMatch(/match:acb2b79d:stat:possession/);
  });

  it("the corrected standfirst passes", () => {
    const fixed = {
      ...REVIEWED,
      standfirst:
        "In round 1, the side with less of the ball won one of the two matches, and Red Rock Rovers' high, direct setup shows why possession alone did not produce shots.",
    };
    expect(checkGrounding(fixed, round1)).toEqual([]);
  });
});

describe("cross-fact contradictions where each cited source exists", () => {
  const rejects: Array<[string, RegExp]> = [
    // winner / loser
    ["Harbour City beat Red Rock Rovers at home.", /says Harbour City beat Red Rock Rovers.*0–4/],
    ["Northgate Comets defeated Saltmarsh Athletic.", /official result is Saltmarsh Athletic 1–0/],
    ["Red Rock Rovers lost to Harbour City.", /says Red Rock Rovers lost to Harbour City/],
    ["Saltmarsh drew with Northgate.", /drew with/],
    ["Harbour City won 0–4.", /says Harbour City won/],
    ["Northgate Comets opened the scoring.", /opened the scoring/],
    // possession / stat comparisons
    ["Red Rock Rovers had more of the ball.", /possession: Harbour City 55%, Red Rock Rovers 45%/],
    ["Northgate Comets had 55% possession.", /possession: Saltmarsh Athletic 55%, Northgate Comets 45%/],
    ["Harbour City had 3 shots and Red Rock Rovers committed 6 fouls.", /official shots: Harbour City 0/],
    ["Red Rock Rovers had less of the ball but took 7 shots.", /official shots/],
    // aggregates across several fixtures
    ["The side with more possession won both matches.", /more possession did not win in: Harbour City 0–4/],
    ["Both matches were won by the home side.", /home side did not win in: Harbour City 0–4/],
    ["The team with fewer shots lost every game.", /fewer shots did not lose in: Saltmarsh Athletic 1–0/],
    ["The higher-possession side won neither match.", /more possession did win in: Saltmarsh/],
    ["All three matches were won by the visitors.", /away side did not win/],
    // comparisons spanning two matches
    ["Both winners had less of the ball.", /winners in: Saltmarsh Athletic 1–0/],
    ["Each beaten side had more shots than the winner.", /beaten sides in: Harbour City 0–4/],
    // table position, points and record (snapshot after round 1)
    ["Saltmarsh Athletic are top of the table.", /Saltmarsh Athletic are 2nd/],
    ["Harbour City sit third.", /Harbour City are 4th/],
    ["Northgate Comets are bottom.", /Northgate Comets are 3rd/],
    ["Red Rock Rovers lead the table on 6 points.", /have 3 points/],
    ["Harbour City remain unbeaten.", /W0 D0 L1/],
    // chronology / historical snapshot
    ["In round 2, Red Rock Rovers beat Saltmarsh Athletic.", /describes round 2/],
    ["After two rounds, Red Rock Rovers are first.", /snapshot is after round 1, not 2/],
    // unverifiable: a recognised claim the record can't resolve
    [
      "Harbour City beat Northgate Comets.",
      /cannot verify.*no official result between Harbour City and Northgate Comets/,
    ],
  ];
  for (const [text, re] of rejects)
    it(`rejects: ${text}`, () => {
      expect(errs(text).join("\n")).toMatch(re);
    });
});

describe("valid grounded analysis passes", () => {
  const accepts = [
    "Red Rock Rovers beat Harbour City 0–4 away from home.",
    "Saltmarsh Athletic edged Northgate Comets 1–0.",
    "Harbour City lost to Red Rock Rovers.",
    "Red Rock Rovers opened the scoring 0:29 into the first half.",
    "Harbour City had 55% possession and completed 16 passes to Red Rock Rovers' 5, yet lost 0–4.",
    "Red Rock Rovers had less of the ball but took 5 shots, and all 5 were on target.",
    "Saltmarsh had 55% of the ball but only 1 shot.",
    "The side with more possession won one of the two matches; the home side won one too.",
    "The side with fewer shots won one match and lost the other.",
    "Only one of the two winners had more of the ball.",
    "Red Rock Rovers are top of the table on 3 points with a perfect record.",
    "Saltmarsh Athletic are second on 3 points; Harbour City are bottom.",
    "Northgate Comets are without a win, but Harbour City face Saltmarsh in round 2.",
    "After one round, Red Rock Rovers lead the table.",
    "Northgate won 7 tackles to Saltmarsh's 3.",
    // formation notation is not a score (hyphens, or a three-part shape with dashes)
    "Harbour City lined up in a 2-1-1; Red Rock Rovers in a 1-1-2 formation.",
    "Northgate sat deep in a 2–1–1 and still lost.",
    // opinion is fine when it doesn't assert a contradicting fact
    "For my money, Red Rock Rovers' high line is the most interesting idea in the league.",
  ];
  for (const text of accepts)
    it(`accepts: ${text}`, () => {
      expect(errs(text)).toEqual([]);
    });
});

describe("formation notation mistaken for a score", () => {
  const base: ArticleDraft = {
    headline: "Round 1 in shapes",
    standfirst: "Two shapes, two results.",
    body: "x",
    citations: [{ factId: "match:49edc6ae:score", text: "0–4" }],
  };
  it("an en-dash pair is always read as a score", () => {
    expect(checkGrounding({ ...base, body: "Harbour City's 2–1 setup failed." }, round1).join()).toMatch(
      /2–1 is not an official score/,
    );
  });
  it("a hyphenated pair used as a result is read as a score", () => {
    expect(checkGrounding({ ...base, body: "Saltmarsh won 2-1." }, round1).join()).toMatch(
      /2–1 is not an official score/,
    );
  });
  it("three-part shapes and labelled two-part formations pass", () => {
    expect(checkGrounding({ ...base, body: "A 2–1–1 against a 1-1-2, and a 3-1 formation." }, round1)).toEqual([]);
  });
});

describe("citation text is checked against the record too", () => {
  it("a citation whose own text contradicts its fact is rejected", () => {
    const d: ArticleDraft = {
      headline: "Round 1",
      standfirst: "Two results.",
      body: "Red Rock Rovers won 0–4 at Harbour City.",
      citations: [{ factId: "match:49edc6ae:stat:possession", text: "Red Rock Rovers had 55% possession" }],
    };
    expect(checkGrounding(d, round1).join()).toMatch(/citation match:49edc6ae:stat:possession: contradiction/);
  });
});

describe("ledger", () => {
  it("builds results, stats and the table snapshot from structured fact values", () => {
    const l = buildLedger(round1);
    expect(l.matches).toHaveLength(2);
    expect(l.matches[1]!.stats.possession).toMatchObject({ home: 0.55, away: 0.45 });
    expect(l.standings.map((s) => [s.name, s.position])).toEqual([
      ["Red Rock Rovers", 1],
      ["Saltmarsh Athletic", 2],
      ["Northgate Comets", 3],
      ["Harbour City", 4],
    ]);
    expect(l.afterRound).toBe(1);
  });
  it("splits sentences without breaking decimals or clocks", () => {
    expect(sentences("Height 27.9 metres. Goal at 1:28. Next round awaits!")).toEqual([
      "Height 27.9 metres.",
      "Goal at 1:28.",
      "Next round awaits!",
    ]);
  });
});

describe("record claims over a recent run use form, not the season record", () => {
  // Season 2, after round 5: Saltmarsh W3 D1 L1 with form W L D W W; Northgate W1 D2 L2 with form D W D L L.
  const withForm = (f: Fact, form: string): Fact => ({
    ...f,
    value: { ...(f.value as Record<string, unknown>), form: form.split("") },
  });
  const after5: EditorialFacts = {
    ...round1,
    generatedFrom: { resultFinalHash: null, standingsAfterRound: 5 },
    facts: [withForm(standing(5, SMA, 1, 10, 3, 1, 1), "WLDWW"), withForm(standing(5, NGC, 2, 5, 1, 2, 2), "DWDLL")],
  };
  it.each([
    "Saltmarsh are unbeaten in their last two league games.",
    "Saltmarsh Athletic are unbeaten in their last three.",
    "Northgate Comets are without a win in their last two.",
    "Saltmarsh are unbeaten in three.",
    "Northgate Comets have gone two games without a win.",
  ])("accepts a true run: %s", (text) => {
    expect(errs(text, after5)).toEqual([]);
  });
  it.each([
    ["Saltmarsh Athletic are unbeaten in their last four games.", /last 4 results after round 5: LDWW/],
    ["Northgate Comets are without a win in their last four.", /last 4 results after round 5: WDLL/],
    ["Saltmarsh Athletic are unbeaten this season.", /W3 D1 L1/],
    ["Saltmarsh are unbeaten in four.", /last 4 results after round 5: LDWW/],
  ])("rejects a false run: %s", (text, re) => {
    expect(errs(text, after5).join("\n")).toMatch(re);
  });
});
