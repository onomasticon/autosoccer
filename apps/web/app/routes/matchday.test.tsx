// @vitest-environment jsdom
import { type FixtureStory, FixtureStory as FixtureStorySchema, type ManagerProfile } from "@autosoccer/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { featuredFixture, kickoffUtc, managerContrast, watchNote } from "../lib/matchday";
import { mockFixtures, mockTeams } from "../lib/mocks";
import Matchday from "./matchday";

afterEach(cleanup);

const [A, B] = mockTeams as [NonNullable<(typeof mockTeams)[0]>, NonNullable<(typeof mockTeams)[1]>];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const side = (team: typeof A, over: Partial<FixtureStory["home"]> = {}): FixtureStory["home"] => ({
  team,
  manager: { slug: `coach-${team.slug}`, name: `Coach ${team.shortName}` },
  before: { afterRound: 2, position: 2, points: 4, played: 2 },
  after: null,
  decision: {
    status: "pending",
    revisionVersion: null,
    tactics: null,
    summary: "To be decided before kick-off",
    changes: [],
    lineupIn: [],
    lineupOut: [],
    rationale: null,
    decidedAt: null,
  },
  reflection: null,
  next: null,
  ...over,
});
const upcoming: FixtureStory = FixtureStorySchema.parse({
  contract: "fixture-story/1",
  fixtureId: id(1),
  season: { id: id(2), slug: "season-5", name: "Season 5", playersPerTeam: 7, rounds: 6 },
  round: 3,
  scheduledAt: "2026-11-16T06:00:00.000Z",
  timezone: "UTC",
  stage: "scheduled",
  home: side(A),
  away: side(B),
  match: null,
  prematch: {
    asOfRound: 2,
    lines: [
      { kind: "fixture", source: "record", text: `Round 3 of 6: ${A.name} host ${B.name}.`, factIds: ["f"] },
      {
        kind: "stakes",
        source: "record",
        text: "Both clubs can still win the title, with 4 rounds left.",
        factIds: ["r"],
      },
    ],
    facts: [],
  },
  postmatch: null,
  articles: { preview: null, report: null },
});
const profile = (team: typeof A, over: Partial<ManagerProfile> = {}): ManagerProfile => ({
  contract: "manager-profile/1",
  team,
  manager: { slug: "c", name: `Coach ${team.shortName}`, philosophy: "x" },
  seasons: [{ slug: "season-5", name: "Season 5" }],
  verdict: "profiled",
  counts: {
    matches: 6,
    decisions: 5,
    changed: 4,
    formationChanges: 2,
    opening: 1,
    skippedBudget: 0,
    failedOrRejected: 0,
    record: { W: 2, D: 1, L: 3 },
    afterDefeat: { decisions: 3, changed: 3 },
    afterWinOrDraw: { decisions: 2, changed: 1 },
    lineupTurnover: 0.4,
  },
  traits: [
    {
      key: "reacts_to_defeat",
      label: "Reacts to defeat",
      basis: "Changed the setup after 3 of 3 defeats, against 1 of 2 after a win or draw.",
      evidence: [],
    },
  ],
  notable: [],
  current: { summary: "2-3-1", lesson: null, lessonAt: null, next: null },
  ...over,
});
const page = (loaderData: unknown) => {
  const Stub = createRoutesStub([
    { path: "*", Component: () => <Matchday {...({ loaderData } as unknown as Parameters<typeof Matchday>[0])} /> },
  ]);
  return render(<Stub initialEntries={["/matchday/x"]} />);
};
const noAxe = async (el: HTMLElement) => {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
};

describe("matchday helpers", () => {
  it("features the next unfinished fixture, else the latest result", () => {
    const f = featuredFixture(mockFixtures);
    const open = mockFixtures.filter((x) => x.status !== "completed");
    if (open.length) expect(f!.round).toBe(Math.min(...open.map((x) => x.round)));
    const allDone = mockFixtures.map((x) => ({ ...x, status: "completed" as const }));
    expect(featuredFixture(allDone)).toBe(allDone.at(-1));
    expect(featuredFixture([])).toBeNull();
  });

  it("contrasts managers from recorded patterns only, and says when it's too early", () => {
    const lines = managerContrast(
      profile(A),
      profile(B, { verdict: "too_early", traits: [], counts: { ...profile(B).counts, decisions: 1 } }),
    );
    expect(lines[0]).toBe(
      `Coach ${A.shortName} (${A.name}): reacts to defeat. Changed the setup after 3 of 3 defeats, against 1 of 2 after a win or draw.`,
    );
    expect(lines[1]).toMatch(/too early to read, with 1 decision on record/);
    const early = profile(A, { verdict: "too_early", traits: [] });
    expect(managerContrast(early, early)).toEqual([]);
    expect(managerContrast(null, null)).toEqual([]);
  });

  it("renders kick-off in UTC identically on server and client, and is honest about what's watchable", () => {
    expect(kickoffUtc("2026-11-16T06:00:00.000Z")).toBe("Mon 16 Nov, 06:00 UTC");
    expect(kickoffUtc(null)).toMatch(/to be confirmed/);
    expect(watchNote(upcoming, false)!.body).toMatch(/recorded replay, not live/);
    expect(watchNote({ ...upcoming, stage: "playing" }, false)!.title).toBe("Being simulated now");
    expect(watchNote({ ...upcoming, stage: "completed" }, true)).toBeNull();
    expect(watchNote({ ...upcoming, stage: "completed" }, false)!.title).toBe("Replay unavailable");
  });
});

describe("matchday page", () => {
  it("build-up: stakes, both dugouts' status and the managers' contrast; no replay pretending to be live", async () => {
    const { container } = page({ story: upcoming, detail: null, profiles: { home: profile(A), away: profile(B) } });
    expect(screen.getByTestId("stage").textContent).toBe("Scheduled");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(`${A.name} versus ${B.name}`);
    expect(screen.getByRole("link", { name: "Build-up" }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByText(/Both clubs can still win the title/)).toBeTruthy();
    expect(screen.getAllByText("Decision still to come before kick-off.")).toHaveLength(2);
    expect(screen.getAllByText(/reacts to defeat/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Not played yet")).toBeTruthy();
    expect(screen.queryByTestId("match-viewer")).toBeNull();
    expect(screen.getByText("After full time")).toBeTruthy();
    await noAxe(container);
  });

  it("held up: says so, with no guessed result", () => {
    page({ story: { ...upcoming, stage: "failed" }, detail: null, profiles: { home: null, away: null } });
    expect(screen.getByTestId("stage").textContent).toBe("Held up");
    expect(screen.getByText(/none will be guessed/)).toBeTruthy();
  });

  it("full time, goalless, replay missing: the reaction and the way to each club's next matchday", async () => {
    const next = {
      fixtureId: id(7),
      round: 4,
      venue: "away" as const,
      opponent: B,
      scheduledAt: "2026-11-16T10:00:00.000Z",
    };
    const done: FixtureStory = {
      ...upcoming,
      stage: "completed",
      match: { id: id(9), score: { home: 0, away: 0 } },
      home: side(A, {
        after: { afterRound: 3, position: 2, points: 5, played: 3 },
        next,
        reflection: { status: "reviewed", lesson: "Patience paid.", summary: null, reviewedAt: null },
      }),
      away: side(B, { after: { afterRound: 3, position: 3, points: 5, played: 3 } }),
      postmatch: {
        afterRound: 3,
        facts: [],
        lines: [
          {
            kind: "result",
            source: "record",
            text: `Final score (round 3): ${A.name} 0–0 ${B.name}; a draw.`,
            factIds: ["s"],
          },
          { kind: "goals", source: "record", text: "No goals were scored.", factIds: ["g"] },
        ],
      },
    };
    const { container } = page({ story: done, detail: null, profiles: { home: null, away: null } });
    expect(screen.getByTestId("stage").textContent).toBe("Full time");
    expect(screen.getByText("As it stood before kick-off")).toBeTruthy();
    expect(screen.getByText("Replay unavailable")).toBeTruthy();
    const reaction = screen.getByTestId("story-after");
    expect(within(reaction).getByText("No goals were scored.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Next matchday/ }).getAttribute("href")).toBe(`/matchday/${id(7)}`);
    expect(screen.getByText(/season complete/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Match centre/ }).getAttribute("href")).toBe(`/matches/${id(9)}`);
    await noAxe(container);
  });
});
