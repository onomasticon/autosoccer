/**
 * transfer/2 persistence (#96): contracts, the preseason and midseason windows, renewals and releases,
 * and free agency, for seasons whose transfer_rule is 'transfer/2'. Nothing here runs for the original
 * league (transfer/1).
 *
 * Exactly once: decisions are unique per window and contract (or player and club); settlement runs
 * under a row lock on the window and only from the phase it settles, so retries, repeated ticks and
 * several workers change nothing. Free agency is settled by recruit/1's simultaneous offer round: the
 * player picks the offer that suits him, ties go to a seeded order, never to the fastest club.
 */
import { createHash } from "node:crypto";
import type { PlayerAttributes, Position } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { PermanentJobError } from "../../jobs/worker.ts";
import {
  addUsage,
  finishRun,
  type ManagerDeps,
  reserveFor,
  startRun,
  type Usage,
  unlimitedGate,
} from "../agents/service.ts";
import { finance3, wageFor } from "../finance/rules.ts";
import { overallRating, playerAttributes } from "../league/attributes.ts";
import { seasonNumber } from "../league/rollover.ts";
import { type ClubState, type Offer, type PoolPlayer, settleRound } from "../players/recruitment.ts";
import { TRANSFER_2 } from "../transfers/rules.ts";
import {
  type ContractFacts,
  type ContractPlayerFact,
  contractPrompt,
  contractSystem,
  FreeAgentOffers,
  RenewalDecision,
} from "./decisions.ts";

export const CONTRACT_RULE = TRANSFER_2.version;
export const CONTRACT_JOB = "manager.contracts";
export type Step = "renewals" | "free_agency";
export const contractKey = (windowId: string, step: Step, teamId: string) => `contracts:${windowId}:${step}:${teamId}`;

export const SQUAD = { target: 14, min: 9, max: 16, keepers: 1 } as const;

/** Contract length by age at signing (finance/3 contractYears). */
export const yearsFor = (age: number) => (age >= 31 ? 1 : age >= 27 ? 2 : 3);

/** A season's market wage at a rating: finance/3's per-round wage over the season's rounds. */
export const marketWage = (overall: number, rounds: number) => wageFor(overall, finance3(rounds)) * rounds;

export interface MarketWindow {
  id: string;
  season_id: string;
  kind: "preseason" | "midseason";
  effective_round: number;
  opens_at: Date;
  phase_ends_at: Date;
  deadline: Date;
  phase: "renewals" | "free_agency" | "closed";
}

interface SeasonInfo {
  id: string;
  slug: string;
  seed: number;
  rounds: number;
  number: number;
}

async function seasonInfo(db: Db, seasonId: string): Promise<SeasonInfo> {
  const [s] = await db<{ id: string; slug: string; seed: string; rounds: number; transfer_rule: string | null }[]>`
    select s.id, s.slug, s.seed::text, s.transfer_rule,
      coalesce((select max(round) from fixtures f where f.season_id = s.id), 0)::int as rounds
    from seasons s where s.id = ${seasonId}`;
  if (!s) throw new PermanentJobError(`season ${seasonId} not found`);
  if (s.transfer_rule !== CONTRACT_RULE) throw new PermanentJobError(`season ${s.slug} doesn't use ${CONTRACT_RULE}`);
  return {
    id: s.id,
    slug: s.slug,
    seed: Number(s.seed),
    rounds: Math.max(2, s.rounds),
    number: seasonNumber(s.slug) ?? 1,
  };
}

/** Signs a contract (ending any active one first) inside a transaction. */
export async function signContract(
  tx: Db,
  c: {
    playerId: string;
    teamId: string;
    seasonId: string;
    wage: number;
    years: number;
    startsSeason: number;
    via: string;
    runId?: string | null;
  },
) {
  await tx`update player_contracts set status = 'transferred', ended_at = now() where player_id = ${c.playerId} and status = 'active'`;
  const [row] = await tx<{ id: string }[]>`
    insert into player_contracts (player_id, team_id, season_id, wage_per_season, starts_season, ends_season, via, rule, run_id)
    values (${c.playerId}, ${c.teamId}, ${c.seasonId}, ${c.wage}, ${c.startsSeason}, ${c.startsSeason + c.years - 1},
      ${c.via}, ${CONTRACT_RULE}, ${c.runId ?? null}) returning id`;
  return row!.id;
}

/** Opens a season's preseason or midseason window (idempotent). */
export async function openMarketWindow(
  db: Db,
  seasonId: string,
  kind: "preseason" | "midseason",
  opensAt: Date,
  deadline: Date,
): Promise<MarketWindow> {
  const s = await seasonInfo(db, seasonId);
  const effective = kind === "preseason" ? 1 : Math.floor(s.rounds / 2) + 1;
  // Preseason: renewals take the first half of the window, free agency the second. Midseason: free agency only.
  const phase = kind === "preseason" ? "renewals" : "free_agency";
  const phaseEnds = kind === "preseason" ? new Date((opensAt.getTime() + deadline.getTime()) / 2) : deadline;
  await db`
    insert into market_windows (season_id, kind, rule, effective_round, opens_at, phase_ends_at, deadline, phase)
    values (${seasonId}, ${kind}, ${CONTRACT_RULE}, ${effective}, ${opensAt}, ${phaseEnds}, ${deadline}, ${phase})
    on conflict (season_id, kind) do nothing`;
  const [w] = await db<MarketWindow[]>`select * from market_windows where season_id = ${seasonId} and kind = ${kind}`;
  return w!;
}

async function windowById(db: Db, id: string) {
  const [w] = await db<MarketWindow[]>`select * from market_windows where id = ${id}`;
  return w ?? null;
}

const cashOf = async (db: Db, teamId: string) =>
  Number(
    (
      await db<{ n: string }[]>`select coalesce(sum(amount), 0)::text as n from club_ledger where team_id = ${teamId}`
    )[0]!.n,
  );

interface PlayerRowLite {
  id: string;
  name: string;
  team_id: string | null;
  position: Position;
  shirt_number: number;
  born_season: number | null;
  attributes: PlayerAttributes | null;
}

/** Players with their ratings for the season (snapshot where there is one, else the baseline). */
async function playersOf(db: Db, seasonId: string, where: { teamId?: string; unattached?: boolean }) {
  const rows = await db<PlayerRowLite[]>`
    select p.id, p.name, p.team_id, p.position, p.shirt_number, p.born_season, r.attributes
    from players p left join player_ratings r on r.player_id = p.id and r.season_id = ${seasonId}
    where p.retired_season_id is null
      and (${where.teamId ?? null}::uuid is null or p.team_id = ${where.teamId ?? null}::uuid)
      and (${where.unattached ?? false} = false or p.team_id is null)
    order by p.shirt_number, p.id`;
  return rows.map((p) => {
    const attrs = p.attributes ?? playerAttributes({ name: p.name, shirtNumber: p.shirt_number, position: p.position });
    return { ...p, attrs, overall: overallRating(attrs, p.position) };
  });
}

const ageOf = (born: number | null, seasonNo: number) => (born == null ? 25 : seasonNo - born);

/** The facts a club's manager decides from, for a window step. */
export async function contractFacts(db: Db, w: MarketWindow, step: Step, teamId: string): Promise<ContractFacts> {
  const s = await seasonInfo(db, w.season_id);
  const [team] = await db<{ name: string }[]>`select name from teams where id = ${teamId}`;
  const squad = await playersOf(db, s.id, { teamId });
  const byOverall = [...squad].sort((a, b) => b.overall - a.overall);
  const gk = byOverall.find((p) => p.position === "GK");
  const starters = new Set([
    gk?.id,
    ...byOverall
      .filter((p) => p !== gk)
      .slice(0, 6)
      .map((p) => p.id),
  ]);
  const contracts = await db<{ id: string; player_id: string; wage_per_season: string; ends_season: number }[]>`
    select id, player_id, wage_per_season::text, ends_season from player_contracts where team_id = ${teamId} and status = 'active'`;
  const wageOf = new Map(contracts.map((c) => [c.player_id, Number(c.wage_per_season)]));
  const fact = (p: (typeof squad)[number]): ContractPlayerFact => ({
    playerId: p.id,
    name: p.name,
    position: p.position,
    age: ageOf(p.born_season, s.number),
    overall: p.overall,
    wagePerSeason: wageOf.get(p.id) ?? 0,
    marketWagePerSeason: marketWage(p.overall, s.rounds),
    starter: starters.has(p.id),
  });
  const base: ContractFacts = {
    window: w.kind,
    step,
    deadline: (step === "renewals" ? w.phase_ends_at : w.deadline).toISOString(),
    club: {
      name: team!.name,
      cash: await cashOf(db, teamId),
      wageBillPerSeason: [...wageOf.values()].reduce((a, b) => a + b, 0),
      squadSize: squad.length,
      squadTarget: SQUAD.target,
      squadMax: SQUAD.max,
    },
    squad: squad.map((p) => ({
      playerId: p.id,
      name: p.name,
      position: p.position,
      age: ageOf(p.born_season, s.number),
      overall: p.overall,
      starter: starters.has(p.id),
    })),
  };
  if (step === "renewals") {
    const ending = new Set(contracts.filter((c) => c.ends_season < s.number).map((c) => c.player_id));
    return { ...base, expiring: squad.filter((p) => ending.has(p.id)).map(fact) };
  }
  const free = await playersOf(db, s.id, { unattached: true });
  return {
    ...base,
    freeAgents: free.map((p) => ({
      ...fact(p),
      wagePerSeason: 0,
      minWagePerSeason: minWage(p.overall, s.rounds),
      wantsYears: yearsFor(ageOf(p.born_season, s.number)),
    })),
  };
}

/** The least a free agent signs for: 90% of the market wage at his rating, to the nearest Ȼ10k. */
export const minWage = (overall: number, rounds: number) =>
  Math.round((marketWage(overall, rounds) * 0.9) / 10_000) * 10_000;

export type ContractOutcome =
  | { status: "decided"; stored: number; dropped: string[] }
  | { status: "already-done" }
  | { status: "late" }
  | { status: "skipped-budget" };

/** One club's decision for one window step, through its own model. Recorded like any manager run. */
export async function runContractDecision(
  deps: ManagerDeps,
  windowId: string,
  step: Step,
  teamId: string,
): Promise<ContractOutcome> {
  const { db, llm } = deps;
  const gate = deps.gate ?? unlimitedGate;
  const w = await windowById(db, windowId);
  if (!w) throw new PermanentJobError(`market window ${windowId} not found`);
  const [manager] = await db<{ id: string; name: string; persona: string; philosophy: string }[]>`
    select id, name, persona, philosophy from manager_agents where team_id = ${teamId}`;
  if (!manager) throw new PermanentJobError(`team ${teamId} has no manager`);
  const start = await startRun(db, {
    key: contractKey(windowId, step, teamId),
    agentId: manager.id,
    purpose: "transfer",
    seasonId: w.season_id,
    fixtureId: null,
  });
  if (start.done) return { status: "already-done" };
  const run = start.run;
  if (w.phase !== step) {
    await finishRun(db, run.id, { status: "failed", error: `the ${step} step had already ended` });
    return { status: "late" };
  }
  const facts = await contractFacts(db, w, step, teamId);
  const system = contractSystem(manager, facts.club.name);
  const prompt = contractPrompt(facts);
  const ids = { seasonId: w.season_id, teamId, runId: run.id };
  if (!(await reserveFor(deps, ids, system, prompt))) {
    await finishRun(db, run.id, {
      status: "skipped_budget",
      prompt: { system, user: prompt },
      error: `compute budget exhausted; no ${step} decision`,
    });
    return { status: "skipped-budget" };
  }
  let usage: Usage | null = null;
  try {
    const res = await llm.complete({
      system,
      prompt,
      schema: (step === "renewals" ? RenewalDecision : FreeAgentOffers) as never,
      task: `contracts.${step}`,
      context: facts,
      maxTokens: deps.maxOutputTokens ?? 4000,
    });
    usage = addUsage(usage, res);
    await gate.settle({ ...ids, ...usage });
    const out =
      step === "renewals"
        ? await storeRenewals(db, w, teamId, run.id, res.output as RenewalDecision, facts)
        : await storeOffers(db, w, teamId, run.id, res.output as FreeAgentOffers, facts);
    if (out.late) {
      await finishRun(db, run.id, {
        status: "failed",
        prompt: { system, user: prompt },
        output: res.output,
        usage,
        error: `the ${step} step had already ended`,
      });
      return { status: "late" };
    }
    await finishRun(db, run.id, {
      status: "succeeded",
      prompt: { system, user: prompt },
      output: { ...(res.output as object), dropped: out.dropped },
      usage,
    });
    return { status: "decided", stored: out.stored, dropped: out.dropped };
  } catch (e) {
    if (usage) await gate.settle({ ...ids, ...usage }).catch(() => {});
    await finishRun(db, run.id, {
      status: "failed",
      prompt: { system, user: prompt },
      usage: usage ?? undefined,
      error: (e as Error).message,
    });
    // An unavailable model makes no choice: the safe defaults apply at the deadline.
    return { status: "decided", stored: 0, dropped: [`no decision: ${(e as Error).message}`] };
  }
}

async function storeRenewals(
  db: Db,
  w: MarketWindow,
  teamId: string,
  runId: string,
  out: RenewalDecision,
  f: ContractFacts,
) {
  const dropped: string[] = [];
  let stored = 0;
  const late = await db.begin(async (tx) => {
    const t = tx as unknown as Db;
    const [cur] = await t<{ phase: string }[]>`select phase from market_windows where id = ${w.id} for update`;
    if (cur?.phase !== "renewals") return true;
    const expiring = new Set((f.expiring ?? []).map((p) => p.playerId));
    for (const d of out.decisions) {
      if (!expiring.has(d.playerId)) {
        dropped.push(`${d.playerId}: not one of your expiring contracts`);
        continue;
      }
      const r = await t`
        insert into contract_decisions (window_id, contract_id, team_id, decision, source, reason, run_id)
        select ${w.id}, c.id, ${teamId}, ${d.decision}, 'manager', ${d.reason}, ${runId}
        from player_contracts c where c.player_id = ${d.playerId} and c.team_id = ${teamId} and c.status = 'active'
        on conflict do nothing`;
      stored += r.count;
    }
    return false;
  });
  return { late, stored, dropped };
}

async function storeOffers(
  db: Db,
  w: MarketWindow,
  teamId: string,
  runId: string,
  out: FreeAgentOffers,
  f: ContractFacts,
) {
  const dropped: string[] = [];
  let stored = 0;
  const late = await db.begin(async (tx) => {
    const t = tx as unknown as Db;
    const [cur] = await t<{ phase: string }[]>`select phase from market_windows where id = ${w.id} for update`;
    if (cur?.phase !== "free_agency") return true;
    const free = new Map((f.freeAgents ?? []).map((p) => [p.playerId, p]));
    let committed = 0;
    for (const o of out.offers) {
      const p = free.get(o.playerId);
      if (!p) {
        dropped.push(`${o.playerId}: not a free agent`);
        continue;
      }
      if (o.wagePerSeason < p.minWagePerSeason) {
        dropped.push(`${p.name}: below his minimum of Ȼ${p.minWagePerSeason.toLocaleString("en-GB")}`);
        continue;
      }
      if (committed + o.wagePerSeason > f.club.cash) {
        dropped.push(`${p.name}: more than your cash allows`);
        continue;
      }
      committed += o.wagePerSeason;
      const r = await t`
        insert into free_agent_offers (window_id, player_id, team_id, wage_per_season, years, reason, run_id)
        values (${w.id}, ${o.playerId}, ${teamId}, ${o.wagePerSeason}, ${o.years}, ${o.reason}, ${runId})
        on conflict do nothing`;
      stored += r.count;
    }
    return false;
  });
  return { late, stored, dropped };
}

/**
 * Settles renewals (preseason): every expiring contract is renewed at the market wage or released.
 * A contract nobody decided on is renewed (the safe default). Releases leave the club, their season
 * registration and their wage; they become free agents. Then the window moves to free agency.
 */
export async function settleRenewals(db: Db, windowId: string): Promise<{ renewed: number; released: number } | null> {
  return db.begin(async (tx) => {
    const t = tx as unknown as Db;
    const [w] = await t<MarketWindow[]>`select * from market_windows where id = ${windowId} for update`;
    if (!w || w.phase !== "renewals") return null;
    const s = await seasonInfo(t, w.season_id);
    const expiring = await t<{ id: string; player_id: string; team_id: string }[]>`
      select c.id, c.player_id, c.team_id from player_contracts c
      join season_teams st on st.team_id = c.team_id and st.season_id = ${s.id}
      where c.status = 'active' and c.ends_season < ${s.number} order by c.id`;
    let renewed = 0;
    let released = 0;
    for (const c of expiring) {
      const [d] = await t<
        { decision: string }[]
      >`select decision from contract_decisions where window_id = ${w.id} and contract_id = ${c.id}`;
      if (!d)
        await t`insert into contract_decisions (window_id, contract_id, team_id, decision, source, reason)
          values (${w.id}, ${c.id}, ${c.team_id}, 'renew', 'default', 'No decision by the deadline: the player is kept.')`;
      const [p] = await playersOf(t, s.id, { teamId: c.team_id }).then((ps) => ps.filter((x) => x.id === c.player_id));
      if (!p) continue;
      if (d?.decision === "release") {
        await t`update player_contracts set status = 'released', ended_at = now() where id = ${c.id}`;
        await t`update players set team_id = null, free_agent_since_season_id = ${s.id} where id = ${c.player_id}`;
        await t`delete from player_registrations where season_id = ${s.id} and player_id = ${c.player_id}`;
        released++;
      } else {
        await t`update player_contracts set status = 'expired', ended_at = now() where id = ${c.id}`;
        await signContract(t, {
          playerId: c.player_id,
          teamId: c.team_id,
          seasonId: s.id,
          wage: marketWage(p.overall, s.rounds),
          years: yearsFor(ageOf(p.born_season, s.number)),
          startsSeason: s.number,
          via: "renewal",
        });
        renewed++;
      }
    }
    await t`update market_windows set phase = 'free_agency', summary = summary || ${t.json({ renewed, released })} where id = ${w.id}`;
    return { renewed, released };
  });
}

/**
 * Settles free agency: every offer at once through recruit/1's offer round. A signing gives the player
 * a club, a shirt, a contract and a registration (from round 1 in preseason, or a registration move
 * from the window's effective round in midseason). No fee changes hands.
 */
export async function settleFreeAgency(db: Db, windowId: string): Promise<{ signed: number } | null> {
  return db.begin(async (tx) => {
    const t = tx as unknown as Db;
    const [w] = await t<MarketWindow[]>`select * from market_windows where id = ${windowId} for update`;
    if (!w || w.phase !== "free_agency") return null;
    const s = await seasonInfo(t, w.season_id);
    const free = await playersOf(t, s.id, { unattached: true });
    const pool = new Map<string, PoolPlayer & { club: string | null }>(
      free.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          position: p.position,
          age: ageOf(p.born_season, s.number),
          attributes: p.attrs,
          overall: p.overall,
          potential: p.overall,
          prefs: {
            minWage: minWage(p.overall, s.rounds),
            years: yearsFor(ageOf(p.born_season, s.number)),
            playingTime: 0.5,
          },
          club: null,
        },
      ]),
    );
    const teams = await t<
      { team_id: string }[]
    >`select team_id from season_teams where season_id = ${s.id} order by team_id`;
    const clubs = new Map<string, ClubState>();
    for (const { team_id } of teams) {
      const squad = await t<
        { id: string }[]
      >`select id from players where team_id = ${team_id} and retired_season_id is null`;
      clubs.set(team_id, { id: team_id, budget: await cashOf(t, team_id), squad: squad.map((x) => x.id) });
    }
    // Squad limits for transfer/2 (recruit/1's own max is the same 16).
    const offers = await t<
      { id: string; player_id: string; team_id: string; wage_per_season: string; years: number; submitted_at: Date }[]
    >`
      select id, player_id, team_id, wage_per_season::text, years, submitted_at from free_agent_offers where window_id = ${w.id} order by id`;
    const asOffer = (o: (typeof offers)[number]): Offer => ({
      club: o.team_id,
      player: o.player_id,
      wage: Number(o.wage_per_season),
      bonus: 0,
      years: o.years,
      submittedAt: o.submitted_at,
    });
    const seed = createHash("sha256").update(`free-agency:${w.id}`).digest().readUInt32BE(0);
    const result = settleRound(seed, 1, w.deadline, pool, clubs, offers.map(asOffer));
    for (const o of result.outcomes) {
      const row = offers.find((x) => x.player_id === o.offer.player && x.team_id === o.offer.club);
      if (row) await t`update free_agent_offers set outcome = ${o.outcome} where id = ${row.id}`;
    }
    for (const sg of result.signings) {
      const [shirt] = await t<{ n: number }[]>`
        select min(n)::int as n from generate_series(1, 99) n
        where n not in (select shirt_number from players where team_id = ${sg.club})`;
      await t`update players set team_id = ${sg.club}, shirt_number = ${shirt!.n}, free_agent_since_season_id = null where id = ${sg.player}`;
      await signContract(t, {
        playerId: sg.player,
        teamId: sg.club,
        seasonId: s.id,
        wage: sg.wage,
        years: sg.years,
        startsSeason: s.number,
        via: "free_agent",
      });
      if (w.effective_round === 1)
        await t`insert into player_registrations (season_id, player_id, team_id) values (${s.id}, ${sg.player}, ${sg.club})
          on conflict (season_id, player_id) do update set team_id = excluded.team_id`;
      else
        await t`insert into registration_moves (season_id, player_id, from_round, from_team_id, to_team_id, via, window_id)
          values (${s.id}, ${sg.player}, ${w.effective_round}, null, ${sg.club}, 'free_agent', ${w.id}) on conflict do nothing`;
    }
    await t`update market_windows set phase = 'closed', closed_at = now(),
      summary = summary || ${t.json({ signed: result.signings.length, offers: offers.length })} where id = ${w.id}`;
    return { signed: result.signings.length };
  });
}

/** The club a player represents in a season's round: the latest move up to that round, else his season registration. */
export async function registeredTeam(
  db: Db,
  seasonId: string,
  playerId: string,
  round: number,
): Promise<string | null> {
  const [m] = await db<{ to_team_id: string | null }[]>`
    select to_team_id from registration_moves where season_id = ${seasonId} and player_id = ${playerId} and from_round <= ${round}
    order by from_round desc limit 1`;
  if (m) return m.to_team_id;
  const [r] = await db<
    { team_id: string }[]
  >`select team_id from player_registrations where season_id = ${seasonId} and player_id = ${playerId}`;
  return r?.team_id ?? null;
}
