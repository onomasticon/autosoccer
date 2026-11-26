// @vitest-environment jsdom
import {
  type SeasonSummary,
  type Spotlight,
  Spotlight as SpotlightSchema,
  type StandingRow,
} from "@autosoccer/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFollowedSlug } from "../lib/follow";
import { mockFixtures, mockTeams } from "../lib/mocks";
import { clipHref, clubReasons, focusFor, spotlightHref } from "../lib/spotlight";
import { YourClub } from "./FollowClub";
import { PlayerSpotlight } from "./PlayerSpotlight";

const [HBC, RRR, , FOURTH] = mockTeams as [
  (typeof mockTeams)[0],
  (typeof mockTeams)[0],
  (typeof mockTeams)[0],
  (typeof mockTeams)[0],
];
const inRouter = (ui: React.ReactNode) => {
  const Stub = createRoutesStub([{ path: "*", Component: () => <>{ui}</> }]);
  return render(<Stub initialEntries={["/"]} />);
};

/** The Season 15 round-one example from the live review, as the API serves it. */
const nyberg: Spotlight = SpotlightSchema.parse({
  kind: "hat_trick",
  player: { id: "00000000-0000-4000-8000-00000000a001", name: "Tove Nyberg", shirtNumber: 9, position: "FW" },
  team: RRR,
  opponent: HBC,
  season: { slug: "season-15", name: "Season 15" },
  round: 1,
  matchId: "00000000-0000-4000-8000-00000000b001",
  fixtureId: "00000000-0000-4000-8000-00000000c001",
  headline: `Tove Nyberg scored three as ${RRR.name} beat ${HBC.name} 3–1.`,
  detail: "Two of them came 26 match seconds apart.",
  goals: [
    { tick: 2400, period: "firstHalf", clockSec: 40, score: { home: 1, away: 0 } },
    { tick: 10420, period: "secondHalf", clockSec: 7, score: { home: 2, away: 1 } },
    { tick: 11980, period: "secondHalf", clockSec: 33, score: { home: 3, away: 1 } },
  ],
  replay: true,
  action: "Watch Nyberg's three goals",
  next: {
    fixtureId: "00000000-0000-4000-8000-00000000c002",
    round: 2,
    venue: "away",
    opponent: HBC,
    scheduledAt: "2026-11-30T06:00:00Z",
  },
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("PlayerSpotlight", () => {
  it("leads with a named player, what happened, a verified detail and one specific action", async () => {
    inRouter(<PlayerSpotlight lead={nyberg} />);
    const s = screen.getByTestId("player-spotlight");
    expect(within(s).getByRole("heading", { name: "Tove Nyberg" })).toBeTruthy();
    expect(screen.getByTestId("spotlight-headline").textContent).toContain("scored three");
    expect(screen.getByTestId("spotlight-detail").textContent).toContain("26 match seconds apart");
    const action = screen.getByTestId("spotlight-action");
    expect(action.textContent).toContain("Watch Nyberg's three goals");
    expect(action.getAttribute("href")).toBe(`/matches/${nyberg.matchId}?clip=${nyberg.player.id}#replay`);
    // Career at a stable address; the club stays its own link; the next match is one tap.
    expect(
      within(s)
        .getByRole("link", { name: /Nyberg's career/ })
        .getAttribute("href"),
    ).toBe(`/players/${nyberg.player.id}/tove-nyberg`);
    expect(within(s).getByRole("link", { name: RRR.name }).getAttribute("href")).toBe(`/teams/${RRR.slug}`);
    expect(screen.getByTestId("spotlight-next").getAttribute("href")).toBe(`/matchday/${nyberg.next!.fixtureId}`);
    const r = await axe.run(s, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it("follows the player's club from the lead, on this device", async () => {
    inRouter(<PlayerSpotlight lead={nyberg} />);
    await userEvent.click(await screen.findByRole("button", { name: `Follow ${RRR.name}` }));
    expect(readFollowedSlug()).toBe(RRR.slug);
    expect(screen.getByText(`You follow ${RRR.name}`)).toBeTruthy();
  });

  it("every state has a valid next action: no replay, quiet round, nothing scheduled", () => {
    expect(spotlightHref(nyberg)).toBe(clipHref(nyberg.matchId!, nyberg.player.id));
    expect(spotlightHref({ ...nyberg, replay: false })).toBe(`/matches/${nyberg.matchId}`);
    const quiet = { ...nyberg, kind: "quiet" as const, matchId: null, fixtureId: null, goals: [], replay: false };
    expect(spotlightHref(quiet)).toBe(`/matchday/${nyberg.next!.fixtureId}`);
    expect(spotlightHref({ ...quiet, next: null })).toBe(`/players/${nyberg.player.id}/tove-nyberg`);
  });
});

describe("focusFor", () => {
  it("finds the player on the pitch by slot and plays only their goals", () => {
    const lineups = {
      home: [{ id: "gk" }, { id: nyberg.player.id }].map((p, i) => ({
        ...p,
        name: i ? "Tove Nyberg" : "Keeper",
        shirtNumber: i + 1,
        position: "FW" as const,
        attributes: {} as never,
        overall: 60,
      })),
      away: [],
    };
    const events = [
      ...nyberg.goals.map((g) => ({
        type: "goal" as const,
        side: "home" as const,
        scorerId: nyberg.player.id,
        ownGoal: false,
        ...g,
      })),
      {
        type: "goal" as const,
        side: "home" as const,
        scorerId: "gk",
        ownGoal: false,
        tick: 50,
        period: "firstHalf" as const,
        clockSec: 1,
        score: { home: 4, away: 1 },
      },
    ];
    const f = focusFor({ events, lineups }, nyberg.player.id, { autoplay: true })!;
    expect(f).toMatchObject({
      simId: "blue-2",
      name: "Tove Nyberg",
      label: "Watch Nyberg's three goals",
      autoplay: true,
    });
    expect(f.ticks).toEqual([2400, 10420, 11980]);
    expect(focusFor({ events, lineups }, "nobody")).toBeNull();
  });
});

describe("clubReasons", () => {
  const season = (slug: string, champion: (typeof mockTeams)[0] | null, status = "completed") =>
    ({
      season: { slug, name: slug.replace("season-", "Season "), status },
      leader: champion ? { team: champion } : null,
      topScorers: [],
    }) as unknown as SeasonSummary;
  const row = (team: (typeof mockTeams)[0], position: number, form: StandingRow["form"]) =>
    ({ team, position, points: 10 - position, played: 4, form }) as unknown as StandingRow;
  it("gives each of the four clubs a short, distinct reason from honours, players or form", () => {
    const reasons = clubReasons({
      teams: mockTeams.slice(0, 4),
      seasons: [season("season-15", null, "active"), season("season-14", RRR), season("season-13", RRR)],
      allTimeScorers: [
        { rank: 1, playerId: "m", name: "Jae Moon", team: HBC, goals: 53, matches: 61 },
        { rank: 2, playerId: "n", name: "Tove Nyberg", team: RRR, goals: 40, matches: 70 },
      ],
      standings: [
        row(FOURTH, 1, ["W", "W", "W"]),
        row(RRR, 2, ["W", "L"]),
        row(HBC, 3, ["L"]),
        row(mockTeams[2]!, 4, ["D"]),
      ],
      lead: nyberg,
    });
    const texts = mockTeams.slice(0, 4).map((t) => reasons[t.id]);
    expect(texts.every(Boolean)).toBe(true);
    expect(new Set(texts).size).toBe(4);
    expect(reasons[HBC.id]).toBe("Home of Jae Moon, the league's all-time top scorer (53)");
    expect(reasons[FOURTH.id]).toMatch(/Top of the table|Won their last 3/);
  });
});

describe("YourClub with reasons and moments", () => {
  it("new visitor: four club choices, each with its reason; following shows the latest moment", async () => {
    inRouter(
      <YourClub
        teams={mockTeams.slice(0, 2)}
        fixtures={mockFixtures}
        stories={[]}
        articles={[]}
        season="season-15"
        reasons={{ [HBC.id]: "Home of Jae Moon", [RRR.id]: "Defending champions" }}
        moments={{ [RRR.id]: nyberg }}
      />,
    );
    const choices = await screen.findByTestId("club-choices");
    expect(within(choices).getByText("Defending champions")).toBeTruthy();
    await userEvent.click(within(choices).getByRole("button", { name: new RegExp(RRR.name) }));
    const moment = await screen.findByTestId("club-moment");
    expect(moment.textContent).toContain("Tove Nyberg scored three");
    expect(
      within(moment)
        .getByRole("link", { name: /Watch Nyberg's three goals/ })
        .getAttribute("href"),
    ).toBe(clipHref(nyberg.matchId!, nyberg.player.id));
  });
});
