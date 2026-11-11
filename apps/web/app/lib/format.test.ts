import { describe, expect, it } from "vitest";
import { formatDate, onColor, readableChip } from "./format";

describe("format", () => {
  it("formats dates in UTC, labelling every time with its zone", () => {
    const iso = "2026-11-15T14:00:00.000Z";
    expect(formatDate(iso)).toBe("15 Nov");
    expect(formatDate(iso, { weekday: true, time: true })).toBe("Sun 15 Nov, 14:00 UTC");
    expect(formatDate(iso, { weekday: true, time: true, date: false })).toBe("Sun 14:00 UTC");
  });
  it("readableChip keeps passing colours and deepens failing ones just enough for AA", () => {
    expect(readableChip("#245EFF")).toEqual({ bg: "#245EFF", fg: "#FFFFFF" });
    expect(readableChip("#F2A93B")).toEqual({ bg: "#F2A93B", fg: onColor("#F2A93B") });
    const red = readableChip("#E2412E");
    expect(red.fg).toBe("#FFFFFF");
    expect(red.bg).not.toBe("#E2412E");
    expect(red.bg).toMatch(/^#[0-9a-f]{6}$/);
  });
});
