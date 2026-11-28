// @vitest-environment jsdom
import {
  ClubDebt as ClubDebtSchema,
  LeagueFounding as FoundingSchema,
  SeasonMarketResponse,
} from "@autosoccer/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { ClubDebt } from "./ClubDebt";
import { LeagueFounding } from "./LeagueFounding";
import { SeasonMarket } from "./SeasonMarket";

afterEach(cleanup);

const [harbour, rovers, northgate] = mockTeams;
const s1 = { slug: "pilot-season-1", name: "Season 1" };
const p = (id: number, name: string, position: "GK" | "DF" | "MF" | "FW" = "MF") => ({
  id: `00000000-0000-4000-8000-0000000000${String(id).padStart(2, "0")}`,
  name,
  position,
});
const inRouter = (el: ReactNode) =>
  render(<RouterProvider router={createMemoryRouter([{ path: "/", element: el }], { initialEntries: ["/"] })} />);
const noViolations = async (el: HTMLElement) => expect((await axe.run(el)).violations.map((v) => v.id)).toEqual([]);

const distressed = ClubDebtSchema.parse({
  rule: "insolvency/2",
  total: 7_450_000,
  loans: [
    {
      kind: "emergency",
      principal: 3_000_000,
      balance: 3_450_000,
      repaid: 0,
      interest: 450_000,
      opened: { season: s1, round: 2 },
      dueSeason: 2,
      status: "active",
      pledged: [],
    },
    {
      kind: "support",
      principal: 4_000_000,
      balance: 4_000_000,
      repaid: 0,
      interest: 0,
      opened: { season: s1, round: 5 },
      dueSeason: 3,
      status: "active",
      pledged: [],
    },
  ],
  administration: {
    since: { season: s1, round: 5 },
    debtAtEntry: 9_100_000,
    reason: "Couldn't meet round 5's obligations within its debt cap",
    exited: null,
  },
  events: [
    { season: s1, round: 5, outcome: "default", shortfall: 2_200_000, auctioned: 1 },
    { season: s1, round: 2, outcome: "emergency", shortfall: 900_000, auctioned: 0 },
  ],
  auctions: [
    {
      season: s1,
      round: 5,
      player: p(1, "Ines Varga", "FW"),
      role: "sold",
      counterparty: rovers,
      amount: 1_800_000,
      reserve: 1_200_000,
      bidders: 3,
    },
  ],
});

describe("ClubDebt", () => {
  it("shows administration, loans, the rounds it couldn't meet and its forced sales, accessibly", async () => {
    inRouter(<ClubDebt debt={distressed} club={harbour!.name} />);
    const el = screen.getByTestId("club-debt");
    expect(within(el).getByRole("note").textContent).toMatch(/In administration since Season 1, round 5/);
    expect(within(el).getByText("Ȼ7.45m")).toBeTruthy();
    expect(within(el).getByRole("row", { name: /Emergency financing.*Ȼ3m.*Ȼ3.45m/ })).toBeTruthy();
  });

  it("groups many loans of a kind into one row, with every loan behind an expander", async () => {
    const many = {
      ...distressed,
      loans: Array.from({ length: 12 }, (_, i) => ({ ...distressed.loans[0]!, opened: { season: s1, round: i + 1 } })),
    };
    inRouter(<ClubDebt debt={many} club="Harbour" />);
    const el = screen.getByTestId("club-debt");
    expect(within(el).getAllByRole("row")).toHaveLength(2); // header + one emergency row
    expect(
      within(el).getByRole("row", { name: /Emergency financing × 12.*12 outstanding.*Ȼ36m.*Ȼ41.4m/ }),
    ).toBeTruthy();
    expect(within(el).getByText("Every loan (12)")).toBeTruthy();
    expect(el.textContent).toMatch(
      /round 5: short by Ȼ2.2m beyond its borrowing limit: a default\. The lender auctioned 1 player/,
    );
    expect(el.textContent).toMatch(/Ines Varga sold to .*3 sealed bids/);
    expect(el.textContent).toMatch(/Nobody forfeits a match/);
    await noViolations(el);
  });

  it("says plainly when a club has never needed the lender", () => {
    inRouter(
      <ClubDebt
        debt={{ ...distressed, total: 0, loans: [], administration: null, events: [], auctions: [] }}
        club="Harbour"
      />,
    );
    expect(screen.getByTestId("club-debt").textContent).toMatch(/Harbour has never borrowed from the league lender/);
  });

  it("shows a recovery once the club has left administration", () => {
    inRouter(
      <ClubDebt
        debt={{
          ...distressed,
          administration: { ...distressed.administration!, exited: { slug: "pilot-season-2", name: "Season 2" } },
        }}
        club="Harbour"
      />,
    );
    expect(screen.getByTestId("club-debt").textContent).toMatch(/Recovered\..*left it at the end of Season 2/);
    expect(screen.queryByText(/In administration since/)).toBeNull();
  });
});

const market = SeasonMarketResponse.parse({
  contract: "market/1",
  season: s1,
  rule: "transfer/2",
  windows: [
    {
      kind: "recruitment",
      round: 1,
      phase: "closed",
      opensAt: "2027-05-01T17:00:00Z",
      deadline: "2027-05-03T17:00:00Z",
      effectiveRound: 1,
    },
    {
      kind: "recruitment",
      round: 2,
      phase: "free_agency",
      opensAt: "2027-05-03T17:00:00Z",
      deadline: "2027-05-05T17:00:00Z",
      effectiveRound: 1,
    },
  ],
  moves: [
    {
      window: { kind: "recruitment", round: 1 },
      type: "recruited",
      player: p(2, "Tomas Reyes", "GK"),
      team: harbour,
      wagePerSeason: 640_000,
      years: 3,
      fee: null,
      reason: "A keeper first: everything else builds from him.",
      source: "manager",
    },
    {
      window: null,
      type: "safety-net",
      player: p(3, "Ola Brandt", "DF"),
      team: northgate,
      wagePerSeason: 300_000,
      years: 1,
      fee: 250_000,
      reason: null,
      source: "league",
    },
  ],
  auctions: [
    {
      round: 5,
      player: p(1, "Ines Varga", "FW"),
      seller: harbour,
      buyer: rovers,
      amount: 1_800_000,
      reserve: 1_200_000,
      bidders: 3,
    },
  ],
});

describe("SeasonMarket", () => {
  it("lists each window's official moves, the safety net and auctions, and keeps open windows sealed", async () => {
    inRouter(<SeasonMarket data={market} />);
    const el = screen.getByTestId("season-market");
    expect(within(el).getByRole("heading", { name: "Recruitment, round 1" })).toBeTruthy();
    expect(el.textContent).toMatch(/Tomas Reyes/);
    expect(el.textContent).toMatch(/Manager's stated reason: A keeper first/);
    expect(el.textContent).toMatch(/Offers are sealed until the deadline/);
    expect(within(el).getByRole("heading", { name: "The safety net" })).toBeTruthy();
    expect(el.textContent).toMatch(/fee Ȼ250k/);
    expect(within(el).getByTestId("market-auction").textContent).toMatch(/3 sealed bids.*Ȼ1.8m/);
    expect(el.textContent).toMatch(/Offers that didn't sign, and what each club bid at auction, stay private/);
    await noViolations(el);
  });

  it("explains a season from before the player market", () => {
    inRouter(<SeasonMarket data={{ ...market, windows: [], moves: [], auctions: [] }} />);
    expect(screen.getByText("No player market this season")).toBeTruthy();
  });
});

const founding = FoundingSchema.parse({
  rule: "inaugural/1",
  opensAt: "2027-05-01T09:00:00Z",
  founders: [
    {
      model: {
        slug: "mistral-small-4",
        provider: "mistral",
        apiModelId: "mistralai/mistral-small-4",
        route: "openrouter",
        host: "Mistral",
      },
      status: "founded",
      rounds: 2,
      team: harbour,
      live: true,
    },
    {
      model: {
        slug: "claude-opus-5-5",
        provider: "anthropic",
        apiModelId: "claude-opus-5-5",
        route: "direct",
        host: null,
      },
      status: "awaiting",
      rounds: 3,
      team: null,
      live: null,
    },
  ],
  recruitment: { rounds: 3, recruited: 41, safetyNet: 2 },
});

describe("LeagueFounding", () => {
  it("names every founder by its exact model, with the club it founded and the recruitment", async () => {
    inRouter(<LeagueFounding founding={founding} marketHref="/seasons/pilot-season-1/market" />);
    const el = screen.getByTestId("league-founding");
    expect(el.textContent).toMatch(/2 AI models were invited/);
    expect(el.textContent).toMatch(/mistralai\/mistral-small-4 \(mistral\), served by Mistral/);
    expect(el.textContent).toMatch(/Charter accepted in round 2 of 3/);
    expect(el.textContent).toMatch(/No accepted charter after three rounds/);
    expect(el.textContent).toMatch(/41 signings, then 2 players assigned by the safety net/);
    expect(within(el).getByRole("link", { name: "Every signing" }).getAttribute("href")).toBe(
      "/seasons/pilot-season-1/market",
    );
    expect(screen.queryByText(/Rehearsal data/)).toBeNull();
    await noViolations(el);
  });

  it("labels charters from the offline stand-in as rehearsal data", () => {
    inRouter(
      <LeagueFounding
        founding={{ ...founding, founders: founding.founders.map((f) => ({ ...f, live: false })) }}
        marketHref={null}
      />,
    );
    expect(screen.getByRole("note").textContent).toMatch(/Rehearsal data/);
  });
});
