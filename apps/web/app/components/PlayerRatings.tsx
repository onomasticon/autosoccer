import type { AttributeName, Player } from "@autosoccer/contracts";

/** Display order and labels: movement, then the ball, then defending. */
export const ATTRIBUTE_LABELS: Array<[AttributeName, string]> = [
  ["pace", "Pace"],
  ["acceleration", "Acceleration"],
  ["agility", "Agility"],
  ["stamina", "Stamina"],
  ["control", "Ball control"],
  ["passing", "Passing"],
  ["shooting", "Shooting"],
  ["power", "Shot power"],
  ["tackling", "Tackling"],
  ["goalkeeping", "Goalkeeping"],
];

/** Overall rating chip: yellow for the standouts (75+). */
export function OverallBadge({ overall }: { overall: number }) {
  return (
    <span
      className={`tabular inline-flex h-7 min-w-9 items-center justify-center rounded-md px-1.5 font-display text-lg font-extrabold ${
        overall >= 75 ? "bg-yellow text-ink" : "bg-lavender text-violet-deep"
      }`}
      title="Overall rating (1–99)"
    >
      <span className="sr-only">Overall rating </span>
      {overall}
    </span>
  );
}

/** A player's ten ratings as labelled bars (1–99). Outfield players' goalkeeping is left out. */
export function PlayerRatings({ player }: { player: Pick<Player, "attributes" | "position"> }) {
  const shown = ATTRIBUTE_LABELS.filter(([n]) => n !== "goalkeeping" || player.position === "GK");
  return (
    <dl className="grid grid-cols-1 gap-y-1.5 text-sm" data-testid="player-ratings">
      {shown.map(([n, label]) => {
        const v = player.attributes[n];
        return (
          <div key={n} className="grid grid-cols-[7.5rem_2rem_1fr] items-center gap-2">
            <dt className="text-muted-text">{label}</dt>
            <dd className="tabular text-right font-semibold">{v}</dd>
            <dd aria-hidden className="h-2 overflow-hidden rounded-full bg-line">
              <span
                className={`block h-full rounded-full ${v >= 75 ? "bg-coral" : v >= 55 ? "bg-violet" : "bg-slate-violet"}`}
                style={{ width: `${v}%` }}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
