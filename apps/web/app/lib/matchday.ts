/** Pure helpers for the Matchday page (routes/matchday.tsx) and its entry points. */
import type { FixtureStory, FixtureView, ManagerProfile, StoryStage } from "@autosoccer/contracts";

/** Which act of the matchday a stage belongs to. */
export type Act = "build-up" | "watch" | "reaction";

export const STAGE_INFO: Record<StoryStage, { act: Act; label: string; tone: "muted" | "live" | "done" | "warn" }> = {
  scheduled: { act: "build-up", label: "Scheduled", tone: "muted" },
  awaiting_decisions: { act: "build-up", label: "Managers deciding", tone: "live" },
  prepared: { act: "build-up", label: "Lineups set", tone: "live" },
  playing: { act: "watch", label: "Being simulated", tone: "live" },
  completed: { act: "reaction", label: "Full time", tone: "done" },
  delayed: { act: "build-up", label: "Delayed", tone: "warn" },
  failed: { act: "build-up", label: "Held up", tone: "warn" },
  forfeited: { act: "reaction", label: "Walkover", tone: "warn" },
};

/** "Walkover to Northgate Comets" / "Void": the headline for a forfeited fixture. */
export function forfeitHeadline(story: FixtureStory): string | null {
  const ff = story.forfeit;
  if (!ff) return null;
  return ff.kind === "void" ? "Void: both clubs withdrew" : `Walkover to ${ff.awardedTo?.name ?? "the opponent"}`;
}

export const matchdayHref = (fixtureId: string) => `/matchday/${fixtureId}`;

/**
 * The homepage's featured matchday: the first unfinished fixture of the earliest round with
 * unfinished fixtures (its build-up, or a match being played), else the latest result.
 */
export function featuredFixture(fixtures: readonly FixtureView[]): FixtureView | null {
  // A forfeited fixture (a club withdrew) is never played, so it's never the featured matchday.
  const open = fixtures.filter((f) => f.status !== "completed" && !f.forfeit);
  if (open.length) {
    const round = Math.min(...open.map((f) => f.round));
    return open.find((f) => f.round === round) ?? null;
  }
  return [...fixtures].reverse().find((f) => f.status === "completed" && !f.forfeit) ?? null;
}

/**
 * How the two managers differ, from their recorded patterns only (manager-profile/1). Each line
 * names the manager and gives the pattern's own basis; nothing about feelings or intentions.
 * Empty when neither has enough evidence.
 */
export function managerContrast(home: ManagerProfile | null, away: ManagerProfile | null): string[] {
  const line = (p: ManagerProfile | null) => {
    if (!p?.manager) return null;
    const who = `${p.manager.name} (${p.team.name})`;
    if (p.verdict === "too_early")
      return `${who}: too early to read, with ${p.counts.decisions} decision${p.counts.decisions === 1 ? "" : "s"} on record.`;
    const t = p.traits[0];
    return t
      ? `${who}: ${t.label.toLowerCase()}. ${t.basis}`
      : `${who}: no strong pattern yet, having changed the setup in ${p.counts.changed} of ${p.counts.decisions} decisions.`;
  };
  const lines = [line(home), line(away)].filter((l): l is string => !!l);
  return lines.some((l) => !l.includes("too early to read")) ? lines : [];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Mon 16 Nov, 06:00 UTC". Built by hand rather than with toLocale*, so the server and every
 * browser produce exactly the same text (no hydration mismatch).
 */
export function kickoffUtc(iso: string | null): string {
  if (!iso) return "Kick-off time to be confirmed";
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm} UTC`;
}

/** Shown in the Watch section for each stage: honest about what exists yet. */
export function watchNote(story: FixtureStory, hasReplay: boolean): { title: string; body: string } | null {
  switch (story.stage) {
    case "completed":
      return hasReplay
        ? null
        : {
            title: "Replay unavailable",
            body: "The official result is recorded, but this match has no stored replay.",
          };
    case "playing":
      return {
        title: "Being simulated now",
        body: "The deterministic simulator is playing this match. The recorded replay appears here once the official result is in; reload to check.",
      };
    case "delayed":
      return {
        title: "Kick-off is running late",
        body: "The scheduled time has passed and the match hasn't started yet. It plays as soon as the round is released.",
      };
    case "failed":
      return {
        title: "Held up",
        body: "The match hit a problem and is waiting for an operator. No result has been recorded, and none will be guessed.",
      };
    case "forfeited":
      return {
        title: "Not played",
        body: "A club in this fixture has withdrawn from the season, so it isn't simulated: there is no replay, lineup or goals.",
      };
    default:
      return {
        title: "Not played yet",
        body: `Matches are simulated at kick-off (${kickoffUtc(story.scheduledAt)}) and shown here as a recorded replay, not live.`,
      };
  }
}

/**
 * Where a club's next match stands, in plain words: from the fixture story's stage when it's
 * loaded (official job and decision state), else from the fixture's own status.
 */
export function nextMatchStatus(f: FixtureView, story: FixtureStory | null): { label: string; detail: string } {
  const stage: StoryStage =
    story?.stage ??
    (f.status === "completed"
      ? "completed"
      : f.status === "playing"
        ? "playing"
        : f.status === "ready"
          ? "prepared"
          : f.status === "failed"
            ? "failed"
            : "scheduled");
  switch (stage) {
    case "scheduled":
      return {
        label: "Awaiting decisions",
        detail: "Both managers decide their lineup and tactics just before kick-off.",
      };
    case "awaiting_decisions":
      return { label: "Managers deciding", detail: "The AI managers are choosing their lineups and tactics now." };
    case "prepared":
      return { label: "Prepared", detail: "Lineups and tactics are set; the match is simulated at kick-off." };
    case "playing":
      return { label: "Being simulated", detail: "The recorded replay appears on the matchday page at full time." };
    case "delayed":
      return { label: "Delayed", detail: "Kick-off time has passed and the match hasn't started yet." };
    case "failed":
      return { label: "Held up", detail: "The match is waiting for an operator; no result yet." };
    case "forfeited":
      return {
        label: "Walkover",
        detail: "A club in this fixture withdrew from the season (bankrupt), so it won't be played.",
      };
    default:
      return { label: "Full time", detail: "The result is in." };
  }
}
