import type { Season, TitleRace } from "@autosoccer/contracts";

const names = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));
const rounds = (n: number) => `${n} round${n === 1 ? "" : "s"}`;

/** One sentence on the title race, from the table and the fixtures still to play. */
export function raceSentence(
  race: TitleRace,
  afterRound: number,
  seasonCompleted: boolean,
  endedEarly?: Season["endedEarly"],
): string | null {
  // Stopped part-way: nobody won it, whatever the table says.
  if (endedEarly) return endedEarlyLine(endedEarly);
  if (!afterRound) return null;
  if (race.clinched) {
    if (seasonCompleted || race.roundsLeft === 0) return `${race.clinched.name} are champions.`;
    return `${race.clinched.name} have won the title with ${rounds(race.roundsLeft)} to spare.`;
  }
  const c = race.contenders.map((t) => t.name);
  if (c.length === 1) return null;
  const left = `${rounds(race.roundsLeft)} left`;
  return race.contenders.length === 2
    ? `Two-horse race: only ${names(c)} can still win the title, with ${left}.`
    : `${c.length} clubs can still win the title (${names(c)}), with ${left}.`;
}

/** "The season ended early after round 2 of 18, with no champion." */
export function endedEarlyLine(e: NonNullable<Season["endedEarly"]>): string {
  return `The season ended early after round ${e.afterRound} of ${e.plannedRounds}, with no champion.`;
}

export function TitleRaceLine({
  race,
  afterRound,
  seasonCompleted,
  endedEarly,
  className = "",
}: {
  race: TitleRace;
  afterRound: number;
  seasonCompleted: boolean;
  endedEarly?: Season["endedEarly"];
  className?: string;
}) {
  const s = raceSentence(race, afterRound, seasonCompleted, endedEarly);
  if (!s) return null;
  return (
    <p className={`flex items-start gap-2 text-sm font-semibold ${className}`}>
      <span aria-hidden className="parallelogram mt-0.5 bg-yellow px-1.5 text-xs uppercase italic">
        Title race
      </span>
      <span>{s}</span>
    </p>
  );
}
