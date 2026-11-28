/**
 * The pilot's evidence report (#101), from out/pilot/calls.jsonl (every model call) and the pilot
 * database: spend, tokens, latency, repairs and failures per model; founding, recruitment, the
 * season(s), the lender and rollover; and a spend projection from what was measured.
 *
 *   DATABASE_URL=postgres://…/autosoccer_pilot bun scripts/phase2-pilot-report.ts
 *
 * Writes out/pilot/report.json and out/pilot/report.md. Read-only against the database.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createDb } from "@autosoccer/db";
import { clubDebt } from "../apps/server/src/modules/finance/read.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/pilot/.test(new URL(url).pathname)) {
  console.error("refusing: DATABASE_URL must name a pilot database");
  process.exit(2);
}
const OUT = process.env.PILOT_OUT ?? "out/pilot";
type Call = {
  at: string;
  model: string;
  task: string;
  ok: boolean;
  ms: number;
  in?: number;
  out?: number;
  usd: number;
  attempts?: number;
  repairs?: number;
  fixes?: string[];
  error?: string;
};
const calls: Call[] = existsSync(`${OUT}/calls.jsonl`)
  ? readFileSync(`${OUT}/calls.jsonl`, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  : [];
const stop = existsSync(`${OUT}/stop.json`) ? JSON.parse(readFileSync(`${OUT}/stop.json`, "utf8")) : null;
const q = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const usd = (x: number) => `$${x.toFixed(x < 1 ? 3 : 2)}`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const byModel = [...new Set(calls.map((c) => c.model))].sort().map((model) => {
  const cs = calls.filter((c) => c.model === model);
  const ok = cs.filter((c) => c.ok);
  return {
    model,
    calls: cs.length,
    failed: cs.length - ok.length,
    repairs: sum(ok.map((c) => c.repairs ?? 0)),
    fixes: sum(ok.map((c) => c.fixes?.length ?? 0)),
    p50s: q(
      ok.map((c) => c.ms),
      0.5,
    ),
    p95s: q(
      ok.map((c) => c.ms),
      0.95,
    ),
    inTok: sum(ok.map((c) => c.in ?? 0)),
    outTok: sum(ok.map((c) => c.out ?? 0)),
    usd: sum(cs.map((c) => c.usd)),
    errors: [...new Set(cs.filter((c) => !c.ok).map((c) => (c.error ?? "").slice(0, 120)))].slice(0, 3),
  };
});
const byTask = [...new Set(calls.map((c) => c.task))].sort().map((task) => {
  const cs = calls.filter((c) => c.task === task);
  return { task, calls: cs.length, failed: cs.filter((c) => !c.ok).length, usd: sum(cs.map((c) => c.usd)) };
});

const db = createDb(url, { max: 2 });
const [league] = await db<
  { id: string; slug: string; status: string }[]
>`select id, slug, status from leagues where slug = 'pilot'`;
if (!league) throw new Error("no pilot league in this database");
const founders = await db<{ model: string; status: string; rounds: number; team: string | null }[]>`
  select f.model, f.status, f.rounds, t.name as team from founders f left join teams t on t.id = f.team_id
  where f.league_id = ${league.id} order by f.model`;
const seasons = await db<{ id: string; slug: string; status: string; rounds: number; played: number }[]>`
  select s.id, s.slug, s.status,
    (select coalesce(max(round), 0)::int from fixtures where season_id = s.id) as rounds,
    (select count(*)::int from fixtures where season_id = s.id and status = 'completed') as played
  from seasons s where s.league_id = ${league.id} order by s.created_at`;
const windows = await db<{ season: string; kind: string; round: number; phase: string; summary: unknown }[]>`
  select s.slug as season, w.kind, w.round, w.phase, w.summary from market_windows w join seasons s on s.id = w.season_id
  where s.league_id = ${league.id} order by w.opens_at, w.round`;
const runs = await db<{ season: string; purpose: string; status: string; n: number; usd: number }[]>`
  select s.slug as season, r.purpose, r.status, count(*)::int as n, (sum(r.cost_micro_usd) / 1e6)::float as usd
  from agent_runs r join seasons s on s.id = r.season_id where s.league_id = ${league.id}
  group by 1, 2, 3 order by 1, 2, 3`;
const decisions = await db<{ source: string; decision: string; n: number }[]>`
  select d.source, d.decision, count(*)::int as n from contract_decisions d
  join market_windows w on w.id = d.window_id join seasons s on s.id = w.season_id
  where s.league_id = ${league.id} group by 1, 2 order by 1, 2`;
const contracts = await db<{ via: string; n: number }[]>`
  select c.via, count(*)::int as n from player_contracts c join seasons s on s.id = c.season_id
  where s.league_id = ${league.id} group by 1 order by 1`;
const lender = await db<{ season: string; outcome: string; n: number }[]>`
  select s.slug as season, l.outcome, count(*)::int as n from lender_checks l join seasons s on s.id = l.season_id
  where s.league_id = ${league.id} group by 1, 2 order by 1, 2`;
const loans = await db<{ kind: string; n: number; principal: number }[]>`
  select l.kind, count(*)::int as n, (sum(l.principal) / 1e6)::float as principal from club_loans l
  join seasons s on s.id = l.season_id where s.league_id = ${league.id} group by 1 order by 1`;
const [admin] = await db<{ entered: number; exited: number; auctions: number; sold: number }[]>`
  select (select count(*)::int from administrations a join seasons s on s.id = a.entered_season_id where s.league_id = ${league.id}) as entered,
    (select count(*)::int from administrations a join seasons s on s.id = a.entered_season_id where s.league_id = ${league.id} and a.exited_season_id is not null) as exited,
    (select count(*)::int from collateral_auctions a join seasons s on s.id = a.season_id where s.league_id = ${league.id}) as auctions,
    (select count(*)::int from collateral_auctions a join seasons s on s.id = a.season_id where s.league_id = ${league.id} and a.winner_team_id is not null) as sold`;
const rollovers = await db<{ round: number; status: string; summary: unknown }[]>`
  select round, status, summary from league_phases where league_id = ${league.id} and kind = 'rollover' order by round`;
const net = await db<{ summary: { assigned?: number; clubs?: string[] } }[]>`
  select summary from league_phases where league_id = ${league.id} and kind = 'safety_net'`;
// The table, from official results (3 points a win).
const table = async (seasonId: string) =>
  db<{ team: string; model: string | null; p: number; pts: number; gd: number }[]>`
    with r as (
      select f.home_team_id as team, m.home_score as gf, m.away_score as ga from fixtures f join matches m on m.fixture_id = f.id
        where f.season_id = ${seasonId} and f.status = 'completed'
      union all
      select f.away_team_id, m.away_score, m.home_score from fixtures f join matches m on m.fixture_id = f.id
        where f.season_id = ${seasonId} and f.status = 'completed')
    select t.name as team, ma.model, count(*)::int as p,
      sum(case when gf > ga then 3 when gf = ga then 1 else 0 end)::int as pts, sum(gf - ga)::int as gd
    from r join teams t on t.id = r.team left join manager_agents ma on ma.team_id = t.id
    group by t.name, ma.model order by pts desc, gd desc, t.name`;
const tables = Object.fromEntries(await Promise.all(seasons.map(async (s) => [s.slug, await table(s.id)] as const)));
const cash = await db<{ id: string; team: string; model: string | null; cash: number }[]>`
  select t.id, t.name as team, ma.model, (sum(l.amount) / 1e6)::float as cash
  from club_ledger l join teams t on t.id = l.team_id left join manager_agents ma on ma.team_id = t.id
  where t.id in (select team_id from founders where league_id = ${league.id} and team_id is not null)
  group by t.id, t.name, ma.model order by cash desc`;
const debts = new Map(
  await Promise.all(cash.map(async (c) => [c.id, ((await clubDebt(db, c.id))?.total ?? 0) / 1e6] as const)),
);
await db.end();

const total = sum(calls.map((c) => c.usd));
/** Billed tokens of answered calls (measured), and the meter's allowance for failed ones (estimated). */
const measured = sum(calls.filter((c) => c.ok).map((c) => c.usd));
const refusals = calls.filter((c) => !c.ok && /HTTP 4(?!08)\d\d/.test(c.error ?? "")).length;
const completed = seasons.filter((s) => s.status === "completed");
const seasonCalls = calls.filter((c) => !c.task.startsWith("founding"));
const perSeason = completed.length ? sum(seasonCalls.map((c) => c.usd)) / completed.length : null;
const report = {
  generated: new Date().toISOString(),
  live: !calls.some((c) => c.model.startsWith("offline")) && calls.length > 0,
  stop,
  totalUsd: total,
  measuredUsd: measured,
  estimatedFailedUsd: total - measured,
  providerRefusals: refusals,
  calls: calls.length,
  failedCalls: calls.filter((c) => !c.ok).length,
  byModel,
  byTask,
  founders,
  seasons,
  windows,
  runs,
  decisions,
  contracts,
  lender,
  loans,
  administration: admin,
  rollovers,
  safetyNet: net[0]?.summary ?? null,
  tables,
  cash: cash.map((c) => ({ ...c, debt: debts.get(c.id) ?? 0 })),
  projection: perSeason == null ? null : { perSeasonUsd: perSeason, per30DaysUsd: (perSeason * 30) / 23 },
};
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

const md: string[] = [];
md.push(`# Pilot report (${report.live ? "LIVE" : "offline rehearsal"}), ${report.generated}`, "");
md.push(
  `- Stopped: ${stop?.stopReason ?? "completed"}; metered ${usd(total)} of a ${usd(stop?.capUsd ?? 0)} cap: **${usd(measured)} measured** (answered calls) and ${usd(total - measured)} allowed for failed calls. ${calls.length} calls, ${report.failedCalls} failed, of which ${refusals} were provider refusals.`,
);
md.push(`- Seasons: ${seasons.map((s) => `${s.slug} ${s.status} (${s.played}/${s.rounds * 10} played)`).join("; ")}`);
if (report.projection)
  md.push(
    `- Measured spend per completed season (managers only): ${usd(report.projection.perSeasonUsd)}; about ${usd(report.projection.per30DaysUsd)} per 30 days at 23-day seasons.`,
  );
md.push(
  "",
  "## Per model",
  "",
  "| Model | Calls | Failed | Repairs | Fixes | p50 | p95 | Tokens in/out | Cost |",
  "|---|--:|--:|--:|--:|--:|--:|--:|--:|",
);
for (const m of byModel)
  md.push(
    `| \`${m.model}\` | ${m.calls} | ${m.failed} | ${m.repairs} | ${m.fixes} | ${(m.p50s / 1000).toFixed(1)} s | ${(m.p95s / 1000).toFixed(1)} s | ${m.inTok.toLocaleString()} / ${m.outTok.toLocaleString()} | ${usd(m.usd)} |`,
  );
md.push("", "## Per task", "", "| Task | Calls | Failed | Cost |", "|---|--:|--:|--:|");
for (const t of byTask) md.push(`| ${t.task} | ${t.calls} | ${t.failed} | ${usd(t.usd)} |`);
md.push("", "## Founding", "");
md.push(
  `${founders.filter((f) => f.status === "founded").length} of ${founders.length} founded; rounds needed: ${founders.map((f) => f.rounds).join(", ")}.`,
);
for (const f of founders.filter((f) => f.status !== "founded"))
  md.push(`- \`${f.model}\`: ${f.status} after ${f.rounds} rounds`);
md.push("", "## Market windows", "");
for (const w of windows) md.push(`- ${w.season} ${w.kind} ${w.round}: ${w.phase} ${JSON.stringify(w.summary)}`);
md.push(`- Safety net: ${JSON.stringify(report.safetyNet)}`);
md.push(`- Contract decisions: ${decisions.map((d) => `${d.decision} by ${d.source} ${d.n}`).join(", ") || "none"}`);
md.push(`- Contracts signed: ${contracts.map((c) => `${c.via} ${c.n}`).join(", ")}`);
md.push("", "## Manager runs", "", "| Season | Purpose | Status | Runs | Cost |", "|---|---|---|--:|--:|");
for (const r of runs) md.push(`| ${r.season} | ${r.purpose} | ${r.status} | ${r.n} | ${usd(r.usd)} |`);
md.push("", "## Money", "");
md.push(`- Lender checks: ${lender.map((l) => `${l.season} ${l.outcome} ${l.n}`).join(", ")}`);
md.push(`- Loans: ${loans.map((l) => `${l.kind} ×${l.n} (Ȼ${l.principal.toFixed(1)}m)`).join(", ") || "none"}`);
md.push(
  `- Administration: ${admin!.entered} entered, ${admin!.exited} exited; forced auctions ${admin!.auctions} (${admin!.sold} sold)`,
);
md.push("", "| Club | Model | Cash | Debt |", "|---|---|--:|--:|");
for (const c of cash)
  md.push(`| ${c.team} | \`${c.model}\` | Ȼ${c.cash.toFixed(2)}m | Ȼ${(debts.get(c.id) ?? 0).toFixed(2)}m |`);
md.push("", "## Rollover", "");
for (const r of rollovers) md.push(`- Season ${r.round}: ${r.status} ${JSON.stringify(r.summary)}`);
for (const [slug, rows] of Object.entries(tables)) {
  md.push("", `## Table: ${slug}`, "", "| # | Club | Model | P | Pts | GD |", "|--:|---|---|--:|--:|--:|");
  for (const [i, r] of rows.entries())
    md.push(`| ${i + 1} | ${r.team} | \`${r.model}\` | ${r.p} | ${r.pts} | ${r.gd} |`);
}
writeFileSync(`${OUT}/report.md`, `${md.join("\n")}\n`);
console.log(md.slice(0, 6).join("\n"));
