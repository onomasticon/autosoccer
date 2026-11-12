// @vitest-environment jsdom
import type { DugoutChapter, ManagerStory, SharedResult } from "@autosoccer/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { DugoutTimeline, firstSentence, InsideTheDugout } from "./Dugout";

afterEach(cleanup);

const inRouter = (ui: React.ReactNode) => {
  const Stub = createRoutesStub([{ path: "*", Component: () => <>{ui}</> }]);
  return render(<Stub initialEntries={["/"]} />);
};
const noAxe = async (el: HTMLElement) => {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
};

const [A, B, C, D] = mockTeams;
const tactics = {
  formation: "2-1-1",
  lineHeight: "mid",
  width: "balanced",
  pressing: "mid",
  tempo: "balanced",
  passingRisk: "balanced",
  shooting: "balanced",
  dribbling: "sometimes",
  keeperDistribution: "short",
} as const;

const chapter = (over: Partial<DugoutChapter> & Pick<DugoutChapter, "venue" | "opponent">): DugoutChapter => ({
  fixtureId: "00000000-0000-4000-8000-0000000000f1",
  round: 1,
  scheduledAt: "2026-11-14T19:00:00.000Z",
  status: "completed",
  decision: {
    status: "new",
    revisionVersion: 2,
    tactics,
    summary: "2-1-1 formation, mid line",
    changes: [{ field: "pressing", label: "Pressing", from: "low", to: "mid" }],
    lineupIn: [],
    lineupOut: [],
    rationale: "Pressing higher to win the ball earlier.",
    decidedAt: null,
  },
  result: {
    matchId: "00000000-0000-4000-8000-0000000000aa",
    goalsFor: 0,
    goalsAgainst: 4,
    outcome: "L",
    possession: 0.55,
    shots: 0,
    shotsAgainst: 5,
  },
  reflection: { status: "reviewed", lesson: "We sat too deep; push the line up.", summary: null, reviewedAt: null },
  ...over,
});

const story = (team: (typeof mockTeams)[number], chapters: DugoutChapter[], seasonComplete = false): ManagerStory => ({
  team,
  manager: { slug: `${team.slug}-mgr`, name: `${team.name} Manager`, philosophy: "x" },
  chapters,
  seasonComplete,
});

describe("InsideTheDugout", () => {
  it("shows two managers' different readings of one result, labelled by provenance, linking to details", async () => {
    const home = chapter({ venue: "home", opponent: B! });
    const away = chapter({
      venue: "away",
      opponent: A!,
      result: {
        ...home.result!,
        goalsFor: 4,
        goalsAgainst: 0,
        outcome: "W",
        possession: 0.45,
        shots: 5,
        shotsAgainst: 0,
      },
      reflection: { status: "reviewed", lesson: "This setup works; keep it.", summary: null, reviewedAt: null },
    });
    const featured: SharedResult = {
      matchId: home.result!.matchId,
      fixtureId: home.fixtureId,
      round: 1,
      home: { team: A!, score: 0 },
      away: { team: B!, score: 4 },
      sides: { home, away },
    };
    const next = chapter({
      venue: "home",
      opponent: C!,
      status: "upcoming",
      round: 2,
      result: null,
      reflection: null,
      decision: { ...home.decision, status: "pending", rationale: null, changes: [] },
    });
    const { container } = inRouter(
      <InsideTheDugout
        featured={featured}
        stories={[story(A!, [home, next]), story(B!, [away]), story(C!, []), story(D!, [])]}
      />,
    );
    const columns = screen.getAllByRole("article");
    expect(columns).toHaveLength(2);
    expect(within(columns[0]!).getByText("We sat too deep; push the line up.")).toBeTruthy();
    expect(within(columns[1]!).getByText("This setup works; keep it.")).toBeTruthy();
    expect(within(columns[0]!).getAllByText("Manager's view").length).toBeGreaterThan(0);
    expect(within(columns[0]!).getByText("Decision")).toBeTruthy();
    expect(within(columns[0]!).getByText("Record")).toBeTruthy();
    expect(
      within(columns[0]!)
        .getByRole("link", { name: /Match centre/ })
        .getAttribute("href"),
    ).toBe(`/matches/${home.result!.matchId}`);
    expect(within(columns[0]!).getByText(/R2 vs/)).toBeTruthy();
    expect(screen.getByText("Around the other dugouts")).toBeTruthy();
    await noAxe(container);
  });

  it("before the first match: an honest empty state", () => {
    inRouter(<InsideTheDugout featured={null} stories={[]} />);
    expect(screen.getByText(/No matches yet/)).toBeTruthy();
  });
});

describe("DugoutTimeline", () => {
  it("states budget skips and missing reviews plainly, never inventing a rationale", async () => {
    const skipped = chapter({
      venue: "away",
      opponent: B!,
      round: 2,
      decision: {
        ...chapter({ venue: "away", opponent: B! }).decision,
        status: "skipped_budget",
        rationale: null,
        changes: [],
      },
      reflection: { status: "failed", lesson: null, summary: null, reviewedAt: null },
    });
    const { container } = inRouter(
      <DugoutTimeline story={story(A!, [chapter({ venue: "home", opponent: C! }), skipped], true)} />,
    );
    expect(screen.getByText(/No decision: compute budget spent/)).toBeTruthy();
    expect(screen.getByText(/No reasoning on record/)).toBeTruthy();
    expect(screen.getByText(/review didn't complete/)).toBeTruthy();
    expect(screen.getByText("Season complete.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Changes from the previous match" }).textContent).toMatch(/Pressing/);
    await noAxe(container);
  });
});

describe("long reasoning", () => {
  it("leads with the first sentence and keeps decimals intact", () => {
    expect(firstSentence("Our 0–3 loss at 1.2 m height hurt. So we push up. Again.")).toBe(
      "Our 0–3 loss at 1.2 m height hurt.",
    );
    expect(firstSentence("Single sentence without a stop")).toBe("Single sentence without a stop");
  });
});
