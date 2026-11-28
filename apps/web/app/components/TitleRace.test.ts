import { describe, expect, it } from "vitest";
import { mockTeams } from "../lib/mocks";
import { raceSentence } from "./TitleRace";

const [a] = mockTeams;

describe("the title race line", () => {
  it("crowns the club that clinched a completed season", () => {
    expect(raceSentence({ roundsLeft: 0, contenders: [a!], clinched: a! }, 18, true)).toBe(`${a!.name} are champions.`);
  });

  it("crowns nobody in a season that ended early, though no fixtures are left", () => {
    const race = { roundsLeft: 0, contenders: [a!], clinched: a! };
    expect(raceSentence(race, 2, false, { afterRound: 2, plannedRounds: 18 })).toBe(
      "The season ended early after round 2 of 18, with no champion.",
    );
  });
});
