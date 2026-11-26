import { describe, expect, it } from "vitest";
import { championsAt, cycleScale, inCycle, MATCH_MINUTES, previewAt, reportAt, roundPieceAt } from "./timing.ts";

const T = (s: string) => new Date(`2026-11-26T${s}:00Z`);
const hm = (d: Date) => d.toISOString().slice(11, 16);

describe("the news cycle", () => {
  it("a round's reports are staggered after full time, then the round piece, then the champions story", () => {
    const kickoff = T("18:00");
    const reports = [0, 1, 2, 3, 4].map((i) => reportAt(kickoff, i, 240));
    expect(reports.map(hm)).toEqual(["18:15", "18:19", "18:23", "18:27", "18:31"]);
    expect(reports[0]!.getTime()).toBeGreaterThan(kickoff.getTime() + MATCH_MINUTES * 60_000);
    expect(hm(roundPieceAt(kickoff, 240))).toBe("18:50");
    expect(hm(championsAt(kickoff, 240))).toBe("19:10");
    expect(hm(inCycle(T("18:10"), 75, 240, new Date()))).toBe("19:25"); // the next season's league news
  });

  it("previews are spread across the run-up to kickoff, after the previous round, never at kickoff", () => {
    const prevEnd = T("14:10");
    const kickoff = T("18:00");
    const times = [0, 1, 2, 3, 4].map((i) => previewAt(prevEnd, kickoff, i, 5, 240));
    expect(new Set(times.map(hm)).size).toBe(5);
    expect(times.every((t, i) => i === 0 || t > times[i - 1]!)).toBe(true);
    expect(hm(times[0]!)).toBe("15:30"); // 2½ hours before kickoff
    expect(times.at(-1)!.getTime()).toBeLessThan(kickoff.getTime());
    expect(times[0]!.getTime()).toBeGreaterThan(roundPieceAt(T("14:00"), 240).getTime());
  });

  it("a league playing every hour runs a tighter cycle that still keeps the order", () => {
    expect(cycleScale(60)).toBe(0.25);
    expect(cycleScale(10_080)).toBe(1);
    const kickoff = T("12:00");
    const lastReport = reportAt(kickoff, 1, 60);
    const piece = roundPieceAt(kickoff, 60);
    const next = previewAt(new Date(kickoff.getTime() + MATCH_MINUTES * 60_000), T("13:00"), 0, 2, 60);
    expect(lastReport < piece && piece < next && next < T("13:00")).toBe(true);
  });
});
