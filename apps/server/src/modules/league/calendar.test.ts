import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR, nextSlot, opportunities, seasonCalendar } from "./calendar.ts";

const teams = Array.from({ length: 20 }, (_, i) => `club-${String(i + 1).padStart(2, "0")}`);
const OPENS = new Date("2027-03-20T09:00:00Z"); // across Europe's DST change (UTC never shifts)

describe("calendar/1", () => {
  const cal = seasonCalendar(teams, OPENS);

  it("schedules 38 rounds and 380 fixtures, each club once a round, every pairing home and away", () => {
    expect(cal.rounds).toHaveLength(38);
    expect(cal.rounds.flatMap((r) => r.fixtures)).toHaveLength(380);
    for (const r of cal.rounds) {
      const clubs = r.fixtures.flatMap((f) => [f.home, f.away]);
      expect(new Set(clubs).size).toBe(20);
    }
    expect(new Set(cal.rounds.flatMap((r) => r.fixtures.map((f) => `${f.home}>${f.away}`))).size).toBe(380);
  });

  it("puts founding, then a 72h preseason, then the first half, a 24h midseason window and the second half", () => {
    expect(cal.windows.map((w) => w.kind)).toEqual(["founding", "preseason", "midseason"]);
    const [founding, pre, mid] = cal.windows as [
      (typeof cal.windows)[0],
      (typeof cal.windows)[0],
      (typeof cal.windows)[0],
    ];
    expect(founding.opens.toISOString()).toBe("2027-03-20T09:00:00.000Z");
    expect(pre.opens).toEqual(founding.closes);
    expect(pre.closes.getTime() - pre.opens.getTime()).toBe(72 * 3_600_000);
    expect(mid.closes.getTime() - mid.opens.getTime()).toBe(24 * 3_600_000);
    expect(cal.rounds[0]!.tacticsLock.getTime()).toBeGreaterThanOrEqual(pre.closes.getTime());
    expect(cal.rounds[18]!.half).toBe(1);
    expect(cal.rounds[19]!.half).toBe(2);
    expect(mid.opens.getTime()).toBeGreaterThan(cal.rounds[18]!.lastKickoff.getTime());
    expect(cal.rounds[19]!.tacticsLock.getTime()).toBeGreaterThanOrEqual(mid.closes.getTime());
  });

  it("uses two matchday slots a day, 12 hours apart, in UTC", () => {
    for (const r of cal.rounds) expect([8, 20]).toContain(r.firstKickoff.getUTCHours());
    const gaps = cal.rounds
      .slice(1, 19)
      .map((r, i) => r.firstKickoff.getTime() - cal.rounds[i]!.firstKickoff.getTime());
    expect(new Set(gaps)).toEqual(new Set([12 * 3_600_000]));
  });

  it("locks every club's tactics before the round's first kickoff and starts the final round all at once", () => {
    for (const r of cal.rounds) {
      expect(r.tacticsLock.getTime()).toBeLessThan(r.firstKickoff.getTime());
      for (const f of r.fixtures) expect(f.kickoff.getTime()).toBeGreaterThanOrEqual(r.firstKickoff.getTime());
    }
    const last = cal.rounds.at(-1)!;
    expect(new Set(last.fixtures.map((f) => f.kickoff.getTime())).size).toBe(1);
    expect(new Set(cal.rounds[0]!.fixtures.map((f) => f.kickoff.getTime())).size).toBe(2); // two waves of five
  });

  it("computes the cycle's length from slot alignment instead of assuming it", () => {
    // 10 days founding + 3 days preseason + 19 rounds (9.5 days) + 1 day break + 19 rounds.
    expect(cal.cycleDays).toBeGreaterThan(32);
    expect(cal.cycleDays).toBeLessThan(34);
    const later = seasonCalendar(teams, OPENS, { ...DEFAULT_CALENDAR, foundingDays: 0 });
    expect(later.cycleDays).toBeGreaterThan(22.5);
    expect(later.cycleDays).toBeLessThan(24.5);
    // A different opening hour changes slot alignment, so the length differs a little.
    const evening = seasonCalendar(teams, new Date("2027-03-20T21:00:00Z"), { ...DEFAULT_CALENDAR, foundingDays: 0 });
    expect(Math.abs(evening.cycleDays - later.cycleDays)).toBeLessThanOrEqual(1);
  });

  it("finds the next slot across day and month boundaries", () => {
    expect(nextSlot(new Date("2027-03-31T20:00:01Z"), [8, 20]).toISOString()).toBe("2027-04-01T08:00:00.000Z");
    expect(nextSlot(new Date("2027-03-31T20:00:00Z"), [8, 20]).toISOString()).toBe("2027-03-31T20:00:00.000Z");
  });

  it("gives every manager the same bounded opportunities, each with a deadline", () => {
    const ops = opportunities(cal);
    const count = (k: string) => ops.filter((o) => o.kind === k).length;
    expect(count("founding")).toBe(1);
    expect(count("season-strategy")).toBe(1);
    expect(count("window")).toBe(6);
    expect(count("pre-match")).toBe(38);
    expect(count("post-match")).toBe(38);
    expect(count("management")).toBeGreaterThan(20);
    for (const o of ops) expect(o.deadline.getTime()).toBeGreaterThan(o.opens.getTime());
    // A round's pre-match opportunity never opens before the previous round has finished.
    for (const o of ops.filter((x) => x.kind === "pre-match" && x.round! > 1)) {
      const prev = cal.rounds[o.round! - 2]!;
      expect(o.opens.getTime()).toBeGreaterThan(prev.lastKickoff.getTime());
    }
    // About 100 decisions per club per season before management days: a bounded budget.
    expect(ops.length).toBeLessThan(150);
  });
});
