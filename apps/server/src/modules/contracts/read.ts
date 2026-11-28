/** Read model for a season's player market (market/1): official outcomes only. */
import { MARKET_CONTRACT, type MarketMove, type SeasonMarketResponse, type Team } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { seasonTeams } from "../league/read.ts";

type Pos = "GK" | "DF" | "MF" | "FW";
const KIND_ORDER = { recruitment: 0, preseason: 1, midseason: 2 } as const;

export async function seasonMarket(db: Db, seasonId: string): Promise<SeasonMarketResponse | null> {
  const [s] = await db<{ slug: string; name: string; transfer_rule: string | null }[]>`
    select slug, name, transfer_rule from seasons where id = ${seasonId}`;
  if (!s) return null;
  const teams = await seasonTeams(db, seasonId);
  // A club that only appears after the season started (none today) still resolves.
  const team = (id: string): Team => teams.get(id)!;
  const windows = await db<
    {
      id: string;
      kind: keyof typeof KIND_ORDER;
      round: number;
      phase: "renewals" | "free_agency" | "closed";
      opens_at: Date;
      deadline: Date;
      effective_round: number;
    }[]
  >`select id, kind, round, phase, opens_at, deadline, effective_round from market_windows where season_id = ${seasonId}`;
  windows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.round - b.round);
  const win = new Map(windows.map((w) => [w.id, { kind: w.kind, round: w.round }]));
  const moves: MarketMove[] = [];
  const signed = await db<
    {
      window_id: string;
      player_id: string;
      name: string;
      position: Pos;
      team_id: string;
      wage: string;
      years: number;
      reason: string;
      run_id: string | null;
    }[]
  >`
    select o.window_id, o.player_id, p.name, p.position, o.team_id, o.wage_per_season::text as wage, o.years, o.reason, o.run_id
    from free_agent_offers o join players p on p.id = o.player_id join market_windows w on w.id = o.window_id
    where w.season_id = ${seasonId} and o.outcome = 'signed' order by p.name`;
  for (const o of signed) {
    const w = win.get(o.window_id)!;
    moves.push({
      window: w,
      type: w.kind === "recruitment" ? "recruited" : "signed",
      player: { id: o.player_id, name: o.name, position: o.position },
      team: team(o.team_id),
      wagePerSeason: Number(o.wage),
      years: o.years,
      fee: null,
      reason: o.reason,
      source: "manager",
    });
  }
  const decided = await db<
    {
      window_id: string;
      decision: "renew" | "release";
      source: "manager" | "default";
      reason: string;
      team_id: string;
      player_id: string;
      name: string;
      position: Pos;
      wage: string | null;
      years: number | null;
    }[]
  >`
    select d.window_id, d.decision, d.source, d.reason, d.team_id, c.player_id, p.name, p.position,
      n.wage_per_season::text as wage, (n.ends_season - n.starts_season + 1) as years
    from contract_decisions d join market_windows w on w.id = d.window_id
    join player_contracts c on c.id = d.contract_id join players p on p.id = c.player_id
    left join lateral (select * from player_contracts n where n.player_id = c.player_id and n.via = 'renewal'
      and n.season_id = ${seasonId} order by n.created_at desc limit 1) n on d.decision = 'renew'
    where w.season_id = ${seasonId} order by p.name`;
  for (const d of decided)
    moves.push({
      window: win.get(d.window_id)!,
      type: d.decision === "renew" ? "renewed" : "released",
      player: { id: d.player_id, name: d.name, position: d.position },
      team: team(d.team_id),
      wagePerSeason: d.decision === "renew" && d.wage ? Number(d.wage) : null,
      years: d.decision === "renew" ? d.years : null,
      fee: null,
      reason: d.source === "manager" ? d.reason : null,
      source: d.source,
    });
  const net = await db<
    { team_id: string; amount: string; player_id: string; name: string; position: Pos; wage: string | null }[]
  >`
    select l.team_id, l.amount::text, p.id as player_id, p.name, p.position, l.basis->>'wage' as wage
    from club_ledger l join players p on p.id = (l.basis->>'player')::uuid
    where l.season_id = ${seasonId} and l.kind = 'recruitment' order by p.name`;
  for (const n of net)
    moves.push({
      window: null,
      type: "safety-net",
      player: { id: n.player_id, name: n.name, position: n.position },
      team: team(n.team_id),
      wagePerSeason: n.wage == null ? null : Number(n.wage),
      years: 1,
      fee: -Number(n.amount),
      reason: null,
      source: "league",
    });
  const auctions = await db<
    {
      round: number;
      player_id: string;
      name: string;
      position: Pos;
      seller_team_id: string;
      winner_team_id: string | null;
      amount: string | null;
      reserve: string;
      bidders: number;
    }[]
  >`
    select a.round, a.player_id, p.name, p.position, a.seller_team_id, a.winner_team_id, a.amount::text, a.reserve::text,
      jsonb_array_length(a.bids)::int as bidders
    from collateral_auctions a join players p on p.id = a.player_id where a.season_id = ${seasonId} order by a.round, p.name`;
  return {
    contract: MARKET_CONTRACT,
    season: { slug: s.slug, name: s.name },
    rule: s.transfer_rule,
    windows: windows.map((w) => ({
      kind: w.kind,
      round: w.round,
      phase: w.phase,
      opensAt: w.opens_at.toISOString(),
      deadline: w.deadline.toISOString(),
      effectiveRound: w.effective_round,
    })),
    moves,
    auctions: auctions.map((a) => ({
      round: a.round,
      player: { id: a.player_id, name: a.name, position: a.position },
      seller: team(a.seller_team_id),
      buyer: a.winner_team_id ? team(a.winner_team_id) : null,
      amount: a.amount == null ? null : Number(a.amount),
      reserve: Number(a.reserve),
      bidders: a.bidders,
    })),
  };
}
