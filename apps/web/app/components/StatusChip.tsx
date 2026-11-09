import type { FixtureView } from "@autosoccer/contracts";
import { fixtureStatusLabel } from "../lib/format";

const TONE: Record<string, string> = {
  completed: "bg-ink text-white",
  playing: "bg-coral text-ink",
  failed: "bg-line text-ink",
  ready: "bg-yellow text-ink",
  scheduled: "bg-surface text-ink border border-line",
};

/** Text label + colour: status never relies on colour alone. */
export function StatusChip({ status }: Pick<FixtureView, "status">) {
  const l = fixtureStatusLabel({ status });
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wider ${TONE[status] ?? TONE.scheduled}`}
      title={l.long}
    >
      {status === "playing" && (
        <span aria-hidden className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-ink" />
      )}
      {l.short}
      <span className="sr-only"> ({l.long})</span>
    </span>
  );
}
