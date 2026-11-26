/**
 * Club finance settlement (finance/1). One reconciler, `settleFinances`, writes every ledger entry a
 * season owes so far, each under a unique settlement key, so it can run on every scheduler tick and
 * after every match (and be retried) without ever paying or charging twice.
 *
 * When money moves:
 *  - opening balance: once per club, the first time it plays a finance season;
 *  - league distribution: when the season's first round is released;
 *  - payroll: when each round is released, before its matches are prepared (so a later increment's
 *    insolvency check can still have a sporting consequence while matches remain);
 *  - result income: after each official result;
 *  - finishing-position prize: when the season completes.
 * Seasons without a finance_rule (from before club finances) are never settled.
 */
import type { Db } from "@autosoccer/db";
import { withdrawals } from "../insolvency/check.ts";
import { ratedPlayer, seasonRatings } from "../league/careers.ts";
import { standingRows } from "../league/read.ts";
import type { PlayerRow } from "../mappers.ts";
import { type FinanceRules, prizeFor, resultIncome, rulesFor, wageFor } from "./rules.ts";

interface Entry {
  teamId: string;
  seasonId: string | null;
  round: number | null;
  kind: "opening" | "distribution" | "result" | "prize" | "payroll" | "transfer" | "takeover";
  amount: number;
  key: string;
  memo: string;
  basis?: Record<string, unknown>;
}

async function write(db: Db, rule: string, entries: Entry[]): Promise<number> {
  let n = 0;
  for (const e of entries) {
    const r = await db`
      insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo, basis)
      values (${e.teamId}, ${e.seasonId}, ${e.round}, ${e.kind}, ${e.amount}, ${e.key}, ${rule}, ${e.memo},
        ${db.json((e.basis ?? {}) as never)})
      on conflict (key) do nothing`;
    n += r.count;
  }
  return n;
}

/** The finance numbers a season is settled by (its rule version, scaled to its length). */
export async function seasonRules(db: Db, seasonId: string): Promise<FinanceRules> {
  const [s] = await db<{ finance_rule: string | null; rounds: number }[]>`
    select s.finance_rule, (select count(distinct round)::int from fixtures f where f.season_id = s.id) as rounds
    from seasons s where s.id = ${seasonId}`;
  return rulesFor(s?.finance_rule, s?.rounds ?? 6);
}

/**
 * A club's wage bill per round in a season: every player registered with it for that season (as
 * the transfer window left it), at that season's ratings.
 */
export async function payrollFor(db: Db, seasonId: string, teamId: string) {
  const snapshot = await seasonRatings(db, seasonId);
  const players = (
    await db<PlayerRow[]>`
      select p.* from players p join player_registrations r on r.player_id = p.id
      where r.season_id = ${seasonId} and r.team_id = ${teamId} order by p.shirt_number`
  ).map((p) => ratedPlayer(p, snapshot));
  const rules = await seasonRules(db, seasonId);
  const wages = players.map((p) => ({ playerId: p.id, overall: p.overall, wage: wageFor(p.overall, rules) }));
  return { perRound: wages.reduce((s, w) => s + w.wage, 0), players: wages };
}

/** Writes everything the season owes so far. Returns how many new entries were written. */
export async function settleFinances(db: Db, seasonId: string): Promise<number> {
  const [season] = await db<{ id: string; slug: string; status: string; finance_rule: string | null }[]>`
    select id, slug, status, finance_rule from seasons where id = ${seasonId}`;
  if (!season?.finance_rule) return 0;
  const rule = season.finance_rule;
  const R = await seasonRules(db, seasonId);
  const teams = await db<{ id: string; name: string }[]>`
    select t.id, t.name from season_teams st join teams t on t.id = st.team_id where st.season_id = ${seasonId}`;
  const released = await db<{ round: number }[]>`
    select distinct round from fixtures where season_id = ${seasonId} and status <> 'scheduled' order by round`;
  if (!released.length && season.status !== "completed") return 0; // nothing has kicked off yet
  // A club withdrawn (bankrupt, insolvency/1) stops paying wages from the round it withdrew, earns
  // nothing more that season, and gets no finishing prize. Withdrawn before round 1: no distribution.
  const gone = await withdrawals(db, seasonId);
  const entries: Entry[] = [];
  for (const t of teams) {
    entries.push({
      teamId: t.id,
      seasonId: null,
      round: null,
      kind: "opening",
      amount: R.opening,
      key: `opening:${t.id}`,
      memo: "Opening balance",
      basis: { firstSeason: season.slug },
    });
    if (gone.get(t.id) === 1) continue;
    entries.push({
      teamId: t.id,
      seasonId,
      round: null,
      kind: "distribution",
      amount: R.distribution,
      key: `distribution:${seasonId}:${t.id}`,
      memo: "League distribution",
    });
  }
  // Payroll for every released round, at this season's ratings.
  if (released.length) {
    for (const t of teams) {
      const pay = await payrollFor(db, seasonId, t.id);
      for (const { round } of released) {
        if (round >= (gone.get(t.id) ?? Number.POSITIVE_INFINITY)) continue;
        entries.push({
          teamId: t.id,
          seasonId,
          round,
          kind: "payroll",
          amount: -pay.perRound,
          key: `payroll:${seasonId}:${round}:${t.id}`,
          memo: `Wages, round ${round} (${pay.players.length} players)`,
          basis: { players: pay.players },
        });
      }
    }
  }
  // Income from each official result.
  const results = await db<
    {
      fixture_id: string;
      round: number;
      home_team_id: string;
      away_team_id: string;
      home_score: number;
      away_score: number;
    }[]
  >`
    select f.id as fixture_id, f.round, f.home_team_id, f.away_team_id, m.home_score, m.away_score
    from fixtures f join matches m on m.fixture_id = f.id
    where f.season_id = ${seasonId} and m.status = 'completed' order by f.round, f.id`;
  const name = new Map(teams.map((t) => [t.id, t.name]));
  for (const r of results)
    for (const [team, gf, ga, opp] of [
      [r.home_team_id, r.home_score, r.away_score, r.away_team_id],
      [r.away_team_id, r.away_score, r.home_score, r.home_team_id],
    ] as const) {
      const amount = resultIncome(gf, ga, R);
      if (!amount) continue;
      entries.push({
        teamId: team,
        seasonId,
        round: r.round,
        kind: "result",
        amount,
        key: `result:${r.fixture_id}:${team}`,
        memo: `${gf > ga ? "Win" : "Draw"} ${gf}–${ga} v ${name.get(opp) ?? "opponent"}, round ${r.round}`,
        basis: { fixtureId: r.fixture_id, goalsFor: gf, goalsAgainst: ga },
      });
    }
  // Finishing-position prize once the season is complete.
  if (season.status === "completed") {
    const { rows } = await standingRows(db, seasonId);
    for (const row of rows.filter((r) => !gone.has(r.team.id)))
      entries.push({
        teamId: row.team.id,
        seasonId,
        round: null,
        kind: "prize",
        amount: prizeFor(row.position, R),
        key: `prize:${seasonId}:${row.team.id}`,
        memo: `Finishing ${row.position}${["th", "st", "nd", "rd"][row.position] ?? "th"} in ${season.slug.replace("season-", "Season ")}`,
        basis: { position: row.position, points: row.points },
      });
  }
  return write(db, rule, entries);
}

/** Cash balance per club (all seasons), from the ledger. */
export async function balances(db: Db): Promise<Map<string, number>> {
  const rows = await db<{ team_id: string; balance: string }[]>`
    select team_id, sum(amount)::text as balance from club_ledger group by team_id`;
  return new Map(rows.map((r) => [r.team_id, Number(r.balance)]));
}

/**
 * What a manager needs before acting: cash now, the wages still to pay this season (rounds not
 * yet released), and the headroom left after them. Income still to come is not counted: it
 * depends on results.
 */
export async function clubPosition(db: Db, seasonId: string, teamId: string) {
  const [s] = await db<{ finance_rule: string | null }[]>`select finance_rule from seasons where id = ${seasonId}`;
  if (!s?.finance_rule) return null;
  const [bal] = await db<
    { b: string | null }[]
  >`select sum(amount)::text as b from club_ledger where team_id = ${teamId}`;
  // A withdrawn club (insolvency/1) has no wages left to pay this season.
  const [left] = await db<{ n: number }[]>`
    select count(distinct round)::int as n from fixtures f where f.season_id = ${seasonId} and f.status = 'scheduled'
      and not exists (select 1 from club_withdrawals w where w.season_id = f.season_id and w.team_id = ${teamId}
        and w.effective_round <= f.round)`;
  const [started] = await db`
    select 1 from club_ledger where season_id = ${seasonId} and team_id = ${teamId} and kind = 'distribution' limit 1`;
  const pay = await payrollFor(db, seasonId, teamId);
  // Before kick-off the opening balance and distribution haven't landed yet: include them as due.
  const [opened] = await db`select 1 from club_ledger where team_id = ${teamId} and kind = 'opening'`;
  const R = await seasonRules(db, seasonId);
  const due = started ? 0 : R.distribution + (opened ? 0 : R.opening);
  const balance = Number(bal?.b ?? 0) + due;
  const remaining = pay.perRound * (left?.n ?? 0);
  return {
    rule: s.finance_rule,
    balance,
    payrollPerRound: pay.perRound,
    roundsToPay: left?.n ?? 0,
    remainingPayroll: remaining,
    headroom: balance - remaining,
  };
}
