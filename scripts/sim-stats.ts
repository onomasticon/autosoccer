/**
 * Statistical plausibility study of the pinned simulator: plays many seeded headless matches
 * through the same adapter the league uses (production match config), cycling through tactical
 * presets, and records per-match outcomes. Read-only research: it never touches the database
 * or any official result.
 *
 *   bun scripts/sim-stats.ts play --matches 1200 [--start-seed 1] [--shard 0/4] [--players 5|7] --out out/sim-stats
 *   bun scripts/sim-stats.ts report --out out/sim-stats      # aggregates every shard → report.md + summary.json
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultTactics, type TacticalConfigV1, type TeamSize } from "@autosoccer/contracts";
import { MemoryReplayStore, runMatch, SIM_VERSION } from "@autosoccer/sim-adapter";
import { openingTactics, SEED_MANAGERS } from "../apps/server/src/modules/agents/managers-seed.ts";
import { sampleRequest } from "../packages/sim-adapter/src/testing.ts";

const args = process.argv.slice(2);
const cmd = args[0] ?? "play";
const opt = (n: string, d: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1]! : d);
const out = opt("out", "out/sim-stats");
mkdirSync(out, { recursive: true });

const players: TeamSize = opt("players", "5") === "7" ? 7 : 5;
/** The four clubs' opening setups plus the league baseline, for the team size. */
const PRESETS: Array<{ name: string; config: TacticalConfigV1 }> = [
  ...SEED_MANAGERS.map((m) => ({ name: m.teamSlug, config: openingTactics(m, players) })),
  { name: "baseline", config: defaultTactics(players) },
];
const PAIRS = PRESETS.flatMap((h) => PRESETS.map((a) => [h, a] as const));

interface Row {
  seed: number;
  home: string;
  away: string;
  hg: number;
  ag: number;
  hShots: number;
  aShots: number;
  hSot: number;
  aSot: number;
  ownGoals: number;
  hPoss: number;
  hFouls: number;
  aFouls: number;
  hash: string;
}

if (cmd === "play") {
  const total = Number(opt("matches", "1200"));
  const start = Number(opt("start-seed", "1"));
  const [shard, shards] = opt("shard", "0/1").split("/").map(Number) as [number, number];
  const file = join(out, `matches-${shard}.jsonl`);
  writeFileSync(file, "");
  const dep = (config: TacticalConfigV1) => ({ kind: "tactical" as const, schemaVersion: "tactics/1", config });
  for (let i = shard; i < total; i += shards) {
    const seed = start + i;
    const [h, a] = PAIRS[i % PAIRS.length]!;
    const req = sampleRequest({ seed, config: players === 7 ? { playersPerTeam: 7 } : {} }); // production match config
    req.home.deployment = dep(h.config);
    req.away.deployment = dep(a.config);
    const r = (await runMatch(req, { store: new MemoryReplayStore() })).result;
    const goals = r.events.filter((e) => e.type === "goal");
    const row: Row = {
      seed,
      home: h.name,
      away: a.name,
      hg: r.score.home,
      ag: r.score.away,
      hShots: r.stats.home.shots,
      aShots: r.stats.away.shots,
      hSot: r.stats.home.shotsOnTarget,
      aSot: r.stats.away.shotsOnTarget,
      ownGoals: goals.filter((g) => g.type === "goal" && g.ownGoal).length,
      hPoss: r.stats.home.possession,
      hFouls: r.stats.home.fouls,
      aFouls: r.stats.away.fouls,
      hash: r.finalHash,
    };
    appendFileSync(file, `${JSON.stringify(row)}\n`);
  }
  console.log(`shard ${shard}/${shards} done`);
} else if (cmd === "report") {
  const rows: Row[] = readdirSync(out)
    .filter((f) => f.startsWith("matches-") && f.endsWith(".jsonl"))
    .flatMap((f) =>
      readFileSync(join(out, f), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Row),
    )
    .sort((a, b) => a.seed - b.seed);
  const n = rows.length;
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
  const mean = (f: (r: Row) => number) => sum(f) / n;
  const sd = (f: (r: Row) => number) => {
    const m = mean(f);
    return Math.sqrt(rows.reduce((s, r) => s + (f(r) - m) ** 2, 0) / n);
  };
  const pctOf = (k: number, d: number) => (d ? `${((100 * k) / d).toFixed(1)}%` : "–");
  const goals = sum((r) => r.hg + r.ag);
  const shots = sum((r) => r.hShots + r.aShots);
  const sot = sum((r) => r.hSot + r.aSot);
  const own = sum((r) => r.ownGoals);
  const draws = rows.filter((r) => r.hg === r.ag).length;
  const homeWins = rows.filter((r) => r.hg > r.ag).length;
  const allOnTarget = rows.filter((r) => r.hSot === r.hShots && r.aSot === r.aShots).length;
  const withShots = rows.filter((r) => r.hShots + r.aShots > 0).length;
  const nilNil = rows.filter((r) => r.hg + r.ag === 0).length;
  const hist = new Map<number, number>();
  for (const r of rows) hist.set(r.hg + r.ag, (hist.get(r.hg + r.ag) ?? 0) + 1);
  const possHist = new Map<string, number>();
  for (const r of rows) {
    const b = `${Math.floor(r.hPoss * 10) * 10}–${Math.floor(r.hPoss * 10) * 10 + 10}%`;
    possHist.set(b, (possHist.get(b) ?? 0) + 1);
  }
  // Does the side with more of the ball win more often?
  const decided = rows.filter((r) => r.hg !== r.ag && Math.abs(r.hPoss - 0.5) > 0.005);
  const moreBallWins = decided.filter((r) => r.hg > r.ag === r.hPoss > 0.5).length;
  // Per preset (as either side)
  const presetStats = PRESETS.map((p) => {
    const ms = rows.flatMap((r) => [
      ...(r.home === p.name ? [{ gf: r.hg, ga: r.ag, sh: r.hShots, poss: r.hPoss }] : []),
      ...(r.away === p.name ? [{ gf: r.ag, ga: r.hg, sh: r.aShots, poss: 1 - r.hPoss }] : []),
    ]);
    const k = ms.length;
    const w = ms.filter((m) => m.gf > m.ga).length;
    const d = ms.filter((m) => m.gf === m.ga).length;
    return {
      preset: p.name,
      appearances: k,
      winRate: w / k,
      drawRate: d / k,
      goalsFor: ms.reduce((s, m) => s + m.gf, 0) / k,
      goalsAgainst: ms.reduce((s, m) => s + m.ga, 0) / k,
      shots: ms.reduce((s, m) => s + m.sh, 0) / k,
      possession: ms.reduce((s, m) => s + m.poss, 0) / k,
    };
  });
  const summary = {
    simVersion: SIM_VERSION,
    matches: n,
    seedRange: [rows[0]?.seed, rows.at(-1)?.seed],
    goalsPerMatch: goals / n,
    goalsPerMatchSd: sd((r) => r.hg + r.ag),
    shotsPerMatch: shots / n,
    shotsOnTargetRate: sot / shots,
    matchesWhereEveryShotWasOnTarget: allOnTarget,
    matchesWithAtLeastOneShot: withShots,
    goalsPerShotOnTarget: goals / sot,
    ownGoals: own,
    ownGoalShareOfGoals: own / goals,
    matchesWithAnOwnGoal: rows.filter((r) => r.ownGoals > 0).length,
    drawRate: draws / n,
    nilNilRate: nilNil / n,
    homeWinRate: homeWins / n,
    awayWinRate: (n - homeWins - draws) / n,
    homePossessionMean: mean((r) => r.hPoss),
    homePossessionSd: sd((r) => r.hPoss),
    moreBallSideWinsDecidedMatches: moreBallWins / decided.length,
    foulsPerMatch: mean((r) => r.hFouls + r.aFouls),
    goalHistogram: Object.fromEntries([...hist].sort((a, b) => a[0] - b[0])),
    homePossessionHistogram: Object.fromEntries([...possHist].sort()),
    presets: presetStats,
  };
  writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const f2 = (x: number) => x.toFixed(2);
  const md = [
    `matches: ${n} (seeds ${summary.seedRange[0]}–${summary.seedRange[1]}), simulator ${SIM_VERSION}`,
    `goals/match ${f2(summary.goalsPerMatch)} (sd ${f2(summary.goalsPerMatchSd)}) · 0–0 ${pctOf(nilNil, n)} · draws ${pctOf(draws, n)} · home ${pctOf(homeWins, n)} · away ${pctOf(n - homeWins - draws, n)}`,
    `shots/match ${f2(summary.shotsPerMatch)} · on target ${pctOf(sot, shots)} · every shot on target in ${allOnTarget}/${withShots} matches with a shot · goals per shot on target ${f2(summary.goalsPerShotOnTarget)}`,
    `own goals ${own} = ${pctOf(own, goals)} of goals · matches with an own goal ${pctOf(summary.matchesWithAnOwnGoal, n)}`,
    `home possession mean ${pctOf(summary.homePossessionMean, 1)} sd ${f2(summary.homePossessionSd * 100)} pts · side with more of the ball wins ${pctOf(moreBallWins, decided.length)} of decided matches`,
    `goals histogram ${JSON.stringify(summary.goalHistogram)}`,
    "preset            apps  win   draw  GF    GA    shots poss",
    ...presetStats.map(
      (p) =>
        `${p.preset.padEnd(18)}${String(p.appearances).padStart(4)}  ${pctOf(p.winRate, 1).padStart(5)} ${pctOf(p.drawRate, 1).padStart(5)} ${f2(p.goalsFor).padStart(5)} ${f2(p.goalsAgainst).padStart(5)} ${f2(p.shots).padStart(5)} ${pctOf(p.possession, 1)}`,
    ),
  ].join("\n");
  writeFileSync(join(out, "summary.txt"), `${md}\n`);
  console.log(md);
} else throw new Error(`unknown command ${cmd}`);
