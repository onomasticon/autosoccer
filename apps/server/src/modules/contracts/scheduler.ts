/**
 * Phase 2 orchestration (#99): seasons built from calendar/1, and the transfer/2 market windows moved
 * along by the scheduler. Every step is idempotent, so any number of ticks, retries or workers give the
 * same result; a model that never answers doesn't stall anything (its club gets the safe default at
 * the step's deadline).
 *
 *  - A Phase 2 season gets calendar/1's exact timetable (staggered kickoffs, tactics locks, the final
 *    round all at once) and both market windows up front: preseason before round 1, midseason before
 *    the second half. A round never kicks off while its window is open (advanceSeason).
 *  - Each tick, for each open window whose time has come: queue one decision job per club for the
 *    current step; when every club has answered, or the step's deadline has passed, settle it.
 *  - The midseason window only opens once the first half is complete, so a delayed season never trades
 *    ahead of its own matches.
 */
import type { Db } from "@autosoccer/db";
import { enqueue } from "../../jobs/queue.ts";
import type { JobHandler } from "../../jobs/worker.ts";
import type { ManagerDeps } from "../agents/service.ts";
import { type CalendarConfig, DEFAULT_CALENDAR, seasonCalendar } from "../league/calendar.ts";
import { seededOrder } from "../league/schedule.ts";
import { createSeason } from "../league/service.ts";
import {
  CONTRACT_JOB,
  CONTRACT_RULE,
  contractKey,
  type MarketWindow,
  openMarketWindow,
  runContractDecision,
  type Step,
  settleFreeAgency,
  settleRenewals,
} from "./service.ts";

export interface Phase2SeasonInput {
  leagueId: string;
  slug: string;
  name: string;
  seed: number;
  teamSlugs: string[];
  /** When the season's preseason window opens (the founding phase, if any, comes before). */
  opens: Date;
  budgetPerTeamMicroUsd: number;
  editorialBudgetMicroUsd?: number;
  calendar?: Partial<CalendarConfig>;
}

/**
 * Creates a Phase 2 season (finance/3, transfer/2) from calendar/1, with its two market windows.
 * Idempotent by slug. insolvency/2 isn't persisted yet, so the season runs no solvency checks: a club
 * short of money shows a negative balance rather than forfeiting (insolvency/1 is never used here).
 */
export async function createPhase2Season(db: Db, input: Phase2SeasonInput) {
  const order = seededOrder(
    input.teamSlugs.map((slug) => ({ slug })),
    input.seed,
  ).map((t) => t.slug);
  const cfg: CalendarConfig = { ...DEFAULT_CALENDAR, foundingDays: 0, ...input.calendar, clubs: order.length };
  const cal = seasonCalendar(order, input.opens, cfg);
  const { seasonId, created } = await createSeason(db, {
    slug: input.slug,
    name: input.name,
    seed: input.seed,
    budgetPerTeamMicroUsd: input.budgetPerTeamMicroUsd,
    editorialBudgetMicroUsd: input.editorialBudgetMicroUsd,
    teamSlugs: input.teamSlugs,
    startsAt: cal.rounds[0]!.firstKickoff,
    leagueId: input.leagueId,
    financeRule: "finance/3",
    transferRule: CONTRACT_RULE,
    insolvencyRule: null,
    fixtures: cal.rounds.flatMap((r) =>
      r.fixtures.map((f) => ({ round: r.round, home: f.home, away: f.away, kickoff: f.kickoff })),
    ),
  });
  const pre = cal.windows.find((w) => w.kind === "preseason")!;
  const mid = cal.windows.find((w) => w.kind === "midseason")!;
  await openMarketWindow(db, seasonId, "preseason", pre.opens, pre.closes);
  await openMarketWindow(db, seasonId, "midseason", mid.opens, mid.closes);
  return { seasonId, created, calendar: cal };
}

async function clubsOf(db: Db, seasonId: string) {
  return db<{ team_id: string }[]>`select team_id from season_teams where season_id = ${seasonId} order by team_id`;
}

/** Whether every club has a finished run for this step (answered, failed, late or out of budget). */
async function allAnswered(db: Db, w: MarketWindow, step: Step) {
  const clubs = await clubsOf(db, w.season_id);
  const [r] = await db<{ n: number }[]>`
    select count(*)::int as n from agent_runs
    where idempotency_key = any(${clubs.map((c) => contractKey(w.id, step, c.team_id))})
      and status in ('succeeded', 'failed', 'skipped_budget')`;
  return r!.n >= clubs.length;
}

export interface WindowTick {
  windowId: string;
  kind: MarketWindow["kind"];
  action: "waiting" | "queued" | "settled-renewals" | "settled-free-agency";
}

/** Scheduler hook: moves every open transfer/2 window of an active league along (idempotent). */
export async function tickMarketWindows(db: Db, opts: { now?: Date } = {}): Promise<WindowTick[]> {
  const now = opts.now ?? new Date();
  const windows = await db<MarketWindow[]>`
    select w.* from market_windows w join seasons s on s.id = w.season_id join leagues l on l.id = s.league_id
    where w.phase <> 'closed' and l.status = 'active' and s.status in ('scheduled', 'active')
    order by w.opens_at, w.kind`;
  const out: WindowTick[] = [];
  for (const w of windows) {
    if (now < w.opens_at) {
      out.push({ windowId: w.id, kind: w.kind, action: "waiting" });
      continue;
    }
    if (w.kind === "midseason") {
      // Only once the first half has been played.
      const [left] = await db`
        select 1 from fixtures where season_id = ${w.season_id} and round < ${w.effective_round} and status <> 'completed' limit 1`;
      if (left) {
        out.push({ windowId: w.id, kind: w.kind, action: "waiting" });
        continue;
      }
    }
    const step = w.phase as Step;
    let due = step === "renewals" ? w.phase_ends_at : w.deadline;
    // A step that starts late (a delayed season, or a midseason window waiting on the first half) still
    // gives every manager its full time: its deadlines move to start now. Only before anyone was asked.
    const [asked] = await db`select 1 from jobs where idempotency_key like ${`contracts:${w.id}:${step}:%`} limit 1`;
    if (!asked && now >= due) {
      const span =
        step === "renewals" || w.kind === "midseason"
          ? w.deadline.getTime() - w.opens_at.getTime()
          : w.deadline.getTime() - w.phase_ends_at.getTime();
      const deadline = new Date(now.getTime() + span);
      const phaseEnds =
        step === "renewals"
          ? new Date(now.getTime() + (w.phase_ends_at.getTime() - w.opens_at.getTime()))
          : w.phase_ends_at;
      await db`update market_windows set deadline = ${deadline}, phase_ends_at = ${phaseEnds} where id = ${w.id}`;
      due = step === "renewals" ? phaseEnds : deadline;
    }
    if (now >= due || (await allAnswered(db, w, step))) {
      if (step === "renewals") await settleRenewals(db, w.id);
      else await settleFreeAgency(db, w.id);
      out.push({
        windowId: w.id,
        kind: w.kind,
        action: step === "renewals" ? "settled-renewals" : "settled-free-agency",
      });
      continue;
    }
    for (const c of await clubsOf(db, w.season_id))
      await enqueue(db, {
        kind: CONTRACT_JOB,
        key: contractKey(w.id, step, c.team_id),
        payload: { windowId: w.id, step, teamId: c.team_id, seasonId: w.season_id },
        maxAttempts: 2,
      });
    out.push({ windowId: w.id, kind: w.kind, action: "queued" });
  }
  return out;
}

export function contractJobHandlers(deps: ManagerDeps): Record<string, JobHandler> {
  return {
    [CONTRACT_JOB]: async (job) => {
      const p = job.payload as { windowId: string; step: Step; teamId: string };
      return { result: { ...(await runContractDecision(deps, p.windowId, p.step, p.teamId)) } };
    },
  };
}
