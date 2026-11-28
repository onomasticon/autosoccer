/**
 * The transfer window (transfer/1): a short, unattended market between seasons.
 *
 * It opens when rollover creates a season with a transfer rule (after a completed season with club
 * finances) and runs three phases, each ending once every manager has answered or at its share of
 * the time before the deadline, whichever comes first:
 *   1. listing  — each club may invite offers for up to two of its players;
 *   2. bidding  — each club may bid for up to two players at other clubs (one bid per player);
 *   3. replying — each seller accepts at most one offer per player, or keeps the player.
 * Then every accepted deal settles, one atomic transaction each (settle.ts), and the window closes.
 *
 * The season starts on time: the deadline is before round 1's kick-off, and round 1 is never
 * released while a window is open (advanceSeason closes it first). A manager who is unavailable
 * (failed run, exhausted compute budget, or a reply after the phase ended) simply doesn't list,
 * doesn't bid, or keeps the player: unanswered offers lapse at the deadline.
 */
import type { Db } from "@autosoccer/db";
import { enqueue } from "../../jobs/queue.ts";
import { PermanentJobError } from "../../jobs/worker.ts";
import type { ManagerRow } from "../agents/facts.ts";
import {
  addUsage,
  finishRun,
  forManager,
  type ManagerDeps,
  reserveFor,
  startRun,
  type Usage,
  unlimitedGate,
} from "../agents/service.ts";
import {
  type ClubState,
  loadMarket,
  type Market,
  previousSeason,
  squadNeeds,
  squadProblem,
  type WindowRow,
  windowById,
} from "./market.ts";
import {
  BidDecision,
  ListingDecision,
  ReplyDecision,
  TRANSFER_TASKS,
  type TransferFacts,
  type TransferPhase,
  type TransferPlayerFact,
  transferPrompt,
  transferSystem,
} from "./prompts.ts";
import { minSquad, TRANSFER, TRANSFER_RULE } from "./rules.ts";
import { settleWindow } from "./settle.ts";

export const TRANSFER_JOB = "manager.transfer";
export const transferKey = (windowId: string, phase: TransferPhase, teamId: string) =>
  `${TRANSFER_JOB}:${windowId}:${phase}:${teamId}`;

const PHASES = TRANSFER.window.phases;

/**
 * Opens the window for a season if it qualifies: it has a transfer rule, hasn't kicked off, and
 * follows a completed season with club finances. Idempotent (one window per season).
 */
export async function openWindow(db: Db, seasonId: string, now = new Date()): Promise<WindowRow | null> {
  const [s] = await db<{ id: string; status: string; transfer_rule: string | null; starts_at: Date | null }[]>`
    select id, status, transfer_rule, starts_at from seasons where id = ${seasonId}`;
  // transfer/1 only: transfer/2 seasons use market windows (contracts/scheduler.ts).
  if (s?.transfer_rule !== TRANSFER_RULE || s.status !== "scheduled") return null;
  const [existing] = await db<WindowRow[]>`select * from transfer_windows where season_id = ${seasonId}`;
  if (existing) return existing;
  const [released] = await db`select 1 from fixtures where season_id = ${seasonId} and status <> 'scheduled' limit 1`;
  if (released) return null;
  const prev = await previousSeason(db, seasonId);
  if (!prev || prev.status !== "completed" || !prev.finance_rule) return null;
  const [first] = await db<{ at: Date | null }[]>`
    select min(scheduled_at) as at from fixtures where season_id = ${seasonId} and round = 1`;
  const kickoff = first?.at ?? s.starts_at ?? now;
  const margin = TRANSFER.window.closeBeforeKickoffMin * 60_000;
  const left = kickoff.getTime() - now.getTime();
  // Normally 15 minutes before kick-off; if the window opens late, halfway to kick-off.
  const deadline = new Date(now.getTime() + Math.max(0, left > 2 * margin ? left - margin : left / 2));
  const phaseEnds = new Date(now.getTime() + (deadline.getTime() - now.getTime()) / PHASES.length);
  const [w] = await db<WindowRow[]>`
    insert into transfer_windows (season_id, rule, opens_at, deadline, phase, phase_ends_at)
    values (${seasonId}, ${s.transfer_rule}, ${now}, ${deadline}, 'listing', ${phaseEnds})
    on conflict (season_id) do nothing returning *`;
  return w ?? (await db<WindowRow[]>`select * from transfer_windows where season_id = ${seasonId}`)[0]!;
}

export type WindowState =
  | { state: "none" }
  | { state: "open"; phase: TransferPhase; pending: number }
  | { state: "closed"; summary: Record<string, unknown> };

async function managedClubs(db: Db, seasonId: string) {
  return db<{ team_id: string }[]>`
    select m.team_id from manager_agents m join season_teams st on st.team_id = m.team_id
    where st.season_id = ${seasonId} order by m.team_id`;
}

async function enqueuePhase(db: Db, w: WindowRow, phase: TransferPhase) {
  const clubs = await managedClubs(db, w.season_id);
  for (const { team_id } of clubs) {
    if (phase === "replying") {
      const [has] = await db`
        select 1 from transfer_bids where window_id = ${w.id} and seller_team_id = ${team_id} and status = 'pending' limit 1`;
      if (!has) continue; // nothing to reply to
    }
    await enqueue(db, {
      kind: TRANSFER_JOB,
      key: transferKey(w.id, phase, team_id),
      payload: { windowId: w.id, phase, teamId: team_id },
      maxAttempts: 2,
    });
  }
}

async function pendingJobs(db: Db, w: WindowRow, phase: TransferPhase) {
  const [r] = await db<{ n: number }[]>`
    select count(*)::int as n from jobs where kind = ${TRANSFER_JOB} and payload->>'windowId' = ${w.id}
      and payload->>'phase' = ${phase} and status in ('queued', 'running')`;
  return r!.n;
}

/**
 * Moves a window along (call on every scheduler tick; idempotent): enqueues the current phase's
 * manager jobs, ends the phase when they're all done or its time is up, and settles and closes the
 * window after the replies or at the deadline. With `force`, settles and closes now (round 1 is due).
 */
export async function advanceWindow(
  db: Db,
  windowId: string,
  opts: { now?: Date; force?: boolean; faults?: SettleFaults } = {},
): Promise<WindowState> {
  const now = opts.now ?? new Date();
  for (let step = 0; step < PHASES.length + 1; step++) {
    const w = await windowById(db, windowId);
    if (!w) return { state: "none" };
    if (w.phase === "closed") return { state: "closed", summary: w.summary };
    if (opts.force || now >= w.deadline) {
      await closeWindow(db, w, opts.faults);
      continue;
    }
    const phase = w.phase as TransferPhase;
    await enqueuePhase(db, w, phase);
    const pending = await pendingJobs(db, w, phase);
    if (pending > 0 && now < w.phase_ends_at) return { state: "open", phase, pending };
    // The phase is over: everyone answered, or time is up (late answers are discarded).
    const i = PHASES.indexOf(phase);
    if (i === PHASES.length - 1) {
      await closeWindow(db, w, opts.faults);
      continue;
    }
    const left = w.deadline.getTime() - now.getTime();
    const ends = new Date(now.getTime() + left / (PHASES.length - 1 - i));
    await db`update transfer_windows set phase = ${PHASES[i + 1]!}, phase_ends_at = ${ends}
      where id = ${w.id} and phase = ${phase}`;
  }
  const w = await windowById(db, windowId);
  return w?.phase === "closed"
    ? { state: "closed", summary: w.summary }
    : { state: "open", phase: w!.phase as TransferPhase, pending: 0 };
}

export interface SettleFaults {
  /** Test hook: throw inside a deal's settlement transaction (before commit). */
  duringSettlement?: (bidId: string) => void;
}

async function closeWindow(db: Db, w: WindowRow, faults?: SettleFaults) {
  // Offers nobody answered lapse: the player stays.
  await db`update transfer_bids set status = 'lapsed', decided_at = now(),
      seller_reason = coalesce(seller_reason, 'No reply by the deadline: the player stays.')
    where window_id = ${w.id} and status = 'pending'`;
  const summary = await settleWindow(db, w, faults);
  await db`update transfer_windows set phase = 'closed', closed_at = now(), summary = ${db.json(summary as never)}
    where id = ${w.id} and phase <> 'closed'`;
}

/** Closes an open window for a season before its first round is released (the season starts on time). */
export async function closeWindowForKickoff(db: Db, seasonId: string): Promise<void> {
  const [w] = await db<{ id: string }[]>`
    select id from transfer_windows where season_id = ${seasonId} and phase <> 'closed'`;
  if (w) await advanceWindow(db, w.id, { force: true });
}

// ---------------------------------------------------------------------------------------------
// Facts and decisions

const factOf = (
  m: Market,
  p: Market["players"] extends Map<string, infer V> ? V : never,
  listings: Map<string, { asking_fee: string | null; reason: string }>,
): TransferPlayerFact => {
  const l = listings.get(p.id);
  return {
    ref: p.ref,
    shirt: p.shirt,
    name: p.name,
    club: m.clubs.get(p.teamId)?.name ?? "",
    position: p.position,
    overall: p.overall,
    wage: p.wage,
    guide: p.guide,
    lastSeason: p.lastSeason,
    listed: l ? { askingFee: l.asking_fee === null ? null : Number(l.asking_fee), reason: l.reason } : null,
  };
};

export async function transferFacts(
  db: Db,
  w: WindowRow,
  phase: TransferPhase,
  teamId: string,
  manager: ManagerRow,
): Promise<{ facts: TransferFacts; market: Market; club: ClubState; offers: Map<string, string> }> {
  const market = await loadMarket(db, w);
  const club = market.clubs.get(teamId);
  if (!club) throw new PermanentJobError("club is not in this season");
  const listings = new Map(
    (
      await db<{ player_id: string; asking_fee: string | null; reason: string }[]>`
        select player_id, asking_fee::text, reason from transfer_listings where window_id = ${w.id}`
    ).map((l) => [l.player_id, l]),
  );
  const offers = new Map<string, string>(); // label → bid id
  const facts: TransferFacts = {
    phase,
    manager: { name: manager.name, persona: manager.persona, philosophy: manager.philosophy, memory: manager.memory },
    team: { name: club.name },
    format: { playersPerTeam: market.size },
    window: { season: market.seasonName, deadline: w.deadline.toISOString() },
    rules: {
      maxListings: TRANSFER.maxListings,
      maxBids: TRANSFER.maxBids,
      minFee: TRANSFER.minFee,
      minSquad: minSquad(market.size),
      maxSquad: TRANSFER.squad.max,
      goalkeepers: TRANSFER.squad.goalkeepers,
    },
    finances: {
      cash: club.cash,
      distributionDue: club.distributionDue,
      wagesPerRound: club.wagesPerRound,
      rounds: club.rounds,
      seasonWages: club.seasonWages,
      headroom: club.headroom,
    },
    lastSeason: club.lastSeason,
    squad: club.squad.map((p) => factOf(market, p, listings)),
    needs: squadNeeds(club, market.size),
  };
  if (phase === "bidding")
    facts.market = [...market.players.values()]
      .filter((p) => p.teamId !== teamId)
      .map((p) => factOf(market, p, listings));
  if (phase === "replying") {
    const bids = await db<
      { id: string; player_id: string; buyer_team_id: string; fee: string; buyer_reason: string }[]
    >`
      select id, player_id, buyer_team_id, fee::text, buyer_reason from transfer_bids
      where window_id = ${w.id} and seller_team_id = ${teamId} and status = 'pending'
      order by player_id, fee desc, created_at, id`;
    facts.offers = bids.map((b, i) => {
      const label = `B${i + 1}`;
      offers.set(label, b.id);
      const p = market.players.get(b.player_id)!;
      return {
        label,
        ref: p.ref,
        player: p.name,
        buyer: market.clubs.get(b.buyer_team_id)?.name ?? "another club",
        fee: Number(b.fee),
        buyerReason: b.buyer_reason,
      };
    });
  }
  return { facts, market, club, offers };
}

export type TransferOutcome =
  | { status: "already-done" }
  | { status: "skipped-budget" }
  | { status: "late" }
  | { status: "decided"; stored: number; dropped: string[] };

/** Applies a validated decision, only while its phase is still open (a late answer changes nothing). */
async function apply(
  db: Db,
  w: WindowRow,
  phase: TransferPhase,
  teamId: string,
  runId: string,
  output: ListingDecision | BidDecision | ReplyDecision,
  ctx: { market: Market; club: ClubState; offers: Map<string, string> },
): Promise<{ late: boolean; stored: number; dropped: string[] }> {
  return db.begin(async (tx) => {
    const [cur] = await tx<{ phase: string }[]>`select phase from transfer_windows where id = ${w.id} for update`;
    if (cur?.phase !== phase) return { late: true, stored: 0, dropped: [] };
    const dropped: string[] = [];
    let stored = 0;
    const { market, club } = ctx;
    if (phase === "listing") {
      const d = output as ListingDecision;
      for (const l of d.listings.slice(0, TRANSFER.maxListings)) {
        const p = club.squad.find((x) => x.shirt === l.shirt);
        if (!p) {
          dropped.push(`no player with shirt ${l.shirt}`);
          continue;
        }
        const r = await tx`
          insert into transfer_listings (window_id, player_id, team_id, asking_fee, reason, agent_run_id)
          values (${w.id}, ${p.id}, ${teamId}, ${l.askingFee && l.askingFee > 0 ? l.askingFee : null}, ${l.reason}, ${runId})
          on conflict do nothing`;
        stored += r.count;
      }
      if (d.listings.length > TRANSFER.maxListings) dropped.push(`only ${TRANSFER.maxListings} listings allowed`);
    } else if (phase === "bidding") {
      const d = output as BidDecision;
      const byRef = new Map([...market.players.values()].map((p) => [p.ref, p]));
      let room = TRANSFER.squad.max - club.squad.length;
      for (const b of d.bids) {
        const p = byRef.get(b.player.trim().toUpperCase());
        if (stored >= TRANSFER.maxBids) dropped.push(`${b.player}: only ${TRANSFER.maxBids} bids allowed`);
        else if (!p) dropped.push(`${b.player}: no such player`);
        else if (p.teamId === teamId) dropped.push(`${b.player}: already your player`);
        else if (b.fee < TRANSFER.minFee) dropped.push(`${b.player}: below the minimum bid`);
        else if (b.fee > club.cash)
          dropped.push(`${b.player}: more than your cash (Ȼ${club.cash.toLocaleString("en-GB")})`);
        else if (room <= 0) dropped.push(`${b.player}: your squad would exceed ${TRANSFER.squad.max}`);
        else {
          const r = await tx`
            insert into transfer_bids (window_id, player_id, seller_team_id, buyer_team_id, fee, wage, buyer_reason, buyer_run_id)
            values (${w.id}, ${p.id}, ${p.teamId}, ${teamId}, ${b.fee}, ${p.wage}, ${b.reason}, ${runId})
            on conflict do nothing`;
          stored += r.count;
          room -= r.count;
        }
      }
    } else {
      const d = output as ReplyDecision;
      const decided = new Map<string, { decision: "accept" | "reject"; reason: string }>();
      for (const x of d.decisions) {
        const id = ctx.offers.get(x.offer.trim().toUpperCase());
        if (!id) dropped.push(`${x.offer}: no such offer`);
        else if (!decided.has(id)) decided.set(id, { decision: x.decision, reason: x.reason });
      }
      const bids = await tx<{ id: string; player_id: string; fee: string; created_at: Date; buyer_slug: string }[]>`
        select b.id, b.player_id, b.fee::text, b.created_at, t.slug as buyer_slug from transfer_bids b
        join teams t on t.id = b.buyer_team_id
        where b.window_id = ${w.id} and b.seller_team_id = ${teamId} and b.status = 'pending'`;
      // Tie resolution: at most one accepted offer per player — the highest fee, then the earliest
      // bid, then the buying club's slug. Acceptances that would break the squad rules are refused.
      const accepted = bids
        .filter((b) => decided.get(b.id)?.decision === "accept")
        .sort(
          (a, b) =>
            Number(b.fee) - Number(a.fee) ||
            a.created_at.getTime() - b.created_at.getTime() ||
            a.buyer_slug.localeCompare(b.buyer_slug),
        );
      const winner = new Map<string, string>();
      const leaving: Array<{ id: string; position: (typeof club.squad)[number]["position"] }> = [];
      const outcome = new Map<string, string>();
      for (const b of accepted) {
        if (winner.has(b.player_id)) {
          outcome.set(b.id, "a higher (or earlier) offer for the same player was accepted");
          continue;
        }
        const p = market.players.get(b.player_id)!;
        const problem = squadProblem(club.squad, market.size, { out: [...leaving, p] });
        if (problem) {
          outcome.set(b.id, `refused under squad rules: ${problem}`);
          continue;
        }
        winner.set(b.player_id, b.id);
        leaving.push(p);
      }
      for (const b of bids) {
        const dec = decided.get(b.id);
        const won = winner.get(b.player_id);
        const status = won === b.id ? "accepted" : won ? "outbid" : "rejected";
        await tx`update transfer_bids set status = ${status}, decided_at = now(), seller_run_id = ${runId},
            seller_reason = ${dec?.reason ?? "No decision given: the player stays."}, outcome = ${outcome.get(b.id) ?? null}
          where id = ${b.id} and status = 'pending'`;
        stored++;
      }
    }
    return { late: false, stored, dropped };
  });
}

const SCHEMAS = { listing: ListingDecision, bidding: BidDecision, replying: ReplyDecision } as const;

/** One manager's decision for one phase: grounded facts → model → validate → store. */
export async function runTransferDecision(
  deps: ManagerDeps,
  windowId: string,
  phase: TransferPhase,
  teamId: string,
): Promise<TransferOutcome> {
  const { db } = deps;
  const gate = deps.gate ?? unlimitedGate;
  const w = await windowById(db, windowId);
  if (!w) throw new PermanentJobError(`transfer window ${windowId} not found`);
  const [manager] = await db<ManagerRow[]>`select * from manager_agents where team_id = ${teamId}`;
  if (!manager) throw new PermanentJobError(`team ${teamId} has no manager`);
  deps = forManager(deps, manager.model);
  const llm = deps.llm;
  const start = await startRun(db, {
    key: transferKey(windowId, phase, teamId),
    agentId: manager.id,
    purpose: "transfer",
    seasonId: w.season_id,
    fixtureId: null,
  });
  if (start.done) return { status: "already-done" };
  const run = start.run;
  if (w.phase !== phase) {
    await finishRun(db, run.id, { status: "failed", error: `the ${phase} phase had already ended` });
    return { status: "late" };
  }
  const ids = { seasonId: w.season_id, teamId, runId: run.id };
  const ctx = await transferFacts(db, w, phase, teamId, manager);
  const system = transferSystem(ctx.facts);
  const prompt = transferPrompt(ctx.facts);
  const audit = { system, user: prompt, phase };
  if (!(await reserveFor(deps, ids, system, prompt))) {
    await finishRun(db, run.id, {
      status: "skipped_budget",
      prompt: audit,
      error: `season compute budget exhausted; no ${phase} decision`,
    });
    return { status: "skipped-budget" };
  }
  let usage: Usage | null = null;
  try {
    const res = await llm.complete({
      system,
      prompt,
      schema: SCHEMAS[phase] as never,
      task: TRANSFER_TASKS[phase],
      context: ctx.facts,
      maxTokens: deps.maxOutputTokens ?? 4000,
    });
    usage = addUsage(usage, res);
    await gate.settle({ ...ids, ...usage });
    const out = await apply(db, w, phase, teamId, run.id, res.output as never, ctx);
    if (out.late) {
      await finishRun(db, run.id, {
        status: "failed",
        prompt: audit,
        output: res.output,
        usage,
        error: `the ${phase} phase had already ended`,
      });
      return { status: "late" };
    }
    await finishRun(db, run.id, {
      status: "succeeded",
      prompt: audit,
      output: { ...(res.output as object), dropped: out.dropped },
      usage,
    });
    deps.log?.info("transfer decision", {
      phase,
      team: ctx.club.name,
      stored: out.stored,
      dropped: out.dropped.length,
    });
    return { status: "decided", stored: out.stored, dropped: out.dropped };
  } catch (e) {
    if (usage) await gate.settle({ ...ids, ...usage }).catch(() => {});
    else await gate.release(ids);
    await finishRun(db, run.id, {
      status: "failed",
      prompt: audit,
      usage: usage ?? undefined,
      error: (e as Error).message,
    });
    throw e;
  }
}

export function transferJobHandlers(deps: ManagerDeps) {
  return {
    [TRANSFER_JOB]: async (job: { payload: Record<string, unknown> }) => ({
      result: await runTransferDecision(
        deps,
        String(job.payload.windowId),
        String(job.payload.phase) as TransferPhase,
        String(job.payload.teamId),
      ),
    }),
  };
}

/** Scheduler hook: opens a qualifying upcoming season's window and moves every open window along. */
export async function tickTransfers(db: Db, opts: { now?: Date } = {}) {
  const upcoming = await db<{ id: string }[]>`
    select s.id from seasons s join leagues l on l.id = s.league_id
    where s.status = 'scheduled' and s.transfer_rule = ${TRANSFER_RULE} and l.status = 'active' order by s.created_at`;
  for (const s of upcoming) await openWindow(db, s.id, opts.now);
  const open = await db<{ id: string }[]>`select id from transfer_windows where phase <> 'closed' order by created_at`;
  const out: WindowState[] = [];
  for (const w of open) out.push(await advanceWindow(db, w.id, opts));
  return out;
}
