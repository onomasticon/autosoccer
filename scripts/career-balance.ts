/**
 * Balance study for player development (develop/1, #70): applies the rule for N seasons to every
 * club's squad with the same representative record (first seven start every match, the forward
 * scores most, reserves don't play) and prints each club's first-seven and squad averages. Shows
 * whether development drifts the clubs apart or inflates ratings without bound. Read-only.
 *
 *   bun scripts/career-balance.ts [--seasons 10]
 */
import type { PlayerAttributes } from "@autosoccer/contracts";
import { overallRating, playerAttributes } from "../apps/server/src/modules/league/attributes.ts";
import { develop } from "../apps/server/src/modules/league/careers.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";

const seasons = Number(process.argv[process.argv.indexOf("--seasons") + 1] || 10);
const MATCHES = 6;
const squads = SEED_TEAMS.map((t) => ({
  slug: t.slug,
  players: t.players.map((p) => ({
    ...p,
    attributes: playerAttributes({ name: p.name, shirtNumber: p.number, position: p.position }) as PlayerAttributes,
  })),
}));
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const report = (n: number) => {
  const first = squads.map((c) => avg(c.players.slice(0, 7).map((p) => overallRating(p.attributes, p.position))));
  const all = squads.map((c) => avg(c.players.map((p) => overallRating(p.attributes, p.position))));
  const max = Math.max(...squads.flatMap((c) => c.players.flatMap((p) => Object.values(p.attributes))));
  console.log(
    `season ${String(n).padStart(2)}  first seven ${first.map((x) => x.toFixed(1)).join(" / ")}  (spread ${(Math.max(...first) - Math.min(...first)).toFixed(2)})  squads ${all.map((x) => x.toFixed(1)).join(" / ")}  top rating ${max}`,
  );
};
report(0);
for (let s = 1; s <= seasons; s++) {
  for (const c of squads)
    for (const [i, p] of c.players.entries()) {
      const starter = i < 7;
      const goals = starter ? (p.position === "FW" ? 4 : p.position === "MF" ? 1 : 0) : 0;
      p.attributes = develop(
        p.attributes,
        p.position,
        { teamMatches: MATCHES, starts: starter ? MATCHES : 0, goals },
        `${c.slug}#${p.number}:season-${s}`,
      ).attributes;
    }
  report(s);
}
