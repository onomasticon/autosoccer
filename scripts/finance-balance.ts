/**
 * Club finance balance exercise (finance/1, transfer/1, insolvency/1): plays several seasons on a
 * fresh, throwaway database through the normal lifecycle (offline AI managers, rollover, a transfer
 * window before every season after the first, payroll checks before every round) and reports how
 * money moved: earnings by source, wages, transfer activity, cash after each season, titles, and
 * bankruptcies and rescues. Deterministic for a seed.
 *
 *   bun run finance:balance [--seasons 4] [--seed 20261125] [--out docs/platform/finance-balance.md]
 *
 * Assumptions: offline managers (deterministic stand-ins for the LLM managers, see
 * transfers/offline.ts for their market rules), 7-a-side, the seed clubs and squads, every player on
 * the books paid every round.
 */
import { writeFileSync } from "node:fs";
import { createTestDatabase } from "@autosoccer/db/testing";
import { MemoryReplayStore } from "@autosoccer/sim-adapter";
import { buildHandlers } from "../apps/server/src/jobs/handlers.ts";
import { createWorker } from "../apps/server/src/jobs/worker.ts";
import { offlineManagerLlm } from "../apps/server/src/modules/agents/offline.ts";
import { managerRoundHook, seedManagers } from "../apps/server/src/modules/agents/service.ts";
import { formatCredits, RULES } from "../apps/server/src/modules/finance/rules.ts";
import { standingRows } from "../apps/server/src/modules/league/read.ts";
import { rolloverSeason } from "../apps/server/src/modules/league/rollover.ts";
import { SEED_TEAMS } from "../apps/server/src/modules/league/seed-data.ts";
import { advanceSeason, createSeason, seedTeams } from "../apps/server/src/modules/league/service.ts";
import { INSOLVENCY } from "../apps/server/src/modules/insolvency/rules.ts";
import { TRANSFER } from "../apps/server/src/modules/transfers/rules.ts";
import { tickTransfers } from "../apps/server/src/modules/transfers/window.ts";

const arg = (n: string, d: string) =>
  process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d;
const SEASONS = Number(arg("seasons", "4"));
const SEED = Number(arg("seed", "20261125"));
const OUT = arg("out", "docs/platform/finance-balance.md");
const MODEL = "claude-opus-5-5";

const t = await createTestDatabase();
try {
  const db = t.db;
  await seedTeams(db);
  // Stable player ids: rating development's seasonal ±1 is seeded from the player's id (develop/1),
  // and ids are otherwise random per database, so without this two runs diverge after Season 1.
  // (UUID v4-shaped, so the contracts accept them.)
  await db`
    update players p set id = (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8'
      || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
    from (select p2.id as old, md5('balance:' || t.slug || ':' || p2.shirt_number) as h
          from players p2 join teams t on t.id = p2.team_id) k
    where p.id = k.old`;
  let { seasonId } = await createSeason(db, {
    slug: "season-1",
    name: "Season 1",
    seed: SEED,
    budgetPerTeamMicroUsd: 1_000_000,
    teamSlugs: SEED_TEAMS.map((x) => x.slug),
    startsAt: new Date("2026-11-15T12:00:00Z"),
    roundIntervalMinutes: 240,
    playersPerTeam: 7,
  });
  await seedManagers(db, seasonId, MODEL);
  const worker = createWorker({
    db,
    baseBackoffMs: 1,
    handlers: buildHandlers({ db, store: new MemoryReplayStore(), llm: offlineManagerLlm(MODEL), halfDurationSec: 30 }),
  });
  const hook = managerRoundHook(db);
  const cash: Array<Record<string, number>> = [];
  const champions: string[] = [];
  for (let n = 1; n <= SEASONS; n++) {
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      if ((await advanceSeason(db, seasonId, { beforeRound: hook })).state === "completed") break;
      await worker.drain();
    }
    const { rows } = await standingRows(db, seasonId);
    champions.push(rows[0]!.team.name);
    const bal = await db<{ name: string; b: string }[]>`
      select t.name, sum(l.amount)::text as b from club_ledger l join teams t on t.id = l.team_id group by t.name`;
    cash.push(Object.fromEntries(bal.map((r) => [r.name, Number(r.b)])));
    console.log(`season ${n}: champion ${rows[0]!.team.name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    if (n < SEASONS) {
      const slug = await rolloverSeason(db, { managerModel: MODEL, editorialModel: MODEL });
      seasonId = (await db<{ id: string }[]>`select id from seasons where slug = ${slug}`)[0]!.id;
      // The transfer window: scheduler ticks and the worker until every manager has answered and
      // the deals have settled.
      for (let i = 0; i < 20; i++) {
        const [w] = await db<{ phase: string }[]>`select phase from transfer_windows where season_id = ${seasonId}`;
        if (!w || w.phase === "closed") break;
        await tickTransfers(db);
        await worker.drain();
      }
    }
  }
  const deals = await db<
    {
      season: string;
      player: string;
      seller: string;
      buyer: string;
      fee: string;
      status: string;
      reason: string | null;
      outcome: string | null;
    }[]
  >`
    select s.name as season, p.name as player, ts.name as seller, tb.name as buyer, b.fee::text, b.status,
      b.seller_reason as reason, b.outcome
    from transfer_bids b join transfer_windows w on w.id = b.window_id join seasons s on s.id = w.season_id
    join players p on p.id = b.player_id join teams ts on ts.id = b.seller_team_id join teams tb on tb.id = b.buyer_team_id
    order by s.created_at, b.fee desc`;
  const [listed] = await db<{ n: number }[]>`select count(*)::int as n from transfer_listings`;
  const gone = await db<{ season: string; club: string; round: number; reason: string }[]>`
    select s.name as season, team_name_as_of(w.team_id, w.season_id) as club, w.effective_round as round, w.reason
    from club_withdrawals w join seasons s on s.id = w.season_id order by s.created_at, w.effective_round`;
  const rescues = await db<{ season: string; name: string; memo: string }[]>`
    select s.name as season, i.name, i.memo from team_identities i join seasons s on s.id = i.from_season_id
    where i.reason = 'takeover' order by s.created_at`;
  const squads = await db<{ name: string; n: number }[]>`
    select t.name, count(*)::int as n from players p join teams t on t.id = p.team_id group by t.name`;
  const by = await db<{ name: string; kind: string; total: string }[]>`
    select t.name, l.kind, sum(l.amount)::text as total from club_ledger l join teams t on t.id = l.team_id
    group by t.name, l.kind order by t.name`;
  const clubs = [...new Set(by.map((r) => r.name))].sort();
  const get = (c: string, k: string) => Number(by.find((r) => r.name === c && r.kind === k)?.total ?? 0);
  const final = cash.at(-1)!;
  const spread = Math.max(...Object.values(final)) - Math.min(...Object.values(final));
  const md = `# Club finance balance (finance/1, transfer/1, insolvency/1)

Generated by \`bun run finance:balance --seasons ${SEASONS} --seed ${SEED}\`: ${SEASONS} seasons through the normal
lifecycle (scheduler, offline AI managers, rollover) on a throwaway database. Credits (cr) are fictional.

Assumptions: offline managers, 7-a-side, the seed clubs and squads (16 players each at the start, all paid every
round), a transfer window (${TRANSFER.version}) before every season after the first, and a payroll check (${INSOLVENCY.version}) before every round. The offline managers list
unused surplus players, bid for one affordable upgrade on their weakest starting place while keeping
3m cr of headroom, keep their two best players and last season's regular scorers unless offered twice the guide
fee and other regular starters unless offered 1.5 times it, and sell the rest at the guide fee. Rules: opening ${formatCredits(RULES.opening)}; distribution ${formatCredits(RULES.distribution)} a season;
${formatCredits(RULES.result.win)} a win, ${formatCredits(RULES.result.draw)} a draw; prizes ${RULES.prize.map(formatCredits).join(" / ")};
wages ${formatCredits(RULES.wage.base)} + ${formatCredits(RULES.wage.perPoint)} per rating point above ${RULES.wage.floor} a round (min ${formatCredits(RULES.wage.min)}).

## Earnings and spending by source, all ${SEASONS} seasons

| Club | Distribution | Results | Prizes | Wages | Transfer fees | Takeover | Titles | Squad now | Cash now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${clubs
  .map(
    (c) =>
      `| ${c} | ${formatCredits(get(c, "distribution"))} | ${formatCredits(get(c, "result"))} | ${formatCredits(get(c, "prize"))} | ${formatCredits(get(c, "payroll"))} | ${formatCredits(get(c, "transfer"))} | ${formatCredits(get(c, "takeover"))} | ${champions.filter((x) => x === c).length} | ${squads.find((x) => x.name === c)?.n ?? 0} | ${formatCredits(final[c] ?? 0)} |`,
  )
  .join("\n")}

## Cash after each season

| Club | ${cash.map((_, i) => `S${i + 1}`).join(" | ")} |
| --- | ${cash.map(() => "---:").join(" | ")} |
${clubs.map((c) => `| ${c} | ${cash.map((s) => formatCredits(s[c] ?? 0)).join(" | ")} |`).join("\n")}

Champions: ${champions.map((c, i) => `S${i + 1} ${c}`).join(", ")}. Cash spread after season ${SEASONS}: ${formatCredits(spread)}.

## Bankruptcies and rescues (${INSOLVENCY.version})

${[
  `${gone.length} bankruptc${gone.length === 1 ? "y" : "ies"} in ${SEASONS} seasons; ${rescues.length} takeover${rescues.length === 1 ? "" : "s"}.`,
  ...gone.map((g) => `- ${g.season}: ${g.club} withdrew before round ${g.round}. ${g.reason}`),
  ...rescues.map((r) => `- ${r.season}: returned as ${r.name}. ${r.memo}`),
].join("\n")}

## Transfer activity

${listed!.n} listing${listed!.n === 1 ? "" : "s"}, ${deals.length} bid${deals.length === 1 ? "" : "s"}: ${["completed", "rejected", "outbid", "failed", "lapsed"].map((k) => `${deals.filter((d) => d.status === k).length} ${k}`).join(", ")}.

| Window | Player | From | To | Fee | Outcome |
| --- | --- | --- | --- | ---: | --- |
${deals.map((d) => `| ${d.season} | ${d.player} | ${d.seller} | ${d.buyer} | ${formatCredits(Number(d.fee))} | ${d.status}${d.reason ? `: ${d.reason.replace(/\|/g, "/")}` : ""}${d.outcome ? ` (${d.outcome})` : ""} |`).join("\n") || "| | (no bids) | | | | |"}
`;
  writeFileSync(OUT, md);
  console.log(md);
} finally {
  await t.drop();
  process.exit(0);
}
