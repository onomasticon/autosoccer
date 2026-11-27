/**
 * The economy harness's integrated mode (#98): plays real seasons through the normal lifecycle
 * (scheduler, pinned simulator via the adapter, offline managers) on a throwaway database, then
 * measures how far the fast mode's synthetic results diverge from the real ones and fits the
 * surrogate's parameters. Never touches production: it always creates its own database.
 *
 *   bun run economy:integrated [--clubs 10] [--seasons 1] [--seed 20261127] [--half 0 (production length)]
 *                              [--out docs/platform/economy-surrogate.md]
 */
import { writeFileSync } from "node:fs";
import type { MatchRequest } from "@autosoccer/contracts";
import { createTestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { offlineManagerLlm } from "../apps/server/src/modules/agents/offline.ts";
import { managerRoundHook, seedManagers } from "../apps/server/src/modules/agents/service.ts";
import { DEFAULT_MATCH, type MatchModel, poisson, rng } from "../apps/server/src/modules/economy/model.ts";
import { overallRating } from "../apps/server/src/modules/league/attributes.ts";
import { ALL_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";

const arg = (n: string, d: string) =>
  process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d;
const CLUBS = Number(arg("clubs", "10"));
const SEASONS = Number(arg("seasons", "1"));
const SEED = Number(arg("seed", "20261127"));
const HALF = Number(arg("half", "0"));
const OUT = arg("out", "docs/platform/economy-surrogate.md");
// Offline stand-in managers, priced as the production model so the compute ledger behaves as live (no calls are made).
const MODEL = "claude-opus-5-5";

interface Obs {
  diff: number;
  home: number;
  away: number;
}

const t = await createTestDatabase();
const obs: Obs[] = [];
const t0 = performance.now();
try {
  const db = t.db;
  const teams = ALL_TEAMS.slice(0, CLUBS);
  await seedTeams(db, teams);
  const worker = createWorker({
    db,
    baseBackoffMs: 1,
    handlers: buildHandlers({
      db,
      store: new MemoryReplayStore(),
      llm: offlineManagerLlm(MODEL),
      ...(HALF ? { halfDurationSec: HALF } : {}),
    }),
  });
  const hook = managerRoundHook(db);
  for (let n = 1; n <= SEASONS; n++) {
    const { seasonId } = await createSeason(db, {
      slug: `season-${n}`,
      name: `Season ${n}`,
      seed: SEED + n,
      budgetPerTeamMicroUsd: 1_000_000,
      teamSlugs: teams.map((x) => x.slug),
      roundIntervalMinutes: 1,
      playersPerTeam: 7,
      financeRule: null,
    });
    await seedManagers(db, seasonId, MODEL);
    for (let i = 0; i < 4 * CLUBS; i++) {
      if ((await advanceSeason(db, seasonId, { beforeRound: hook })).state === "completed") break;
      await worker.drain();
    }
    await db`update seasons set status = 'completed', completed_at = coalesce(completed_at, now()) where id = ${seasonId}`;
    console.log(`season ${n}: ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  const rows = await db<{ request: MatchRequest; home_score: number; away_score: number }[]>`
    select request, home_score, away_score from matches where status = 'completed'`;
  const strength = (side: MatchRequest["home"]) =>
    side.starters.reduce((s, p) => s + (p.attributes ? overallRating(p.attributes, p.position) : 60), 0) /
    side.starters.length;
  for (const r of rows)
    obs.push({ diff: strength(r.request.home) - strength(r.request.away), home: r.home_score, away: r.away_score });
} finally {
  await t.drop();
}

// Fit the surrogate by maximum likelihood (grid search over the three parameters).
const logFact = (k: number) => {
  let s = 0;
  for (let i = 2; i <= k; i++) s += Math.log(i);
  return s;
};
const ll = (m: MatchModel) =>
  obs.reduce((s, o) => {
    const lh = m.goalsPerSide * Math.exp(m.homeAdvantage + m.strengthSlope * o.diff);
    const la = m.goalsPerSide * Math.exp(-m.strengthSlope * o.diff);
    return s + o.home * Math.log(lh) - lh - logFact(o.home) + o.away * Math.log(la) - la - logFact(o.away);
  }, 0);
let best: MatchModel = DEFAULT_MATCH;
let bestLl = Number.NEGATIVE_INFINITY;
for (let g = 0.6; g <= 2.2; g += 0.05)
  for (let h = -0.2; h <= 0.3; h += 0.02)
    for (let k = 0; k <= 0.16; k += 0.005) {
      const m = { goalsPerSide: g, homeAdvantage: h, strengthSlope: k };
      const v = ll(m);
      if (v > bestLl) {
        bestLl = v;
        best = m;
      }
    }

const describe = (games: Obs[]) => {
  const n = Math.max(1, games.length);
  const fav = games.filter((o) => Math.abs(o.diff) >= 1);
  return {
    matches: games.length,
    goalsPerMatch: games.reduce((s, o) => s + o.home + o.away, 0) / n,
    draws: games.filter((o) => o.home === o.away).length / n,
    homeWins: games.filter((o) => o.home > o.away).length / n,
    favouriteWins: fav.filter((o) => (o.diff > 0 ? o.home > o.away : o.away > o.home)).length / Math.max(1, fav.length),
  };
};
const simulate = (m: MatchModel) => {
  const rand = rng(SEED);
  const out: Obs[] = [];
  for (let rep = 0; rep < 50; rep++)
    for (const o of obs)
      out.push({
        diff: o.diff,
        home: poisson(rand, m.goalsPerSide * Math.exp(m.homeAdvantage + m.strengthSlope * o.diff)),
        away: poisson(rand, m.goalsPerSide * Math.exp(-m.strengthSlope * o.diff)),
      });
  return describe(out);
};
const real = describe(obs);
const fitted = simulate(best);
const current = simulate(DEFAULT_MATCH);
const f2 = (x: number) => x.toFixed(2);
const p = (x: number) => `${Math.round(x * 100)}%`;
const spread = obs.map((o) => Math.abs(o.diff)).sort((a, b) => a - b);
const lines = [
  "# Economy surrogate vs the real simulator (integrated mode)",
  "",
  `Generated by \`bun run economy:integrated ${process.argv.slice(2).join(" ")}\`: ${SEASONS} season(s) of ${CLUBS} clubs, 7-a-side, through the normal lifecycle (scheduler, offline managers, pinned simulator) on a throwaway database, ${HALF ? `${HALF}-second halves` : "production match length"}. ${obs.length} matches in ${((performance.now() - t0) / 1000).toFixed(0)} s.`,
  "",
  `Strength is the mean overall rating of each starting seven; the median gap between the sides was ${f2(spread[Math.floor(spread.length / 2)] ?? 0)} points (90th percentile ${f2(spread[Math.floor(spread.length * 0.9)] ?? 0)}).`,
  "",
  "| | Matches | Goals per match | Draws | Home wins | Favourite wins (gap ≥ 1) |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  `| Real simulator | ${real.matches} | ${f2(real.goalsPerMatch)} | ${p(real.draws)} | ${p(real.homeWins)} | ${p(real.favouriteWins)} |`,
  `| Surrogate, fitted | ${fitted.matches} | ${f2(fitted.goalsPerMatch)} | ${p(fitted.draws)} | ${p(fitted.homeWins)} | ${p(fitted.favouriteWins)} |`,
  `| Surrogate, current default | ${current.matches} | ${f2(current.goalsPerMatch)} | ${p(current.draws)} | ${p(current.homeWins)} | ${p(current.favouriteWins)} |`,
  "",
  `Fitted parameters (maximum likelihood): goals per side ${f2(best.goalsPerSide)}, home advantage ${f2(best.homeAdvantage)}, slope ${best.strengthSlope.toFixed(3)} per rating point. Current default: ${f2(DEFAULT_MATCH.goalsPerSide)}, ${f2(DEFAULT_MATCH.homeAdvantage)}, ${DEFAULT_MATCH.strengthSlope.toFixed(3)}.`,
  "",
  "Caveats: one small sample; the offline managers' tactics, not the LLMs'. The surrogate only sees squad strength, so tactical",
  "edges (the simulator rewards some setups strongly, see docs/research/sim-plausibility) show up as unexplained variance.",
  "",
];
writeFileSync(OUT, lines.join("\n"));
console.log(lines.join("\n"));
