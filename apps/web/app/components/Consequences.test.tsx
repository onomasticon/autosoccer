// @vitest-environment jsdom
import type { DealView, TakeoverView } from "@autosoccer/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { ClubDeals, moneyStory, PlayerTransfers, TakeoverCard } from "./Consequences";

afterEach(cleanup);
const inRouter = (ui: React.ReactNode) => {
  const Stub = createRoutesStub([{ path: "*", Component: () => <>{ui}</> }]);
  return render(<Stub initialEntries={["/"]} />);
};

const [harbour, rovers] = mockTeams;
const deal: DealView = {
  id: "00000000-0000-4000-8000-000000000a01",
  season: { slug: "season-2", name: "Season 2" },
  player: { id: "00000000-0000-4000-8000-000000000b01", name: "Jae Moon", position: "FW" },
  from: harbour!,
  to: rovers!,
  fee: 2_900_000,
  buyer: { manager: "Dex Okoro", reason: "Our weakest starting place is up front." },
  seller: { manager: "Marta Sol", reason: "Meets the guide fee and we have cover." },
};

describe("consequences (#80)", () => {
  it("a club's deals link the player, the other club and the window, with its own manager's reason", async () => {
    const { container } = inRouter(<ClubDeals deals={[deal]} teamId={harbour!.id} />);
    expect(container.textContent).toContain("Sold");
    expect(container.textContent).toContain("Marta Sol: Meets the guide fee");
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`/teams/${rovers!.slug}`);
    expect(hrefs).toContain("/transfers?season=season-2");
    expect(hrefs.some((h) => h?.startsWith("/players/"))).toBe(true);
    expect((await axe.run(container)).violations.map((v) => v.id)).toEqual([]);
  });

  it("the takeover card says why it happened and what the new owners did", async () => {
    const t: TakeoverView = {
      withdrew: { season: { slug: "season-1", name: "Season 1" }, round: 4, reason: "Couldn't pay round 4 wages." },
      basis: { available: 904_000, wages: 1_593_000 },
      capital: 11_096_000,
      from: "Northgate Comets",
      to: "Northgate Phoenix",
      returned: { slug: "season-2", name: "Season 2" },
      memo: "",
    };
    const { container } = inRouter(<TakeoverCard takeovers={[t]} />);
    const text = screen.getByTestId("takeover-card").textContent!;
    expect(text).toContain("Northgate Comets → Northgate Phoenix");
    expect(text).toContain("Ȼ1.59m of wages due with Ȼ904k available");
    expect(text).toContain("new owners put in Ȼ11.1m");
    expect((await axe.run(container)).violations.map((v) => v.id)).toEqual([]);
  });

  it("a player's transfers show both managers' reasons; the money story sums a season", async () => {
    const { container } = inRouter(<PlayerTransfers transfers={[deal]} />);
    expect(container.textContent).toContain("Dex Okoro: Our weakest starting place");
    expect(container.textContent).toContain("Marta Sol: Meets the guide fee");
    expect(
      moneyStory({
        season: { name: "Season 2" },
        bySource: {
          distribution: 6_000_000,
          results: 1_200_000,
          prize: 0,
          payroll: -8_700_000,
          transfers: -500_000,
          takeover: 0,
        },
        net: -2_000_000,
      }),
    ).toBe(
      "Season 2: earned Ȼ7.2m (league distribution Ȼ6m, results Ȼ1.2m); spent Ȼ9.2m (wages Ȼ8.7m, transfer fees Ȼ500k); down Ȼ2m.",
    );
  });

  it("a Phase 2 money story counts running costs and fees, and states borrowing apart, so it adds up", () => {
    // earned 6.43 − spent (48.32 + 0.895 + 2.25) + borrowed 33.08 = −11.955
    expect(
      moneyStory({
        season: { name: "Season 1" },
        bySource: {
          distribution: 4_500_000,
          results: 1_930_000,
          prize: 0,
          payroll: -48_320_000,
          transfers: 0,
          takeover: 0,
          operating: -895_000,
          borrowing: 33_080_000,
          auctions: 0,
          recruitment: -2_250_000,
        },
        net: -11_955_000,
      }),
    ).toBe(
      "Season 1: earned Ȼ6.43m (league distribution Ȼ4.5m, results Ȼ1.93m); spent Ȼ51.47m (wages Ȼ48.32m, running costs Ȼ895k, safety-net fees Ȼ2.25m); borrowed Ȼ33.08m more than it repaid; down Ȼ11.96m.",
    );
  });
});
