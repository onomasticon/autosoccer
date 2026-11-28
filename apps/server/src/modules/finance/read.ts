/** Read model for a club's finances (club-finances/1). */
import {
  type ClubDebt,
  type ClubFinancesResponse,
  FINANCES_CONTRACT,
  type LedgerKind,
  type Team,
} from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { type SeasonRow, seasonTeams } from "../league/read.ts";
import { RULES } from "./rules.ts";
import { clubPosition, contractPayroll, payrollFor, seasonRules } from "./settle.ts";

type Source = keyof ClubFinancesResponse["seasons"][number]["bySource"];
/** Which line of the season summary each ledger kind adds to (the opening balance is in none). */
const SOURCE: Record<LedgerKind, Source | null> = {
  opening: null,
  distribution: "distribution",
  result: "results",
  prize: "prize",
  payroll: "payroll",
  transfer: "transfers",
  takeover: "takeover",
  operating: "operating",
  loan: "borrowing",
  repayment: "borrowing",
  auction: "auctions",
  recruitment: "recruitment",
};

/** The club's own current season (its league's, not the site default): active first, then the latest. */
async function clubSeason(db: Db, teamId: string): Promise<(SeasonRow & { transfer_rule: string | null }) | null> {
  const [row] = await db<(SeasonRow & { transfer_rule: string | null })[]>`
    select s.* from seasons s join season_teams st on st.season_id = s.id
    where st.team_id = ${teamId} and s.status <> 'draft'
    order by (s.status = 'active') desc, s.starts_at desc nulls last, s.created_at desc limit 1`;
  return row ?? null;
}

export async function clubFinances(db: Db, team: Team): Promise<ClubFinancesResponse> {
  const rows = await db<
    {
      kind: LedgerKind;
      amount: string;
      round: number | null;
      memo: string;
      created_at: Date;
      slug: string | null;
      name: string | null;
    }[]
  >`
    select l.kind, l.amount::text, l.round, l.memo, l.created_at, s.slug, s.name
    from club_ledger l left join seasons s on s.id = l.season_id
    where l.team_id = ${team.id}
    order by l.created_at, l.id`;
  const balance = rows.reduce((s, r) => s + Number(r.amount), 0);
  const seasons = new Map<string, ClubFinancesResponse["seasons"][number]>();
  for (const r of rows) {
    if (!r.slug || !r.name) continue;
    const s = seasons.get(r.slug) ?? {
      season: { slug: r.slug, name: r.name },
      bySource: {
        distribution: 0,
        results: 0,
        prize: 0,
        payroll: 0,
        transfers: 0,
        takeover: 0,
        operating: 0,
        borrowing: 0,
        auctions: 0,
        recruitment: 0,
      },
      net: 0,
    };
    const key = SOURCE[r.kind];
    if (key) s.bySource[key] += Number(r.amount);
    s.net += Number(r.amount);
    seasons.set(r.slug, s);
  }
  const cur = await clubSeason(db, team.id);
  const pos = cur ? await clubPosition(db, cur.id, team.id) : null;
  // transfer/2 seasons pay contracts (the next round's registered players), others pay by rating.
  const pay =
    cur?.transfer_rule === "transfer/2"
      ? await (async () => {
          const [n] = await db<{ r: number }[]>`
            select coalesce(min(round), max(round), 1)::int as r from fixtures where season_id = ${cur.id} and status = 'scheduled'`;
          const c = await contractPayroll(db, cur.id, team.id, n?.r ?? 1);
          return { perRound: c.perRound, players: c.players };
        })()
      : cur
        ? await payrollFor(db, cur.id, team.id)
        : { perRound: 0, players: [] };
  const remaining =
    cur?.transfer_rule === "transfer/2" ? pay.perRound * (pos?.roundsToPay ?? 0) : (pos?.remainingPayroll ?? 0);
  // The current season's numbers (its rule, scaled to its length).
  const R = cur ? await seasonRules(db, cur.id) : RULES;
  return {
    contract: FINANCES_CONTRACT,
    team,
    active: rows.length > 0,
    rule: pos?.rule ?? null,
    balance,
    payroll: { perRound: pay.perRound, players: pay.players.length, roundsToPay: pos?.roundsToPay ?? 0, remaining },
    headroom: balance - remaining,
    seasons: [...seasons.values()],
    debt: await clubDebt(db, team.id),
    entries: [...rows]
      .reverse()
      .slice(0, 12)
      .map((r) => ({
        kind: r.kind,
        season: r.slug && r.name ? { slug: r.slug, name: r.name } : null,
        round: r.round,
        amount: Number(r.amount),
        memo: r.memo,
        at: r.created_at.toISOString(),
      })),
    rules: {
      opening: R.opening,
      distribution: R.distribution,
      result: R.result,
      prize: R.prize,
      wage: {
        base: Math.round(R.wage.base),
        perPoint: Math.round(R.wage.perPoint),
        floor: R.wage.floor,
        min: R.wage.min,
      },
    },
  };
}

const ref = (r: { slug: string; name: string }) => ({ slug: r.slug, name: r.name });

/**
 * Debt and recovery (insolvency/2), from the lender's official records: loans with their debt ledger,
 * administration, the rounds the club couldn't meet, and the forced auctions it was part of. Sealed
 * bids stay private (only how many clubs bid). Null for a club that never played under the lender.
 */
export async function clubDebt(db: Db, teamId: string): Promise<ClubDebt | null> {
  const [under] = await db`
    select 1 from season_teams st join seasons s on s.id = st.season_id
    where st.team_id = ${teamId} and s.insolvency_rule = 'insolvency/2' limit 1`;
  if (!under) return null;
  const loans = await db<
    {
      id: string;
      kind: "secured" | "emergency" | "support";
      principal: string;
      status: "active" | "repaid";
      due_season: number;
      opened_round: number | null;
      slug: string;
      name: string;
      balance: string;
      repaid: string;
      interest: string;
      pledged: string[] | null;
    }[]
  >`
    select l.id, l.kind, l.principal::text, l.status, l.due_season, l.opened_round, s.slug, s.name,
      coalesce((select sum(amount) from loan_entries e where e.loan_id = l.id), 0)::text as balance,
      coalesce((select -sum(amount) from loan_entries e where e.loan_id = l.id and e.kind = 'repayment'), 0)::text as repaid,
      coalesce((select sum(amount) from loan_entries e where e.loan_id = l.id and e.kind = 'interest'), 0)::text as interest,
      (select array_agg(p.name order by p.name) from loan_liens n join players p on p.id = n.player_id
        where n.loan_id = l.id and n.released_at is null) as pledged
    from club_loans l join seasons s on s.id = l.season_id
    where l.team_id = ${teamId} order by l.created_at desc, l.id`;
  const [adm] = await db<
    {
      slug: string;
      name: string;
      entered_round: number | null;
      debt_at_entry: string;
      reason: string;
      xslug: string | null;
      xname: string | null;
    }[]
  >`
    select s.slug, s.name, a.entered_round, a.debt_at_entry::text, a.reason, x.slug as xslug, x.name as xname
    from administrations a join seasons s on s.id = a.entered_season_id left join seasons x on x.id = a.exited_season_id
    where a.team_id = ${teamId} order by a.created_at desc limit 1`;
  const events = await db<
    { slug: string; name: string; round: number; outcome: "emergency" | "default"; basis: Record<string, unknown> }[]
  >`
    select s.slug, s.name, c.round, c.outcome, c.basis from lender_checks c join seasons s on s.id = c.season_id
    where c.team_id = ${teamId} and c.outcome <> 'solvent' order by s.starts_at desc nulls last, c.round desc`;
  const auctions = await db<
    {
      season_id: string;
      slug: string;
      name: string;
      round: number;
      player_id: string;
      player: string;
      seller_team_id: string;
      winner_team_id: string | null;
      amount: string | null;
      reserve: string;
      bidders: number;
    }[]
  >`
    select a.season_id, s.slug, s.name, a.round, a.player_id, p.name as player, a.seller_team_id, a.winner_team_id,
      a.amount::text, a.reserve::text, jsonb_array_length(a.bids)::int as bidders
    from collateral_auctions a join seasons s on s.id = a.season_id join players p on p.id = a.player_id
    where ${teamId} in (a.seller_team_id, a.winner_team_id)
    order by s.starts_at desc nulls last, a.round desc, p.name`;
  const teamsBySeason = new Map<string, Map<string, Team>>();
  const teamIn = async (seasonId: string, id: string | null) => {
    if (!id) return null;
    if (!teamsBySeason.has(seasonId)) teamsBySeason.set(seasonId, await seasonTeams(db, seasonId));
    return teamsBySeason.get(seasonId)!.get(id) ?? null;
  };
  const shortfall = (b: Record<string, unknown>) => {
    const n = (k: string) => Number(b[k] ?? 0);
    const inst = Array.isArray(b.instalments) ? (b.instalments as number[]).reduce((a, x) => a + x, 0) : 0;
    return Math.max(0, n("payroll") + n("operating") + inst - n("cash") - n("due"));
  };
  return {
    rule: "insolvency/2",
    total: loans.filter((l) => l.status === "active").reduce((a, l) => a + Number(l.balance), 0),
    loans: loans.map((l) => ({
      kind: l.kind,
      principal: Number(l.principal),
      balance: Number(l.balance),
      repaid: Number(l.repaid),
      interest: Number(l.interest),
      opened: { season: ref(l), round: l.opened_round },
      dueSeason: l.due_season,
      status: l.status,
      pledged: l.pledged ?? [],
    })),
    administration: adm
      ? {
          since: { season: ref(adm), round: adm.entered_round },
          debtAtEntry: Number(adm.debt_at_entry),
          reason: adm.reason,
          exited: adm.xslug && adm.xname ? { slug: adm.xslug, name: adm.xname } : null,
        }
      : null,
    events: events.map((e) => ({
      season: ref(e),
      round: e.round,
      outcome: e.outcome,
      shortfall: shortfall(e.basis),
      auctioned: Array.isArray(e.basis.auctioned) ? e.basis.auctioned.length : 0,
    })),
    auctions: await Promise.all(
      auctions.map(async (a) => {
        const sold = a.seller_team_id === teamId;
        return {
          season: ref(a),
          round: a.round,
          player: { id: a.player_id, name: a.player },
          role: sold ? (a.winner_team_id ? ("sold" as const) : ("unsold" as const)) : ("bought" as const),
          counterparty: await teamIn(a.season_id, sold ? a.winner_team_id : a.seller_team_id),
          amount: a.amount == null ? null : Number(a.amount),
          reserve: Number(a.reserve),
          bidders: a.bidders,
        };
      }),
    ),
  };
}
