/**
 * Harness reports: machine-readable JSON and CSV, and a readable markdown summary. Distributions
 * across seeds are reported as median with the 10th–90th percentile range.
 */
import { formatCredits } from "../finance/rules.ts";
import type { RunResult } from "./engine.ts";
import type { PolicyName } from "./model.ts";

export interface Group {
  ruleset: string;
  scenario: string;
  runs: RunResult[];
}

const q = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))]!;
};
const dist = (xs: number[], f: (n: number) => string = String) =>
  `${f(q(xs, 0.5))} (${f(q(xs, 0.1))} – ${f(q(xs, 0.9))})`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const fx = (n: number) => n.toFixed(2);

/** Aggregates one ruleset × scenario across seeds. */
export function summarise(g: Group) {
  const last = g.runs.map((r) => r.seasons.at(-1)!);
  const all = g.runs.flatMap((r) => r.seasons);
  const seasons = all.length;
  const titleShares = g.runs.map((r) => {
    const top = Math.max(...r.clubs.map((c) => c.titles));
    return top / r.seasons.length;
  });
  const distinct = g.runs.map((r) => r.clubs.filter((c) => c.titles > 0).length);
  const streak = g.runs.map((r) => {
    let best = 1;
    let cur = 1;
    for (let i = 1; i < r.seasons.length; i++) {
      cur = r.seasons[i]!.champion === r.seasons[i - 1]!.champion ? cur + 1 : 1;
      best = Math.max(best, cur);
    }
    return best;
  });
  const byPolicy = new Map<PolicyName, number[]>();
  for (const r of g.runs)
    for (const c of r.clubs) {
      if (!byPolicy.has(c.policy)) byPolicy.set(c.policy, []);
      byPolicy.get(c.policy)!.push(c.cash);
    }
  const titlesByPolicy = new Map<PolicyName, number>();
  for (const r of g.runs)
    for (const c of r.clubs) titlesByPolicy.set(c.policy, (titlesByPolicy.get(c.policy) ?? 0) + c.titles);
  const firstWage = g.runs.map((r) => r.seasons[0]!.avgWagePerRound);
  const lastWage = last.map((s) => s.avgWagePerRound);
  const fees = all.filter((s) => s.deals > 0).map((s) => s.avgFee);
  const flows = new Map<string, number>();
  for (const s of all) for (const [k, v] of Object.entries(s.flows)) flows.set(k, (flows.get(k) ?? 0) + v);
  const posCash = new Map<number, number[]>();
  for (const s of all)
    s.table.forEach((id, i) => {
      if (!posCash.has(i + 1)) posCash.set(i + 1, []);
      posCash.get(i + 1)!.push(s.cash[id]!);
    });
  return {
    ruleset: g.ruleset,
    scenario: g.scenario,
    seeds: g.runs.map((r) => r.config.seed),
    seasons,
    ms: g.runs.reduce((s, r) => s + r.ms, 0),
    failures: g.runs.flatMap((r) => r.failures),
    finalGini: last.map((s) => s.gini),
    finalTopQuarter: last.map((s) => s.topQuarterShare),
    finalTotalCash: last.map((s) => s.totalCash),
    minCash: g.runs.map((r) => Math.min(...r.seasons.flatMap((s) => Object.values(s.cash)))),
    withdrawals: all.reduce((s, x) => s + x.withdrawals, 0),
    takeovers: all.reduce((s, x) => s + x.takeovers, 0),
    takeoverCapital: all.reduce((s, x) => s + x.takeoverCapital, 0),
    defaults: all.reduce((s, x) => s + x.defaults, 0),
    forcedSales: all.reduce((s, x) => s + x.forcedSales, 0),
    emergencies: all.reduce((s, x) => s + x.emergencies, 0),
    administrations: all.reduce((s, x) => s + x.administrations, 0),
    recoveries: all.reduce((s, x) => s + x.recoveries, 0),
    borrowing: all.reduce((s, x) => s + x.borrowing, 0),
    finalDebt: last.map((s) => s.debt),
    recoverySeasons: g.runs.flatMap((r) => {
      const open = new Map<string, number>();
      const out: number[] = [];
      for (const e of r.events) {
        if (e.kind === "administration" && !open.has(e.club)) open.set(e.club, e.season);
        if (e.kind === "recovery" && open.has(e.club)) {
          out.push(e.season - open.get(e.club)! + 1);
          open.delete(e.club);
        }
      }
      return out;
    }),
    distressedSeasons: all.reduce((s, x) => s + x.distressed, 0),
    deals: all.reduce((s, x) => s + x.deals, 0),
    freeSignings: all.reduce((s, x) => s + x.freeSignings, 0),
    releases: all.reduce((s, x) => s + x.releases, 0),
    /** Gate 6: completed deals per club per window (median across runs). */
    dealsPerClubWindow: g.runs.map((r) => {
      // The first season has no preseason window (clubs are founded), only a midseason one if any.
      const windows = r.seasons.length - 1 + (r.config.windows === 2 ? r.seasons.length : 0);
      return r.seasons.reduce((n, s) => n + s.deals, 0) / Math.max(1, windows * r.config.clubs);
    }),
    bids: all.reduce((s, x) => s + x.market.bids, 0),
    accepted: all.reduce((s, x) => s + x.market.accepted, 0),
    failedDeals: all.reduce((s, x) => s + x.market.failed, 0),
    unavailable: all.reduce((s, x) => s + x.market.unavailable, 0),
    wageGrowth: g.runs.map((_, i) => lastWage[i]! / Math.max(1, firstWage[i]!)),
    avgFee: fees,
    retirements: all.reduce((s, x) => s + x.retirements, 0),
    newPlayers: all.reduce((s, x) => s + x.newPlayers, 0),
    squadMin: Math.min(...all.map((s) => s.squadMin)),
    squadMax: Math.max(...all.map((s) => s.squadMax)),
    avgOverallFirst: g.runs.map((r) => r.seasons[0]!.avgOverall),
    avgOverallLast: last.map((s) => s.avgOverall),
    titleShare: titleShares,
    distinctChampions: distinct,
    longestStreak: streak,
    mobility: all.filter((s) => s.mobility !== null).map((s) => s.mobility!),
    cashByPolicy: Object.fromEntries([...byPolicy].map(([k, v]) => [k, v])),
    titlesByPolicy: Object.fromEntries(titlesByPolicy),
    flows: Object.fromEntries(flows),
    cashByPosition: Object.fromEntries([...posCash].map(([k, v]) => [k, q(v, 0.5)])),
  };
}

export type Summary = ReturnType<typeof summarise>;

export function markdown(
  summaries: Summary[],
  meta: { command: string; clubs: number; seasons: number; seeds: number[] },
) {
  const cr = formatCredits;
  const lines: string[] = [];
  lines.push("# Economy balance report (fast mode)", "");
  lines.push(
    `Generated by \`${meta.command}\`: ${meta.clubs} clubs, ${meta.seasons} seasons per run, seeds ${meta.seeds.join(", ")}.`,
    "Credits (Ȼ) are fictional. Fast mode: production finance, wage, transfer-guide, squad, ageing and insolvency rules;",
    "synthetic results (Poisson on starting-side strength) and deterministic policy managers. No database, simulator or model calls.",
    "Medians across seeds, with the 10th–90th percentile range in brackets.",
    "",
  );
  lines.push("## Hard invariants", "");
  lines.push("| Ruleset | Scenario | Seasons run | Failures | Throughput |", "| --- | --- | ---: | ---: | ---: |");
  for (const s of summaries)
    lines.push(
      `| ${s.ruleset} | ${s.scenario} | ${s.seasons} | ${s.failures.length} | ${Math.round(s.seasons / Math.max(0.001, s.ms / 1000))} seasons/s |`,
    );
  const failures = summaries.flatMap((s) => s.failures);
  if (failures.length) {
    lines.push("", "Failures (first 20; replay with `--replay <seed>`):", "");
    const byKind = new Map<string, number>();
    for (const f of failures)
      byKind.set(
        `${f.ruleset}/${f.scenario}/${f.invariant}`,
        (byKind.get(`${f.ruleset}/${f.scenario}/${f.invariant}`) ?? 0) + 1,
      );
    for (const [k, n] of byKind) lines.push(`- ${k}: ${n}`);
    lines.push("");
    for (const f of failures.slice(0, 20))
      lines.push(`- seed ${f.seed}, season ${f.season}, ${f.ruleset}/${f.scenario}: **${f.invariant}**: ${f.detail}`);
  }
  lines.push("", "## Money", "");
  lines.push(
    "| Ruleset | Scenario | Final Gini | Richest quarter's share | League cash at end | Lowest club cash seen | Wage growth (avg per round, last ÷ first) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const s of summaries)
    lines.push(
      `| ${s.ruleset} | ${s.scenario} | ${dist(s.finalGini, fx)} | ${dist(s.finalTopQuarter, pct)} | ${dist(s.finalTotalCash, cr)} | ${dist(s.minCash, cr)} | ${dist(s.wageGrowth, fx)} |`,
    );
  lines.push("", "### Sources and sinks, all seasons and seeds", "");
  const kinds = [...new Set(summaries.flatMap((s) => Object.keys(s.flows)))].sort();
  lines.push(`| Ruleset | Scenario | ${kinds.join(" | ")} |`, `| --- | --- | ${kinds.map(() => "---:").join(" | ")} |`);
  for (const s of summaries)
    lines.push(`| ${s.ruleset} | ${s.scenario} | ${kinds.map((k) => cr(s.flows[k] ?? 0)).join(" | ")} |`);
  lines.push("", "### Cash by strategy at the end of each run (median per club)", "");
  const pols = [...new Set(summaries.flatMap((s) => Object.keys(s.cashByPolicy)))].sort();
  lines.push(`| Ruleset | Scenario | ${pols.join(" | ")} |`, `| --- | --- | ${pols.map(() => "---:").join(" | ")} |`);
  for (const s of summaries)
    lines.push(
      `| ${s.ruleset} | ${s.scenario} | ${pols.map((p) => (s.cashByPolicy[p] ? `${cr(q(s.cashByPolicy[p]!, 0.5))} · ${s.titlesByPolicy[p] ?? 0} titles` : "–")).join(" | ")} |`,
    );
  lines.push("", "### Cash by final position (median at season end)", "");
  const positions = Object.keys(summaries[0]?.cashByPosition ?? {}).map(Number);
  const show = positions.filter((p) => p <= 3 || p === Math.ceil(positions.length / 2) || p >= positions.length - 1);
  lines.push(
    `| Ruleset | Scenario | ${show.map((p) => `#${p}`).join(" | ")} |`,
    `| --- | --- | ${show.map(() => "---:").join(" | ")} |`,
  );
  for (const s of summaries)
    lines.push(`| ${s.ruleset} | ${s.scenario} | ${show.map((p) => cr(s.cashByPosition[p] ?? 0)).join(" | ")} |`);
  lines.push("", "## Distress", "");
  lines.push(
    "| Ruleset | Scenario | Withdrawals (forfeits) | Takeovers | Free takeover capital | Emergency loans | Defaults | Forced sales | Administrations | Recoveries | Seasons to recover | Debt at end | Secured borrowing | Club-seasons in distress |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: |",
  );
  for (const s of summaries)
    lines.push(
      `| ${s.ruleset} | ${s.scenario} | ${s.withdrawals} | ${s.takeovers} | ${cr(s.takeoverCapital)} | ${s.emergencies} | ${s.defaults} | ${s.forcedSales} | ${s.administrations} | ${s.recoveries} | ${s.recoverySeasons.length ? dist(s.recoverySeasons) : "–"} | ${dist(s.finalDebt, cr)} | ${cr(s.borrowing)} | ${s.distressedSeasons} |`,
    );
  lines.push("", "## Market and players", "");
  lines.push(
    "| Ruleset | Scenario | Bids | Accepted | Deals | Free signings | Releases | Deals per club per window | Fell through | Manager unavailable | Avg fee | Retirements | New players | Squad sizes | Avg overall first → last |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | --- | --- |",
  );
  for (const s of summaries)
    lines.push(
      `| ${s.ruleset} | ${s.scenario} | ${s.bids} | ${s.accepted} | ${s.deals} | ${s.freeSignings} | ${s.releases} | ${dist(s.dealsPerClubWindow, fx)} | ${s.failedDeals} | ${s.unavailable} | ${dist(s.avgFee, cr)} | ${s.retirements} | ${s.newPlayers} | ${s.squadMin}–${s.squadMax} | ${dist(s.avgOverallFirst)} → ${dist(s.avgOverallLast)} |`,
    );
  lines.push("", "## Competition", "");
  lines.push(
    "| Ruleset | Scenario | Most titles by one club (share of seasons) | Distinct champions per run | Longest title streak | Position mobility (Spearman, season to season) |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const s of summaries)
    lines.push(
      `| ${s.ruleset} | ${s.scenario} | ${dist(s.titleShare, pct)} | ${dist(s.distinctChampions)} | ${dist(s.longestStreak)} | ${dist(s.mobility, fx)} |`,
    );
  lines.push("");
  return lines.join("\n");
}

/** One CSV row per run per season. */
export function csv(groups: Group[]): string {
  const head = [
    "ruleset",
    "scenario",
    "seed",
    "season",
    "champion",
    "total_cash",
    "gini",
    "top_quarter_share",
    "avg_wage",
    "deals",
    "fees",
    "withdrawals",
    "takeovers",
    "defaults",
    "forced_sales",
    "distressed",
    "debt",
    "retirements",
    "new_players",
    "unattached",
    "squad_min",
    "squad_max",
    "avg_overall",
    "mobility",
  ];
  const rows = [head.join(",")];
  for (const g of groups)
    for (const r of g.runs)
      for (const s of r.seasons)
        rows.push(
          [
            g.ruleset,
            g.scenario,
            r.config.seed,
            s.season,
            s.champion,
            s.totalCash,
            s.gini,
            s.topQuarterShare,
            s.avgWagePerRound,
            s.deals,
            s.fees,
            s.withdrawals,
            s.takeovers,
            s.defaults,
            s.forcedSales,
            s.distressed,
            s.debt,
            s.retirements,
            s.newPlayers,
            s.unattached,
            s.squadMin,
            s.squadMax,
            s.avgOverall,
            s.mobility ?? "",
          ].join(","),
        );
  return `${rows.join("\n")}\n`;
}
