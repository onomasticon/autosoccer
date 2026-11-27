// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockArticles, mockFixtures } from "../lib/mocks";
import { HEADLINE_PRIORITY, pickStories } from "../routes/home";
import { ArticleCard } from "./ArticleCard";
import { ScoreTicker } from "./ScoreTicker";

afterEach(cleanup);

function inRouter(ui: React.ReactNode) {
  const Stub = createRoutesStub([{ path: "*", Component: () => <>{ui}</> }]);
  return render(<Stub initialEntries={["/"]} />);
}

const article = (
  n: number,
  kind: "match_report" | "preview" | "news",
  priority: number,
  matchId: string | null = null,
) => ({
  ...mockArticles[0]!,
  id: `00000000-0000-4000-8000-00000000090${n}`,
  slug: `story-${n}`,
  kind,
  priority,
  matchId,
});

describe("news", () => {
  it("the matchweek bar names the season", async () => {
    const { container } = inRouter(<ScoreTicker fixtures={mockFixtures} matchweek={1} season="Season 16" />);
    expect(screen.getByTestId("ticker-season").textContent).toContain("S16"); // "Season 16" for screen readers
    expect(screen.getByRole("list", { name: "Season 16, Matchweek 1 fixtures" })).toBeTruthy();
    expect((await axe.run(container)).violations.map((v) => v.id)).toEqual([]);
  });

  it("the homepage leads with the biggest story: a champion beats the latest report", () => {
    const champions = article(1, "news", 100);
    const report = article(2, "match_report", 45, "m1");
    const preview = article(3, "preview", 35);
    const picked = pickStories([champions, report, preview], "m1", false);
    expect(picked.headline).toBe(champions);
    expect(picked.lead).toBe(champions);
    expect(picked.stories).toEqual([report, preview]);
    // No big story: the report on the featured match leads, as before.
    const quiet = pickStories([preview, report], "m1", false);
    expect(quiet.headline).toBeNull();
    expect(quiet.lead).toBe(report);
    expect(HEADLINE_PRIORITY).toBeLessThanOrEqual(75);
    // Between seasons the champions card is the headline; stories stay in priority order.
    expect(pickStories([champions, report], null, true).headline).toBeNull();
  });

  it("league news is labelled as such and credited to the correspondent", async () => {
    const news = {
      ...article(4, "news", 95),
      topic: "withdrawal" as const,
      headline: "Northgate Comets declared bankrupt",
      author: { ...mockArticles[0]!.author, role: "correspondent" as const, name: "Lena Hart" },
    };
    const { container } = inRouter(<ArticleCard article={news} />);
    expect(container.textContent).toContain("League news");
    expect(container.textContent).toContain("League correspondent");
    expect((await axe.run(container)).violations.map((v) => v.id)).toEqual([]);
  });
});
