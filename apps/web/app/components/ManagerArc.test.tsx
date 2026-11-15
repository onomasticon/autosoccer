// @vitest-environment jsdom
import { ManagerProfile } from "@autosoccer/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { ManagerArc } from "./ManagerArc";

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
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ref = (round: number, outcome: "W" | "D" | "L", f: number, a: number) => ({
  season: { slug: "season-4", name: "Season 4" },
  round,
  fixtureId: id(round),
  matchId: id(100 + round),
  opponent: B,
  venue: "home" as const,
  score: { for: f, against: a },
  outcome,
  revisionVersion: round + 1,
});
const counts = {
  matches: 0,
  decisions: 0,
  changed: 0,
  formationChanges: 0,
  opening: 0,
  skippedBudget: 0,
  failedOrRejected: 0,
  record: { W: 0, D: 0, L: 0 },
  afterDefeat: { decisions: 0, changed: 0 },
  afterWinOrDraw: { decisions: 0, changed: 0 },
  lineupTurnover: 0,
};
const newcomer = ManagerProfile.parse({
  contract: "manager-profile/1",
  team: A,
  manager: { slug: "coach-a", name: "Coach A", philosophy: "x" },
  seasons: [{ slug: "season-5", name: "Season 5" }],
  verdict: "too_early",
  counts: { ...counts, matches: 1, opening: 1, record: { W: 0, D: 1, L: 0 } },
  traits: [],
  notable: [],
  current: {
    summary: "2-3-1 formation, mid line",
    lesson: null,
    lessonAt: null,
    next: { fixtureId: id(9), round: 2, opponent: B, status: "pending" },
  },
});
const veteran = ManagerProfile.parse({
  ...newcomer,
  seasons: [
    { slug: "season-3", name: "Season 3" },
    { slug: "season-4", name: "Season 4" },
  ],
  verdict: "profiled",
  counts: {
    ...counts,
    matches: 12,
    decisions: 10,
    changed: 7,
    formationChanges: 3,
    opening: 1,
    skippedBudget: 1,
    record: { W: 5, D: 3, L: 4 },
    afterDefeat: { decisions: 4, changed: 4 },
    afterWinOrDraw: { decisions: 6, changed: 3 },
  },
  traits: [
    {
      key: "reacts_to_defeat",
      label: "Reacts to defeat",
      basis: "Changed the setup after 4 of 4 defeats, against 3 of 6 after a win or draw.",
      evidence: [ref(3, "W", 2, 0), ref(5, "D", 1, 1)],
    },
  ],
  notable: [
    {
      at: ref(3, "W", 2, 0),
      before: ref(2, "L", 0, 2),
      changes: [{ field: "formation", label: "Formation", from: "2-3-1", to: "3-2-1" }],
      summary: "Formation: 2-3-1 → 3-2-1",
      rationale: "Two defeats in a row; more cover at the back.",
    },
  ],
  current: { ...newcomer.current, lesson: "Width wins us the ball back.", lessonAt: ref(5, "D", 1, 1) },
});

describe("ManagerArc", () => {
  it("a new manager: says it's too early, and why nothing is counted yet", async () => {
    const { container } = inRouter(<ManagerArc profile={newcomer} />);
    const arc = screen.getByTestId("manager-arc");
    expect(within(arc).getByTestId("too-early").textContent).toMatch(/Too early to say: 0 decisions/);
    expect(arc.textContent).toContain("Not counted as decisions: 1 on the pre-season plan");
    expect(arc.textContent).toContain("decision still to come before kick-off");
    expect(arc.textContent).toContain("No post-match review on record yet");
    await noAxe(container);
  });

  it("a veteran: each pattern links the matches behind it, and the manager's words are labelled as theirs", async () => {
    const { container } = inRouter(<ManagerArc profile={veteran} />);
    const arc = screen.getByTestId("manager-arc");
    expect(arc.textContent).toContain("Season 3 to Season 4");
    expect(arc.textContent).toContain("1 with no decision (budget spent)");
    const links = within(arc).getAllByRole("link", { name: /S4 R3 v/ });
    expect(links[0]!.getAttribute("href")).toBe(`/matches/${id(103)}`);
    expect(arc.textContent).toContain("Reacts to defeat");
    expect(arc.textContent).toContain("Coming off S4 R2 v");
    expect(within(arc).getByText(/more cover at the back/).textContent).toContain("Manager's stated reason");
    expect(within(arc).getByText(/Width wins/).textContent).toContain("AI-written, not fact-checked");
    await noAxe(container);
  });
});
