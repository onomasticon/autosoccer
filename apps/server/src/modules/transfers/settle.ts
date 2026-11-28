/**
 * Settling the transfer window. Each accepted deal settles in one transaction, so a deal either
 * happens completely or not at all:
 *   - the buyer pays the fee and the seller receives it (two club_ledger rows, settlement keys
 *     transfer:<bid>:<club>, so a retry never pays twice);
 *   - the player joins the buyer (players.team_id, a free shirt number) and is registered with the
 *     buyer for the window's season, which is what payroll and squad eligibility read from;
 *   - competing offers for the player are marked outbid.
 * Checks at settlement: the player is still at the seller, the buyer can pay the fee from cash, and
 * both squads stay within the rules (minimum size and a goalkeeper; maximum size). A deal that fails
 * a check is marked failed with the reason and moves no money.
 *
 * Deals settle highest fee first (then earliest bid), so when one club's bids together exceed its
 * cash, the bigger deal goes through and the other fails. Afterwards each club whose squad changed
 * gets a valid lineup for round 1 (its manager can still change it before kick-off).
 */
import type { Position, TeamSize } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { ratedPlayer, seasonRatings } from "../league/careers.ts";
import type { PlayerRow } from "../mappers.ts";
import { SLOT_POSITIONS } from "../matches/lineup.ts";
import { createRevision, latestValidRevision } from "../tactics/service.ts";
import type { WindowRow } from "./market.ts";
import { squadProblem } from "./market.ts";
import type { SettleFaults } from "./window.ts";

class DealFailed extends Error {}

interface AcceptedBid {
  id: string;
  player_id: string;
  seller_team_id: string;
  buyer_team_id: string;
  fee: string;
}

export async function settleWindow(db: Db, w: WindowRow, faults?: SettleFaults) {
  const [season] = await db<{ players_per_team: number; finance_rule: string | null; slug: string }[]>`
    select players_per_team, finance_rule, slug from seasons where id = ${w.season_id}`;
  const size = season!.players_per_team as TeamSize;
  const accepted = await db<AcceptedBid[]>`
    select id, player_id, seller_team_id, buyer_team_id, fee::text from transfer_bids
    where window_id = ${w.id} and status = 'accepted' order by fee desc, created_at, id`;
  const changed = new Map<string, { in: string[]; out: string[] }>();
  const mark = (team: string, dir: "in" | "out", name: string) => {
    const c = changed.get(team) ?? { in: [], out: [] };
    c[dir].push(name);
    changed.set(team, c);
  };
  for (const bid of accepted) {
    try {
      const name = await db.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`transfer-settle:${w.id}`}))`;
        const [b] = await tx<{ status: string }[]>`select status from transfer_bids where id = ${bid.id} for update`;
        if (b?.status !== "accepted") return null; // settled (or failed) by an earlier attempt
        const [p] = await tx<PlayerRow[]>`select * from players where id = ${bid.player_id} for update`;
        if (!p || p.team_id !== bid.seller_team_id) throw new DealFailed("the player is no longer at the selling club");
        const fee = Number(bid.fee);
        const [cash] = await tx<{ b: string | null }[]>`
          select sum(amount)::text as b from club_ledger where team_id = ${bid.buyer_team_id}`;
        const available = Number(cash?.b ?? 0);
        if (available < fee)
          throw new DealFailed(
            `the buying club couldn't pay: Ȼ${available.toLocaleString("en-GB")} in cash for a Ȼ${fee.toLocaleString("en-GB")} fee`,
          );
        const squad = async (team: string) =>
          tx<{ id: string; position: Position; shirt_number: number }[]>`
            select id, position, shirt_number from players where retired_season_id is null and team_id = ${team}`;
        const sellerSquad = await squad(bid.seller_team_id);
        const buyerSquad = await squad(bid.buyer_team_id);
        const sellerProblem = squadProblem(sellerSquad, size, { out: [{ id: p.id, position: p.position }] });
        if (sellerProblem) throw new DealFailed(`selling club: ${sellerProblem}`);
        const buyerProblem = squadProblem(buyerSquad, size, { in: 1 });
        if (buyerProblem) throw new DealFailed(`buying club: ${buyerProblem}`);
        const taken = new Set(buyerSquad.map((x) => x.shirt_number));
        let shirt = p.shirt_number;
        if (taken.has(shirt)) shirt = [...Array(98).keys()].map((i) => i + 2).find((n) => !taken.has(n))!;
        const [teams] = await tx<{ buyer: string; seller: string }[]>`
          select (select name from teams where id = ${bid.buyer_team_id}) as buyer,
                 (select name from teams where id = ${bid.seller_team_id}) as seller`;
        const rule = season!.finance_rule ?? w.rule;
        const basis = tx.json({ bidId: bid.id, playerId: p.id, window: w.id } as never);
        await tx`
          insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo, basis)
          values
            (${bid.buyer_team_id}, ${w.season_id}, null, 'transfer', ${-fee}, ${`transfer:${bid.id}:${bid.buyer_team_id}`}, ${rule},
              ${`Signed ${p.name} from ${teams!.seller}`}, ${basis}),
            (${bid.seller_team_id}, ${w.season_id}, null, 'transfer', ${fee}, ${`transfer:${bid.id}:${bid.seller_team_id}`}, ${rule},
              ${`Sold ${p.name} to ${teams!.buyer}`}, ${basis})
          on conflict (key) do nothing`;
        await tx`update players set team_id = ${bid.buyer_team_id}, shirt_number = ${shirt} where id = ${p.id}`;
        await tx`
          insert into player_registrations (season_id, player_id, team_id, transfer_id)
          values (${w.season_id}, ${p.id}, ${bid.buyer_team_id}, ${bid.id})
          on conflict (season_id, player_id) do update set team_id = excluded.team_id, transfer_id = excluded.transfer_id, created_at = now()`;
        await tx`update transfer_bids set status = 'completed', settled_at = now(),
            outcome = ${shirt === p.shirt_number ? null : `wears ${shirt} at ${teams!.buyer}`}
          where id = ${bid.id}`;
        await tx`update transfer_bids set status = 'outbid', decided_at = coalesce(decided_at, now()),
            outcome = coalesce(outcome, ${`${p.name} joined ${teams!.buyer}`})
          where window_id = ${w.id} and player_id = ${p.id} and id <> ${bid.id} and status in ('pending', 'accepted')`;
        faults?.duringSettlement?.(bid.id);
        return { player: p.name, buyer: bid.buyer_team_id, seller: bid.seller_team_id };
      });
      if (name) {
        mark(name.buyer, "in", name.player);
        mark(name.seller, "out", name.player);
      }
    } catch (e) {
      if (!(e instanceof DealFailed)) throw e; // a crash: nothing committed; the next tick retries
      await db`update transfer_bids set status = 'failed', settled_at = now(), outcome = ${e.message}
        where id = ${bid.id} and status = 'accepted'`;
    }
  }
  // Every deal in this window (including ones settled by an earlier, interrupted attempt).
  const deals = await db<{ team: string; dir: "in" | "out"; name: string }[]>`
    select b.buyer_team_id as team, 'in' as dir, p.name from transfer_bids b join players p on p.id = b.player_id
    where b.window_id = ${w.id} and b.status = 'completed'
    union all
    select b.seller_team_id, 'out', p.name from transfer_bids b join players p on p.id = b.player_id
    where b.window_id = ${w.id} and b.status = 'completed'`;
  for (const d of deals) if (!changed.get(d.team)?.[d.dir].includes(d.name)) mark(d.team, d.dir, d.name);
  for (const [team, c] of changed) await repairLineup(db, w.season_id, team, size, c);
  const [counts] = await db<{ completed: number; failed: number; rejected: number; lapsed: number; total: number }[]>`
    select count(*) filter (where status = 'completed')::int as completed, count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status in ('rejected', 'outbid'))::int as rejected, count(*) filter (where status = 'lapsed')::int as lapsed,
      count(*)::int as total
    from transfer_bids where window_id = ${w.id}`;
  return { ...counts!, season: season!.slug };
}

/**
 * Keeps a club's round-1 lineup valid after its squad changed: players who left are replaced by
 * the best remaining player for that place (same position by ability, else any outfielder).
 */
export async function repairLineup(
  db: Db,
  seasonId: string,
  teamId: string,
  size: TeamSize,
  change: { in: string[]; out: string[] },
) {
  const rev = await latestValidRevision(db, teamId, seasonId);
  if (!rev) return;
  const snapshot = await seasonRatings(db, seasonId);
  const squad = (
    await db<PlayerRow[]>`select * from players where retired_season_id is null and team_id = ${teamId}`
  ).map((p) => ratedPlayer(p, snapshot));
  const ids = new Set(squad.map((p) => p.id));
  const byId = new Map(squad.map((p) => [p.id, p]));
  const slots = SLOT_POSITIONS[size];
  const starters: Array<string | null> = rev.lineup.starters.map((id) => (ids.has(id) ? id : null));
  const best = [...squad].sort((a, b) => b.overall - a.overall || a.shirtNumber - b.shirtNumber);
  // Players who left: the best remaining player for the place.
  starters.forEach((id, i) => {
    if (id) return;
    const want = slots[i] ?? "MF";
    const pick =
      best.find((p) => p.position === want && !starters.includes(p.id)) ??
      (want === "GK" ? undefined : best.find((p) => p.position !== "GK" && !starters.includes(p.id)));
    starters[i] = pick?.id ?? null;
  });
  // Signings: each starts in place of the weakest starter in their position, if they're better.
  const started: string[] = [];
  for (const name of change.in) {
    const p = squad.find((x) => x.name === name);
    if (!p || starters.includes(p.id)) continue;
    const slot = starters
      .map((id, i) => ({ i, cur: id ? byId.get(id) : undefined }))
      .filter((s) => s.cur && s.cur.position === p.position && (p.position === "GK") === (s.i === 0))
      .sort((a, b) => a.cur!.overall - b.cur!.overall)[0];
    if (slot && slot.cur!.overall < p.overall) {
      starters[slot.i] = p.id;
      started.push(`${p.name} starts for ${slot.cur!.name}`);
    }
  }
  const unchanged =
    starters.length === rev.lineup.starters.length && starters.every((id, i) => id === rev.lineup.starters[i]);
  if (unchanged) return;
  const parts = [
    change.out.length ? `${change.out.join(", ")} left` : "",
    change.in.length ? `${change.in.join(", ")} joined` : "",
  ].filter(Boolean);
  await createRevision(db, {
    teamId,
    seasonId,
    source: "fallback",
    deployment: rev.deployment,
    starters: starters.filter((x): x is string => !!x),
    rationale: `Squad changed in the transfer window (${parts.join("; ")})${started.length ? `: ${started.join("; ")}` : ""}. The manager can change the side before kick-off.`,
  });
}
