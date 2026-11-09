import type { BudgetResponse } from "@autosoccer/contracts";

type Row = BudgetResponse["rows"][number];
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

/** A team's seasonal compute budget for its AI manager: spent vs. granted, with a text status. */
export function BudgetMeter({ row }: { row: Row }) {
  const pct = row.grantedMicroUsd ? Math.min(100, Math.round((row.spentMicroUsd / row.grantedMicroUsd) * 100)) : 0;
  return (
    <div className="card-surface p-4 text-sm" data-testid="budget-meter">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">AI compute budget</span>
        <span className="tabular text-muted-text">
          {usd(row.spentMicroUsd)} of {usd(row.grantedMicroUsd)}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Season compute budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}% used, ${usd(row.remainingMicroUsd)} left`}
        className="mt-2 h-2 overflow-hidden rounded-full bg-line"
      >
        <div className={`h-full ${row.exhausted ? "bg-coral" : "bg-violet"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-muted-text">
        {row.exhausted ? (
          <>
            <strong className="text-ink">Budget exhausted</strong> — the manager keeps its last valid tactics for the
            rest of the season.
          </>
        ) : (
          <>
            {usd(row.remainingMicroUsd)} left · {row.runs} paid decision{row.runs === 1 ? "" : "s"} so far
          </>
        )}
      </p>
    </div>
  );
}
