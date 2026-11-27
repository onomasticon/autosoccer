// @vitest-environment jsdom
import {
  type FoundingCharter as Charter,
  type CharterResponse,
  crestSvg,
  kitSvg,
  type League,
} from "@autosoccer/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { LeagueCard, leagueStatus } from "../routes/leagues";
import { FoundingCharter } from "./FoundingCharter";

afterEach(cleanup);
const inRouter = (ui: React.ReactNode) => {
  const Stub = createRoutesStub([{ path: "*", Component: () => <>{ui}</> }]);
  return render(<Stub initialEntries={["/"]} />);
};

const c: Charter = {
  name: "Quarry Lane",
  shortName: "QLA",
  nickname: "The Masons",
  city: "Quarry",
  stadium: "The Stoneyard",
  motto: "Built to last",
  culture: "Patient and local, stubborn about doing things properly.",
  philosophy: "Possession with purpose and a high line.",
  recruitment: "Young players with room to grow.",
  brand: {
    primaryColor: "#1F3A93",
    secondaryColor: "#F5F0E6",
    crest: { shape: "shield", glyph: "QL", pattern: "chevron" },
    home: { shirt: "#1F3A93", shorts: "#F5F0E6", socks: "#1F3A93", pattern: "hoops", trim: "#F5F0E6" },
    away: { shirt: "#F5F0E6", shorts: "#1F3A93", socks: "#F5F0E6", pattern: "plain", trim: "#1F3A93" },
  },
};
const charter = (live: boolean): CharterResponse => ({
  team: { slug: "quarry-lane", name: c.name },
  league: { slug: "founders", name: "The Founders League" },
  charter: c,
  founder: { model: "anthropic/claude-sonnet-5-5", provider: live ? "anthropic" : "offline", live },
  foundedAt: "2027-03-30T12:00:00.000Z",
  submissions: [
    { round: 1, accepted: false, reasons: ["name taken"], submittedAt: "2027-03-29T12:00:00.000Z" },
    { round: 2, accepted: true, reasons: [], submittedAt: "2027-03-30T12:00:00.000Z" },
  ],
  assets: {
    crestSvg: crestSvg(c.brand, "Quarry Lane crest"),
    homeKitSvg: kitSvg(c.brand.home, "Quarry Lane home kit"),
    awayKitSvg: kitSvg(c.brand.away, "Quarry Lane away kit"),
  },
});

const league = (over: Partial<League>): League => ({
  slug: "original",
  name: "The Original League",
  status: "archived",
  division: null,
  tier: null,
  isDefault: false,
  description: "",
  seasons: 17,
  latestSeason: { slug: "season-17", name: "Season 17", status: "completed" },
  concludedAt: null,
  archivedAt: null,
  ...over,
});

describe("founding charter (#95)", () => {
  it("names the exact founder model, separates declared words from observation, and is accessible", async () => {
    const { container } = inRouter(<FoundingCharter charter={charter(true)} />);
    expect(screen.getByText("anthropic/claude-sonnet-5-5")).toBeTruthy();
    expect(screen.getByText(/declared, not observed/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Quarry Lane crest" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Quarry Lane away kit" })).toBeTruthy();
    expect(screen.getByText(/Accepted at submission 2/)).toBeTruthy();
    expect(screen.queryByText(/offline stand-in/)).toBeNull();
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });

  it("labels a charter made by the offline stand-in", () => {
    inRouter(<FoundingCharter charter={charter(false)} />);
    expect(screen.getByText(/offline stand-in, not a model/)).toBeTruthy();
  });
});

describe("league navigation (#100)", () => {
  it("labels archived and concluded leagues honestly, never as live", () => {
    expect(leagueStatus({ status: "archived", isDefault: false }).label).toBe("Archived · read-only");
    expect(leagueStatus({ status: "concluded", isDefault: false }).label).toBe("Concluded");
    expect(leagueStatus({ status: "active", isDefault: true }).label).toBe("Playing now");
  });

  it("links each league to its archive page", async () => {
    const { container } = inRouter(
      <ul>
        <LeagueCard l={league({})} />
        <LeagueCard
          l={league({ slug: "founders", name: "The Founders League", status: "active", isDefault: true, seasons: 1 })}
        />
      </ul>,
    );
    expect(screen.getByRole("link", { name: "The Original League" }).getAttribute("href")).toBe("/leagues/original");
    expect(screen.getByText("Archived · read-only")).toBeTruthy();
    expect(screen.getByText("Playing now")).toBeTruthy();
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations).toEqual([]);
  });
});
