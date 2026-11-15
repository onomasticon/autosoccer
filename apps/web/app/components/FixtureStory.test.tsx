// @vitest-environment jsdom
import { type FixtureStory, FixtureStory as FixtureStorySchema } from "@autosoccer/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { StoryCard } from "./FixtureStory";

afterEach(cleanup);

const inRouter = (ui: React.ReactNode) => {
  const Stub = createRoutesStub([{ path: "*", Component: () => <>{ui}</> }]);
  return render(<Stub initialEntries={["/"]} />);
};
const noAxe = async (el: HTMLElement) => {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
};

const [A, B] = mockTeams as [NonNullable<(typeof mockTeams)[0]>, NonNullable<(typeof mockTeams)[1]>];
const side = (team: typeof A) => ({
  team,
  manager: null,
  before: { afterRound: 2, position: 1, points: 6, played: 2 },
  after: null,
  decision: null,
  reflection: null,
  next: null,
});
const base: FixtureStory = {
  contract: "fixture-story/1",
  fixtureId: "00000000-0000-4000-8000-000000000001",
  season: {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "season-5",
    name: "Season 5",
    playersPerTeam: 7,
    rounds: 6,
  },
  round: 3,
  scheduledAt: "2026-11-16T12:00:00.000Z",
  timezone: "UTC",
  stage: "scheduled",
  home: side(A),
  away: side(B),
  match: null,
  prematch: {
    asOfRound: 2,
    lines: [
      { kind: "fixture", source: "record", text: `Round 3 of 6: ${A.name} host ${B.name}.`, factIds: ["fixture:x"] },
      { kind: "table", source: "record", text: `After round 2, ${A.name} are 1st on 6 points.`, factIds: ["s:1"] },
      {
        kind: "stakes",
        source: "record",
        text: "Both clubs can still win the title, with 4 rounds left.",
        factIds: ["r"],
      },
      { kind: "form", source: "record", text: `${A.name} have won their last 2 league matches.`, factIds: ["f"] },
    ],
    facts: [],
  },
  postmatch: null,
  articles: { preview: { slug: "preview-a-v-b", kind: "preview", headline: "Preview: A v B" }, report: null },
};

describe("StoryCard", () => {
  it("before kickoff: says what was on record then, links the preview, and can be compact", async () => {
    expect(FixtureStorySchema.safeParse(base).success).toBe(true);
    const { container } = inRouter(<StoryCard story={base} mode="before" headingId="why" />);
    const card = screen.getByTestId("story-before");
    expect(within(card).getByRole("heading", { name: "Why it matters" })).toBeTruthy();
    expect(card.textContent).toContain("after round 2");
    expect(within(card).getAllByRole("listitem")).toHaveLength(3); // the fixture line is the header's job
    expect(
      within(card)
        .getByRole("link", { name: /Preview: A v B/ })
        .getAttribute("href"),
    ).toBe("/news/preview-a-v-b");
    await noAxe(container);
    cleanup();
    inRouter(<StoryCard story={base} mode="before" headingId="why" max={2} />);
    expect(within(screen.getByTestId("story-before")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("in round 1 there's no table: it says so rather than inventing stakes", () => {
    const r1 = {
      ...base,
      round: 1,
      prematch: { asOfRound: 0, lines: [base.prematch.lines[0]!], facts: [] },
      articles: { preview: null, report: null },
    };
    inRouter(<StoryCard story={r1} mode="before" headingId="why" />);
    const card = screen.getByTestId("story-before");
    expect(card.textContent).toContain("no table or form yet");
    expect(within(card).getAllByRole("listitem")).toHaveLength(1);
  });

  it("after full time: the record, then each manager's view clearly labelled as AI-written", async () => {
    const done: FixtureStory = {
      ...base,
      stage: "completed",
      match: { id: "00000000-0000-4000-8000-000000000003", score: { home: 0, away: 0 } },
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
          { kind: "result", source: "interpretation", text: "Coach A took this lesson: press higher.", factIds: [] },
        ],
      },
      articles: {
        preview: null,
        report: { slug: "a-0-0-b", kind: "match_report", headline: "A and B share the points" },
      },
    };
    const { container } = inRouter(<StoryCard story={done} mode="after" headingId="changed" />);
    const card = screen.getByTestId("story-after");
    expect(within(card).getByRole("heading", { name: "What changed" })).toBeTruthy();
    expect(card.textContent).toContain("No goals were scored.");
    expect(card.textContent).not.toMatch(/decisive|winner/i);
    const opinion = within(card)
      .getByText(/press higher/)
      .closest("li")!;
    expect(opinion.textContent).toContain("Manager's view");
    expect(opinion.textContent).toContain("not fact-checked");
    expect(
      within(card)
        .getByRole("link", { name: /Match report/ })
        .getAttribute("href"),
    ).toBe("/news/a-0-0-b");
    await noAxe(container);
  });
});
