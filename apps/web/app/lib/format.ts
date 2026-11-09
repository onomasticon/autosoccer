import type { FixtureView } from "@autosoccer/contracts";

/** Simulator clock: seconds within a half, shown as m:ss with the half (never fake football minutes). */
export function formatClock(period: "firstHalf" | "secondHalf", clockSec: number): string {
  const m = Math.floor(clockSec / 60);
  const s = Math.floor(clockSec % 60);
  return `${period === "firstHalf" ? "1H" : "2H"} ${m}:${String(s).padStart(2, "0")}`;
}

export function fixtureStatusLabel(f: Pick<FixtureView, "status">): { short: string; long: string } {
  switch (f.status) {
    case "completed":
      return { short: "FT", long: "Full time" };
    case "playing":
      return { short: "LIVE", long: "In play" };
    case "failed":
      return { short: "PPD", long: "Postponed" };
    case "ready":
      return { short: "NEXT", long: "Kick-off pending" };
    default:
      return { short: "TBD", long: "Scheduled" };
  }
}

export function formatDate(
  iso: string | null,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(iso));
}

/** Readable text colour (ink or white) for a solid background colour. */
export function onColor(hex: string): "#FFFFFF" | "#20203B" {
  const lum = (h: string) => {
    const c = [1, 3, 5]
      .map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const l = lum(hex);
  const vsWhite = 1.05 / (l + 0.05);
  const vsInk = (l + 0.05) / (lum("#20203B") + 0.05);
  return vsWhite >= vsInk ? "#FFFFFF" : "#20203B";
}
