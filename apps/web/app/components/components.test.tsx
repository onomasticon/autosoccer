// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockArticles, mockFixtures, mockJournalists, mockStandings, mockTeams } from "../lib/mocks";
import { tickerFixtures } from "../lib/ticker";
import { AgentProfileCard, VoicesStrip } from "./AgentProfileCard";
import { ArticleCard } from "./ArticleCard";
import { LeadStory } from "./LeadStory";
import { LeagueHeader } from "./LeagueHeader";
import { FixtureCard, FixtureRow, MatchScoreCard } from "./MatchScoreCard";
import { ScoreTicker } from "./ScoreTicker";
import { Panel } from "./SectionHeader";
import { StandingsTable } from "./StandingsTable";
import { TeamBadge } from "./TeamBadge";

afterEach(cleanup);

/** Renders inside a router (components use Link/NavLink). */
function inRouter(ui: React.ReactNode, path = "/") {
  const Stub = createRoutesStub([{ path: "*", Component: () => <>{ui}</> }]);
  return render(<Stub initialEntries={[path]} />);
}

async function expectNoAxeViolations(container: HTMLElement) {
  // colour contrast needs real layout; it's checked in the browser by `bun run ui:check`.
  const r = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

describe("TeamBadge", () => {
  it("is a labelled image, or hidden when decorative", () => {
    const { container } = render(
      <>
        <TeamBadge team={mockTeams[0]!} />
        <TeamBadge team={mockTeams[1]!} decorative />
      </>,
    );
    expect(screen.getByRole("img", { name: "Harbour City crest" })).toBeTruthy();
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(1);
  });
  it("picks a readable glyph colour for the team colour", () => {
    const { container } = render(<TeamBadge team={mockTeams[3]!} />); // amber → ink glyph
    expect(container.querySelector("text")?.getAttribute("fill")).toBe("#20203B");
  });
});

describe("StandingsTable", () => {
  it("renders an accessible table in order with leader and form text cues", async () => {
    const { container } = inRouter(<StandingsTable rows={mockStandings} caption="League table" />);
    const table = screen.getByRole("table", { name: "League table" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("link").querySelector("span.truncate")?.textContent)).toEqual([
      "Harbour City",
      "Northgate Comets",
      "Saltmarsh Athletic",
      "Red Rock Rovers",
    ]);
    expect(within(rows[0]!).getByText("(leader)")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Last 1: won" })).toBeTruthy();
    expect(within(rows[3]!).getByText("-1")).toBeTruthy();
    await expectNoAxeViolations(container);
  });
  it("has loading and empty states", () => {
    inRouter(<StandingsTable rows={null} caption="x" loading />);
    expect(screen.getByRole("status").textContent).toContain("Loading table");
    cleanup();
    inRouter(<StandingsTable rows={[]} caption="x" />);
    expect(screen.getByText("No table yet")).toBeTruthy();
  });
});

describe("ScoreTicker", () => {
  it("lists fixtures with scores and status text, linking results to the match centre", async () => {
    const { container } = inRouter(<ScoreTicker fixtures={mockFixtures} matchweek={2} />);
    const items = within(screen.getByTestId("score-ticker")).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Round 1: Harbour City 2, Red Rock Rovers 1" }).getAttribute("href")).toBe(
      `/matches/${mockFixtures[0]!.matchId}`,
    );
    expect(screen.getAllByText("(In play)")).toHaveLength(1);
    await expectNoAxeViolations(container);
  });
  it("shows empty and loading states", () => {
    inRouter(<ScoreTicker fixtures={[]} />);
    expect(screen.getByText("No fixtures scheduled yet.")).toBeTruthy();
    cleanup();
    inRouter(<ScoreTicker fixtures={null} loading />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
  it("shows the next fixture after the matchweek", () => {
    inRouter(<ScoreTicker fixtures={mockFixtures.slice(0, 2)} matchweek={1} next={mockFixtures[4]!} />);
    expect(screen.getByText("MATCHWEEK", { exact: false })).toBeTruthy();
    const next = screen.getByTestId("ticker-next");
    expect(next.textContent).toContain("Saltmarsh Athletic versus Harbour City");
    expect(next.querySelector("time")?.getAttribute("datetime")).toBe(mockFixtures[4]!.scheduledAt);
  });
  it("picks the matchweek: the round in progress, else the latest round with results", () => {
    const rounds = [1, 2, 3].map((round) => ({ round, fixtures: mockFixtures.filter((f) => f.round === round) }));
    const t = tickerFixtures(rounds);
    expect(t.matchweek).toBe(2);
    expect(t.fixtures.map((f) => f.round)).toEqual([2, 2]);
    expect(t.next?.id).toBe(mockFixtures[4]!.id);
    const afterRound1 = rounds.map((r) => ({
      ...r,
      fixtures: r.fixtures.map((f) => (r.round > 1 ? { ...f, status: "scheduled" as const } : f)),
    }));
    expect(tickerFixtures(afterRound1)).toMatchObject({ matchweek: 1, next: { round: 2 } });
    const done = rounds.map((r) => ({
      ...r,
      fixtures: r.fixtures.map((f) => ({ ...f, status: "completed" as const })),
    }));
    expect(tickerFixtures(done)).toMatchObject({ matchweek: 3, next: null });
    expect(tickerFixtures([])).toEqual({ matchweek: null, fixtures: [], next: null });
  });
});

describe("match cards", () => {
  it("announce the score and link to the match centre; upcoming fixtures are not links", async () => {
    const { container } = inRouter(
      <>
        <MatchScoreCard fixture={mockFixtures[0]!} />
        <FixtureCard fixture={mockFixtures[4]!} />
      </>,
    );
    expect(screen.getByRole("link", { name: /Harbour City 2, Red Rock Rovers 1, round 1/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Saltmarsh Athletic versus Harbour City" })).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});

describe("editorial components", () => {
  it("disclose AI authorship on article cards and agent profiles", async () => {
    const { container } = inRouter(
      <>
        <ArticleCard article={mockArticles[0]!} variant="lead" />
        <AgentProfileCard agent={{ ...mockJournalists[1]!, href: "/journalists/otto-brandt" }} />
      </>,
    );
    expect(screen.getAllByText("AI-generated").length).toBe(2);
    expect(screen.getByRole("link", { name: "Harbour City edge Red Rock Rovers 2–1" }).getAttribute("href")).toBe(
      "/news/harbour-city-edge-red-rock-rovers",
    );
    expect(screen.getByRole("link", { name: "Nia Park" }).getAttribute("href")).toBe("/journalists/nia-park");
    await expectNoAxeViolations(container);
  });
});

describe("LeagueHeader", () => {
  it("marks the current page and toggles the mobile menu with the keyboard", async () => {
    const user = userEvent.setup();
    const { container } = inRouter(<LeagueHeader />, "/table");
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(within(main).getByRole("link", { name: "Table" }).getAttribute("aria-current")).toBe("page");
    expect(
      within(main)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Home", "News", "Matches", "Table", "Teams", "Personalities"]);
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main");
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.focus();
    await user.keyboard("{Enter}");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("navigation", { name: "Site menu" }).hidden).toBe(false);
    await user.keyboard("{Escape}");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await expectNoAxeViolations(container);
  });
});

describe("mockup homepage components", () => {
  it("LeadStory: kind tab, linked headline, disclosed AI byline and decorative crests", async () => {
    const article = { ...mockArticles[0]!, teamIds: [mockTeams[0]!.id, mockTeams[1]!.id] };
    const { container } = inRouter(<LeadStory article={article} teams={mockTeams} />);
    expect(screen.getByRole("heading", { level: 2, name: article.headline })).toBeTruthy();
    expect(screen.getByText("AI-generated")).toBeTruthy();
    // crests in the hero art are decorative: no extra images announced
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    await expectNoAxeViolations(container);
  });
  it("Panel + FixtureRow: tab heading labels the panel; rows announce full team names", async () => {
    const { container } = inRouter(
      <Panel id="up" title="Upcoming matches" action={{ to: "/fixtures", label: "Full schedule" }}>
        <ul>
          <FixtureRow fixture={mockFixtures[0]!} />
          <FixtureRow fixture={mockFixtures[4]!} />
        </ul>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "Upcoming matches" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Matchweek 1: Harbour City 2, Red Rock Rovers 1/ })).toBeTruthy();
    const upcoming = screen.getByRole("group", { name: "Matchweek 3: Saltmarsh Athletic versus Harbour City" });
    expect(upcoming.textContent).toContain("MW03");
    expect(upcoming.querySelector("time")?.textContent).toBe("Mon 12:00");
    await expectNoAxeViolations(container);
  });
  it("VoicesStrip lists every journalist with a portrait, role and AI disclosure", async () => {
    const { container } = inRouter(
      <VoicesStrip agents={mockJournalists.map((j) => ({ ...j, href: `/journalists/${j.slug}` }))} />,
    );
    expect(screen.getByRole("heading", { name: "Voices around the league" })).toBeTruthy();
    expect(screen.getAllByTestId("portrait")).toHaveLength(mockJournalists.length);
    expect(screen.getAllByText("AI-generated")).toHaveLength(mockJournalists.length);
    await expectNoAxeViolations(container);
  });
  it("LeagueHeader treats a match centre as part of Matches", () => {
    inRouter(<LeagueHeader />, "/matches/abc");
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(within(main).getByRole("link", { name: "Matches" }).getAttribute("aria-current")).toBe("page");
    expect(within(main).getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });
});
