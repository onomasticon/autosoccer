/** Read model for the transfer window (transfer-window/1). */
import { type BidStatus, TRANSFERS_CONTRACT, type TransferWindowResponse } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { overallRating, playerAttributes } from "../league/attributes.ts";
import { type TeamRow, toTeam } from "../mappers.ts";
import type { WindowRow } from "./market.ts";
import { minSquad, TRANSFER } from "./rules.ts";

const ORDER: BidStatus[] = ["completed", "accepted", "failed", "pending", "outbid", "rejected", "lapsed"];

export async function transferWindow(db: Db, seasonSlug?: string): Promise<TransferWindowResponse> {
  const [w] = seasonSlug
    ? await db<(WindowRow & { slug: string; name: string; players_per_team: number })[]>`
        select w.*, s.slug, s.name, s.players_per_team from transfer_windows w join seasons s on s.id = w.season_id
        where s.slug = ${seasonSlug}`
    : await db<(WindowRow & { slug: string; name: string; players_per_team: number })[]>`
        select w.*, s.slug, s.name, s.players_per_team from transfer_windows w join seasons s on s.id = w.season_id
        order by w.created_at desc limit 1`;
  const rules = {
    maxListings: TRANSFER.maxListings,
    maxBids: TRANSFER.maxBids,
    minFee: TRANSFER.minFee,
    minSquad: minSquad(w?.players_per_team ?? 7),
    maxSquad: TRANSFER.squad.max,
    goalkeepers: TRANSFER.squad.goalkeepers,
    closeBeforeKickoffMin: TRANSFER.window.closeBeforeKickoffMin,
  };
  if (!w) return { contract: TRANSFERS_CONTRACT, window: null, listings: [], bids: [], rules };
  const teams = new Map((await db<TeamRow[]>`select * from teams`).map((t) => [t.id, toTeam(t)]));
  const players = new Map(
    (
      await db<
        {
          id: string;
          name: string;
          position: "GK" | "DF" | "MF" | "FW";
          shirt_number: number;
          overall: number | null;
        }[]
      >`
        select p.id, p.name, p.position, p.shirt_number, r.overall from players p
        left join player_ratings r on r.player_id = p.id and r.season_id = ${w.season_id}`
    ).map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        position: p.position,
        overall:
          p.overall ??
          overallRating(
            playerAttributes({ name: p.name, shirtNumber: p.shirt_number, position: p.position }),
            p.position,
          ),
      },
    ]),
  );
  const listings = await db<{ player_id: string; team_id: string; asking_fee: string | null; reason: string }[]>`
    select player_id, team_id, asking_fee::text, reason from transfer_listings where window_id = ${w.id} order by created_at`;
  const bids = await db<
    {
      id: string;
      player_id: string;
      seller_team_id: string;
      buyer_team_id: string;
      fee: string;
      wage: string;
      status: BidStatus;
      buyer_reason: string;
      seller_reason: string | null;
      outcome: string | null;
      created_at: Date;
      settled_at: Date | null;
    }[]
  >`select * from transfer_bids where window_id = ${w.id} order by fee desc, created_at, id`;
  return {
    contract: TRANSFERS_CONTRACT,
    window: {
      season: { slug: w.slug, name: w.name },
      rule: w.rule,
      phase: w.phase,
      opensAt: w.opens_at.toISOString(),
      deadline: w.deadline.toISOString(),
      phaseEndsAt: w.phase_ends_at.toISOString(),
      closedAt: w.closed_at?.toISOString() ?? null,
    },
    listings: listings.map((l) => ({
      player: players.get(l.player_id)!,
      team: teams.get(l.team_id)!,
      askingFee: l.asking_fee === null ? null : Number(l.asking_fee),
      reason: l.reason,
    })),
    bids: [...bids]
      .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
      .map((b) => ({
        id: b.id,
        player: players.get(b.player_id)!,
        seller: teams.get(b.seller_team_id)!,
        buyer: teams.get(b.buyer_team_id)!,
        fee: Number(b.fee),
        wage: Number(b.wage),
        status: b.status,
        buyerReason: b.buyer_reason,
        sellerReason: b.seller_reason,
        outcome: b.outcome,
        createdAt: b.created_at.toISOString(),
        settledAt: b.settled_at?.toISOString() ?? null,
      })),
    rules,
  };
}
