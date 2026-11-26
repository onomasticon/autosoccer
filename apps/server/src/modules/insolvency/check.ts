/**
 * The solvency check and its sporting consequence (insolvency/1).
 *
 * Before a round is released (before its previews, manager decisions and matches are prepared), every
 * club still in the season must be able to pay that round's wages from its cash plus any money due as
 * the round kicks off. A club that can't is declared bankrupt: withdrawn from that round on, ineligible
 * for the title and the finishing-position prize. Its completed results, statistics and replays stay.
 * From then on each of its fixtures resolves, as its round is released, as a walkover (the opponent is
 * awarded the win: 3 points, no goals, no match) or void (both clubs withdrawn: no points).
 *
 * Cutoff: money that moves after a season's last result (prizes, the transfer window) belongs to the
 * next season. A club can't be declared bankrupt between seasons; the first check that sees it is the
 * one before the next season's round 1.
 *
 * Exactly once: one withdrawal per club per season (primary key), checks serialised per season by an
 * advisory lock, a round is checked only while none of its fixtures has been released, and a fixture
 * resolves only from 'scheduled'.
 */
import type { Db } from "@autosoccer/db";
import { RULES } from "../finance/rules.ts";
import { payrollFor, settleFinances } from "../finance/settle.ts";
import { INSOLVENCY } from "./rules.ts";

export interface Declared {
  teamId: string;
  name: string;
  round: number;
  balance: number;
  due: number;
  wages: number;
}

/** Withdrawn clubs in a season: team id → the first round they don't play. */
export async function withdrawals(db: Db, seasonId: string): Promise<Map<string, number>> {
  const rows = await db<{ team_id: string; effective_round: number }[]>`
    select team_id, effective_round from club_withdrawals where season_id = ${seasonId}`;
  return new Map(rows.map((r) => [r.team_id, r.effective_round]));
}

/** Clubs withdrawn from a season by the given round. */
export const withdrawnBy = (w: Map<string, number>, round: number) =>
  new Set([...w].filter(([, r]) => r <= round).map(([t]) => t));

/**
 * Runs the solvency check for a round that hasn't been released. Returns the clubs it declared
 * bankrupt now (empty when every club can pay, the season has no insolvency rule, or the round is
 * already under way). Safe to call repeatedly and concurrently.
 */
export async function checkSolvency(db: Db, seasonId: string, round: number): Promise<Declared[]> {
  const [s] = await db<{ finance_rule: string | null; insolvency_rule: string | null; slug: string }[]>`
    select finance_rule, insolvency_rule, slug from seasons where id = ${seasonId}`;
  if (!s?.finance_rule || !s.insolvency_rule) return [];
  const rule = s.insolvency_rule;
  const releasedYet = () => db`
    select 1 from fixtures where season_id = ${seasonId} and round = ${round} and status <> 'scheduled' limit 1`;
  if ((await releasedYet()).length) return [];
  // Results so far are in the bank before anyone is judged on them.
  await settleFinances(db, seasonId);
  return db.begin(async (tx) => {
    const t = tx as unknown as Db;
    await tx`select pg_advisory_xact_lock(hashtext(${`insolvency:${seasonId}`}))`;
    const [released] = await tx`
      select 1 from fixtures where season_id = ${seasonId} and round = ${round} and status <> 'scheduled' limit 1`;
    if (released) return [];
    const clubs = await tx<{ id: string; name: string }[]>`
      select t.id, t.name from season_teams st join teams t on t.id = st.team_id
      where st.season_id = ${seasonId}
        and not exists (select 1 from club_withdrawals w where w.season_id = st.season_id and w.team_id = t.id)
      order by t.name`;
    const declared: Declared[] = [];
    for (const c of clubs) {
      const [bal] = await tx<
        { b: string | null }[]
      >`select sum(amount)::text as b from club_ledger where team_id = ${c.id}`;
      const balance = Number(bal?.b ?? 0);
      // Money due as this round kicks off: the opening balance (a club's first finance season) and
      // the league distribution (round 1), if they haven't landed yet.
      const [opened] = await tx`select 1 from club_ledger where team_id = ${c.id} and kind = 'opening'`;
      const [paid] = await tx`
        select 1 from club_ledger where team_id = ${c.id} and kind = 'distribution' and season_id = ${seasonId}`;
      const due = (opened ? 0 : RULES.opening) + (paid ? 0 : RULES.distribution);
      const wages = (await payrollFor(t, seasonId, c.id)).perRound;
      if (balance + due - wages >= 0) continue;
      const reason = `Couldn't pay round ${round} wages: ${wages.toLocaleString("en-GB")} cr due with ${(balance + due).toLocaleString("en-GB")} cr available.`;
      const r = await tx`
        insert into club_withdrawals (season_id, team_id, effective_round, rule, reason, basis)
        values (${seasonId}, ${c.id}, ${round}, ${rule}, ${reason},
          ${tx.json({ balance, due, wages, round, check: INSOLVENCY.check } as never)})
        on conflict (season_id, team_id) do nothing`;
      if (!r.count) continue;
      // Outstanding offers involving the club close (an open window is normally shut by now).
      await tx`
        update transfer_bids b set status = 'lapsed', outcome = 'Withdrawn: the club was declared bankrupt.',
          decided_at = coalesce(b.decided_at, now())
        where b.status in ('pending', 'accepted') and ${c.id} in (b.buyer_team_id, b.seller_team_id)
          and exists (select 1 from transfer_windows w where w.id = b.window_id and w.phase <> 'closed')`;
      declared.push({ teamId: c.id, name: c.name, round, balance, due, wages });
    }
    return declared;
  });
}

/**
 * Resolves a released round's fixtures involving withdrawn clubs: a walkover to the club still in,
 * or void when both have withdrawn. No match, events or replay. Returns how many it resolved.
 */
export async function resolveForfeits(db: Db, seasonId: string, round: number): Promise<number> {
  const r = await db`
    with w as (select team_id from club_withdrawals where season_id = ${seasonId} and effective_round <= ${round})
    update fixtures f set
      status = 'completed',
      outcome = case when f.home_team_id in (select team_id from w) and f.away_team_id in (select team_id from w)
        then 'void' else 'walkover' end,
      walkover_team_id = case
        when f.home_team_id in (select team_id from w) and f.away_team_id in (select team_id from w) then null
        when f.home_team_id in (select team_id from w) then f.away_team_id
        else f.home_team_id end,
      updated_at = now()
    where f.season_id = ${seasonId} and f.round = ${round} and f.status = 'scheduled'
      and (f.home_team_id in (select team_id from w) or f.away_team_id in (select team_id from w))`;
  return r.count;
}
