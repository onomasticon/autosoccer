/**
 * Consequences made visible (#80, increment 4): completed deals and rescue takeovers as one read
 * model for the club page, player pages, Matchday, the newsroom and the spotlight. Official record
 * only: settled transfer bids (with each manager's recorded reasoning, attributed by name) and
 * takeover identities with the withdrawal and capital behind them.
 */
import type { Team } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { teamsAsOf } from "../insolvency/takeover.ts";

export interface Deal {
  id: string;
  season: { id: string; slug: string; name: string };
  player: { id: string; name: string; position: string };
  from: Team;
  to: Team;
  fee: number;
  /** The buying manager's recorded reason for the bid, and the selling manager's for accepting. */
  buyer: { manager: string | null; reason: string };
  seller: { manager: string | null; reason: string | null };
  settledAt: string | null;
}

/** Quotation marks never reach the site or the newsroom (nothing was said aloud). */
export const unquote = (s: string) =>
  s
    .replace(/["“”«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Completed deals, newest first; filter by club, player or season. */
export async function completedDeals(
  db: Db,
  where: { teamId?: string; playerId?: string; seasonId?: string } = {},
  limit = 50,
): Promise<Deal[]> {
  const rows = await db<
    {
      id: string;
      season_id: string;
      slug: string;
      name: string;
      player_id: string;
      player: string;
      position: string;
      seller: string;
      buyer: string;
      fee: string;
      buyer_reason: string;
      seller_reason: string | null;
      buyer_manager: string | null;
      seller_manager: string | null;
      settled_at: Date | null;
    }[]
  >`
    select b.id, s.id as season_id, s.slug, s.name, p.id as player_id, p.name as player, p.position,
      b.seller_team_id as seller, b.buyer_team_id as buyer, b.fee::text, b.buyer_reason, b.seller_reason,
      (select name from manager_agents m where m.team_id = b.buyer_team_id) as buyer_manager,
      (select name from manager_agents m where m.team_id = b.seller_team_id) as seller_manager,
      b.settled_at
    from transfer_bids b join transfer_windows w on w.id = b.window_id join seasons s on s.id = w.season_id
    join players p on p.id = b.player_id
    where b.status = 'completed'
      and (${where.teamId ?? null}::uuid is null or ${where.teamId ?? null}::uuid in (b.seller_team_id, b.buyer_team_id))
      and (${where.playerId ?? null}::uuid is null or b.player_id = ${where.playerId ?? null}::uuid)
      and (${where.seasonId ?? null}::uuid is null or s.id = ${where.seasonId ?? null}::uuid)
    order by s.created_at desc, b.fee desc limit ${limit}`;
  const names = new Map<string, Map<string, Team>>();
  const asOf = async (seasonId: string) => {
    if (!names.has(seasonId)) names.set(seasonId, await teamsAsOf(db, seasonId));
    return names.get(seasonId)!;
  };
  const out: Deal[] = [];
  for (const r of rows) {
    const teams = await asOf(r.season_id);
    out.push({
      id: r.id,
      season: { id: r.season_id, slug: r.slug, name: r.name },
      player: { id: r.player_id, name: r.player, position: r.position },
      from: teams.get(r.seller)!,
      to: teams.get(r.buyer)!,
      fee: Number(r.fee),
      buyer: { manager: r.buyer_manager, reason: unquote(r.buyer_reason) },
      seller: { manager: r.seller_manager, reason: r.seller_reason ? unquote(r.seller_reason) : null },
      settledAt: r.settled_at?.toISOString() ?? null,
    });
  }
  return out;
}

export interface TakeoverStory {
  /** The season the club withdrew from, and the round. */
  withdrew: { season: { slug: string; name: string }; round: number; reason: string };
  /** The numbers behind the declaration: cash plus money due, and the round's wages. */
  basis: { available: number | null; wages: number | null };
  capital: number;
  from: string;
  to: string;
  /** The season the club returned under its new name. */
  returned: { slug: string; name: string };
  memo: string;
}

/** Every rescue takeover of a club, oldest first: why it happened and what changed. */
export async function takeoverStories(db: Db, teamId: string): Promise<TakeoverStory[]> {
  const rows = await db<
    {
      name: string;
      memo: string;
      from_id: string;
      from_slug: string;
      from_name: string;
      to_slug: string;
      to_name: string;
      round: number | null;
      reason: string | null;
      basis: { balance?: number; due?: number; wages?: number } | null;
      capital: string | null;
    }[]
  >`
    select i.name, i.memo, fs.id as from_id, fs.slug as from_slug, fs.name as from_name, ts.slug as to_slug, ts.name as to_name,
      w.effective_round as round, w.reason, w.basis,
      (select amount::text from club_ledger l where l.key = 'takeover:' || fs.id || ':' || i.team_id) as capital
    from team_identities i
    join seasons fs on fs.id = i.takeover_of_season_id join seasons ts on ts.id = i.from_season_id
    left join club_withdrawals w on w.season_id = fs.id and w.team_id = i.team_id
    where i.team_id = ${teamId} and i.reason = 'takeover' order by ts.created_at`;
  const out: TakeoverStory[] = [];
  for (const r of rows) {
    const old = (await teamsAsOf(db, r.from_id)).get(teamId);
    out.push({
      withdrew: { season: { slug: r.from_slug, name: r.from_name }, round: r.round ?? 0, reason: r.reason ?? "" },
      basis: {
        available: r.basis?.balance != null ? r.basis.balance + (r.basis.due ?? 0) : null,
        wages: r.basis?.wages ?? null,
      },
      capital: Number(r.capital ?? 0),
      from: old?.name ?? r.name,
      to: r.name,
      returned: { slug: r.to_slug, name: r.to_name },
      memo: r.memo,
    });
  }
  return out;
}
