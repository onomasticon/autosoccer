// @vitest-environment jsdom
import type { ArticleCardView, FixtureView, ManagerStory } from "@autosoccer/contracts";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOLLOW_KEY, followClub, parseFollow, readFollowedSlug, unfollowClub } from "../lib/follow";
import { mockArticles, mockFixtures, mockTeams } from "../lib/mocks";
import { FollowButton, YourClub } from "./FollowClub";

const [HBC, RRR] = mockTeams as [(typeof mockTeams)[0], (typeof mockTeams)[0]];
const stubbed = (ui: React.ReactNode) => {
  const Stub = createRoutesStub([{ path: "*", Component: () => <>{ui}</> }]);
  return <Stub initialEntries={["/"]} />;
};
const inRouter = (ui: React.ReactNode) => render(stubbed(ui));
const noAxe = async (el: HTMLElement) => {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
};

const story: ManagerStory = {
  team: RRR,
  manager: { slug: "dex-okoro", name: "Dex Okoro", philosophy: "x" },
  seasonComplete: false,
  chapters: [
    {
      fixtureId: "00000000-0000-4000-8000-0000000000f1",
      round: 1,
      venue: "away",
      opponent: HBC,
      scheduledAt: null,
      status: "completed",
      decision: {
        status: "kept",
        revisionVersion: 2,
        tactics: null,
        summary: "1-1-2 formation, high line",
        changes: [],
        lineupIn: [],
        lineupOut: [],
        rationale: null,
        decidedAt: null,
      },
      result: {
        matchId: "00000000-0000-4000-8000-0000000000aa",
        goalsFor: 4,
        goalsAgainst: 0,
        outcome: "W",
        possession: 0.45,
        shots: 5,
        shotsAgainst: 0,
      },
      reflection: { status: "reviewed", lesson: "This setup works.", summary: null, reviewedAt: null },
    },
  ],
};
const fixtures = mockFixtures as FixtureView[];
const articles = mockArticles as unknown as ArticleCardView[];
const yourClub = (over: Partial<Parameters<typeof YourClub>[0]> = {}) => (
  <YourClub teams={mockTeams} fixtures={fixtures} stories={[story]} articles={articles} {...over} />
);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("follow storage", () => {
  it("round-trips one club and ignores corrupt, foreign or stale-format values", () => {
    expect(readFollowedSlug()).toBeNull();
    followClub("red-rock-rovers");
    expect(readFollowedSlug()).toBe("red-rock-rovers");
    expect(parseFollow(localStorage.getItem(FOLLOW_KEY))).toMatchObject({ v: 1, slug: "red-rock-rovers" });
    followClub("harbour-city");
    expect(readFollowedSlug()).toBe("harbour-city"); // one club only
    unfollowClub();
    expect(readFollowedSlug()).toBeNull();
    for (const bad of ["{", "null", '"red-rock-rovers"', '{"v":2,"slug":"x"}', '{"v":1,"slug":"<script>"}']) {
      localStorage.setItem(FOLLOW_KEY, bad);
      expect(readFollowedSlug()).toBeNull();
      expect(localStorage.getItem(FOLLOW_KEY)).toBeNull(); // cleaned up
    }
  });

  it("survives blocked storage", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => followClub("red-rock-rovers")).not.toThrow();
    spy.mockRestore();
  });
});

describe("YourClub", () => {
  it("brand-new visitor: a keyboard-usable picker; following shows the club module, which persists", async () => {
    const user = userEvent.setup();
    const { container, unmount } = inRouter(yourClub());
    expect(screen.getByRole("heading", { name: "Follow a club" })).toBeTruthy();
    await noAxe(container);
    const rrr = screen.getByRole("button", { name: "Red Rock Rovers" });
    expect(rrr.getAttribute("aria-pressed")).toBe("false");
    rrr.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: /Your club: Red Rock Rovers/ })).toBeTruthy();
    expect(screen.getByText("This setup works.")).toBeTruthy();
    expect(screen.getByText("Decision")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Club page/ }).getAttribute("href")).toBe("/teams/red-rock-rovers");
    await noAxe(container);
    // "Reload": a fresh render reads the stored club.
    unmount();
    inRouter(yourClub());
    expect(screen.getByRole("heading", { name: /Your club: Red Rock Rovers/ })).toBeTruthy();
  });

  it("switches clubs and unfollows", async () => {
    const user = userEvent.setup();
    followClub("red-rock-rovers");
    inRouter(yourClub());
    await user.click(screen.getByRole("button", { name: "Change club" }));
    const picker = screen.getByRole("list", { name: "Switch to another club" });
    expect(within(picker).getByRole("button", { name: "Red Rock Rovers" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(picker).getByRole("button", { name: "Harbour City" }));
    expect(screen.getByRole("heading", { name: /Your club: Harbour City/ })).toBeTruthy();
    expect(readFollowedSlug()).toBe("harbour-city");
    await user.click(screen.getByRole("button", { name: "Unfollow" }));
    expect(screen.getByRole("heading", { name: "Follow a club" })).toBeTruthy();
    expect(readFollowedSlug()).toBeNull();
  });

  it("stale state: a followed club that isn't in the season offers a reset", async () => {
    const user = userEvent.setup();
    followClub("old-club");
    inRouter(yourClub());
    expect(screen.getByRole("heading", { name: "Your club isn't in this season" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Stop following" }));
    expect(readFollowedSlug()).toBeNull();
  });

  it("empty fixtures, stories and articles get honest empty states", () => {
    followClub("red-rock-rovers");
    inRouter(yourClub({ fixtures: [], stories: [], articles: [] }));
    expect(screen.getByText("No matches played yet.")).toBeTruthy();
    expect(screen.getByText("No upcoming fixture scheduled.")).toBeTruthy();
    expect(screen.getByText("No recent stories about Red Rock Rovers.")).toBeTruthy();
    cleanup();
    inRouter(yourClub({ stories: null }));
    expect(screen.getByText(/decisions couldn't be loaded/)).toBeTruthy();
  });

  it("follows across tabs (storage event)", () => {
    inRouter(yourClub());
    act(() => {
      localStorage.setItem(FOLLOW_KEY, JSON.stringify({ v: 1, slug: "harbour-city", since: "" }));
      window.dispatchEvent(new StorageEvent("storage", { key: FOLLOW_KEY }));
    });
    expect(screen.getByRole("heading", { name: /Your club: Harbour City/ })).toBeTruthy();
  });

  it("SSR renders nothing personal, and hydration with a stored club has no mismatch", async () => {
    followClub("red-rock-rovers");
    const html = renderToString(stubbed(yourClub()));
    expect(html).not.toContain("Your club");
    expect(html).not.toContain("Follow a club");
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a));
    const el = document.createElement("div");
    el.innerHTML = html;
    document.body.append(el);
    await act(async () => {
      hydrateRoot(el, stubbed(yourClub()), { onRecoverableError: (e) => errors.push(e) });
    });
    spy.mockRestore();
    expect(errors).toEqual([]);
    expect(el.textContent).toContain("Your club: Red Rock Rovers");
    el.remove();
  });
});

describe("FollowButton", () => {
  it("follow, unfollow, and replace another club", async () => {
    const user = userEvent.setup();
    inRouter(<FollowButton team={RRR} teams={mockTeams} />);
    await user.click(screen.getByRole("button", { name: /Follow club/ }));
    expect(screen.getByText("You follow Red Rock Rovers")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Unfollow" }));
    expect(readFollowedSlug()).toBeNull();
    cleanup();
    followClub("harbour-city");
    inRouter(<FollowButton team={RRR} teams={mockTeams} />);
    expect(screen.getByText(/You follow Harbour City\. This replaces it\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Follow Red Rock Rovers instead/ }));
    expect(readFollowedSlug()).toBe("red-rock-rovers");
  });
});
