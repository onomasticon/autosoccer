/**
 * The inaugural phase of a new league (#95, #96, #99, `inaugural/1`): calendar/1's founding
 * window (8 hours of founding, then 6 days of recruitment), run by the scheduler, before the operator activates the league.
 *
 *   hour 0–8  founding: up to three founding rounds, 2h40m apart (one job per round; every founder
 *             answers through its own model, results settled in a seeded order: founding/1)
 *   hour 8    the season is created for the clubs that were founded: each gets its opening balance,
 *             and the shared talent pool is created as the league's own unattached players
 *   day ⅓–6⅓  recruitment: three simultaneous offer rounds of 48 hours each, as market windows settled
 *             by recruit/1's offer round (every club's offers at once; a faster model gains nothing)
 *   day 6⅓    the safety net: a club still short of a viable squad is assigned the best remaining
 *             players at minimum terms plus the stated fee (charged, and shown as such), then the
 *             preseason window and the season, once the operator has activated the league
 *
 * Every step is idempotent and keyed, so ticks, retries and several workers give the same result.
 * Activation stays an explicit operator step, refused until every club has a viable, contracted squad.
 */

import { createHash } from "node:crypto";
import { defaultTactics, type TeamSize } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { enqueue } from "../../jobs/queue.ts";
import type { JobHandler } from "../../jobs/worker.ts";
import type { LlmClient } from "../agents/llm.ts";
import { createPhase2Season } from "../contracts/scheduler.ts";
import { minWage, openMarketWindow, signContract } from "../contracts/service.ts";
import { seasonRules } from "../finance/settle.ts";
import type { CalendarConfig } from "../league/calendar.ts";
import { seasonTeamSize } from "../league/read.ts";
import { type PlayerRow, toPlayer } from "../mappers.ts";
import { defaultLineup } from "../matches/lineup.ts";
import { type ClubState, generatePool, type PoolPlayer, RECRUIT, safetyNet } from "../players/recruitment.ts";
import { createRevision, latestValidRevision, tacticalDeployment } from "../tactics/service.ts";
import { repairLineup } from "../transfers/settle.ts";
import { type Founder, inviteFounders, MAX_ROUNDS, runFoundingRound } from "./service.ts";

export const INAUGURAL_RULE = "inaugural/1";
export const FOUNDING_JOB = "league.founding";

const H = 3_600_000;
/** The founding window's timetable (calendar/1's founding days), in hours from when it opens. */
export const INAUGURAL = {
  version: INAUGURAL_RULE,
  /** Founding takes 8 hours: three rounds, 2h40m apart. */
  foundingRoundHours: 8 / 3,
  foundingRounds: MAX_ROUNDS,
  recruitmentRoundHours: 48,
  recruitmentRounds: RECRUIT.rounds,
} as const;

/** Hours from founding opening to the season's preseason window: founding (8h), then recruitment (6 days). */
export const INAUGURAL_HOURS =
  INAUGURAL.foundingRounds * INAUGURAL.foundingRoundHours +
  INAUGURAL.recruitmentRounds * INAUGURAL.recruitmentRoundHours;

/**
 * The launch's spend caps (#101), the defaults for `bun run leagues inaugural`. From the live pilot's
 * measured cost per decision: the league's managers cost about $40 a season (about $52 per 30 days),
 * the dearest club about $7.50 before its answers got more room.
 * - Managers: $10 per club per season covers the dearest model with headroom. It's a hard ceiling
 *   (every call reserves its worst case), so the league can't spend more than 20 × $10 a season.
 * - Newsroom: $25 a season (about 340 pieces at the measured ~$0.07 each). Past it, the offline
 *   template writer covers the rest at no cost.
 */
export const LAUNCH_CAPS = {
  managerPerClubPerSeasonUsd: 10,
  editorialPerSeasonUsd: 25,
} as const;

export interface InauguralSettings {
  rule: typeof INAUGURAL_RULE;
  opens: string;
  seed: number;
  models: string[];
  budgetPerTeamMicroUsd: number;
  editorialBudgetMicroUsd?: number;
  calendar?: Partial<CalendarConfig>;
}

interface League {
  id: string;
  slug: string;
  status: string;
  inaugural: InauguralSettings | null;
  inaugural_season_id: string | null;
}

const at = (s: InauguralSettings, hours: number) => new Date(new Date(s.opens).getTime() + hours * H);
const RECRUITMENT_OPENS = INAUGURAL.foundingRounds * INAUGURAL.foundingRoundHours;
const safetyNetAt = (s: InauguralSettings) =>
  at(s, RECRUITMENT_OPENS + INAUGURAL.recruitmentRounds * INAUGURAL.recruitmentRoundHours);

/**
 * Schedules a draft league's inaugural phase: invites the founder models and lays out the founding
 * rounds and the safety net. Idempotent. Nothing calls a model until the scheduler reaches round 1.
 */
export async function startInaugural(
  db: Db,
  leagueSlug: string,
  input: Omit<InauguralSettings, "rule" | "opens"> & { opens: Date },
): Promise<{ founders: Founder[]; settings: InauguralSettings }> {
  if (input.models.length < 2) throw new Error("a league needs at least two founders");
  return db.begin(async (tx) => {
    const t = tx as unknown as Db;
    const [l] = await t<League[]>`select * from leagues where slug = ${leagueSlug} for update`;
    if (!l) throw new Error(`no league ${leagueSlug}`);
    if (l.status !== "draft")
      throw new Error(`${leagueSlug} is ${l.status}: the inaugural phase is for a draft league`);
    const settings: InauguralSettings = l.inaugural ?? {
      rule: INAUGURAL_RULE,
      opens: input.opens.toISOString(),
      seed: input.seed,
      models: input.models,
      budgetPerTeamMicroUsd: input.budgetPerTeamMicroUsd,
      editorialBudgetMicroUsd: input.editorialBudgetMicroUsd,
      calendar: input.calendar,
    };
    if (!l.inaugural) await t`update leagues set inaugural = ${t.json(settings as never)} where id = ${l.id}`;
    for (let r = 1; r <= INAUGURAL.foundingRounds; r++)
      await t`insert into league_phases (league_id, kind, round, opens_at)
        values (${l.id}, 'founding', ${r}, ${at(settings, (r - 1) * INAUGURAL.foundingRoundHours)}) on conflict do nothing`;
    await t`insert into league_phases (league_id, kind, round, opens_at)
      values (${l.id}, 'safety_net', 1, ${safetyNetAt(settings)}) on conflict do nothing`;
    return { founders: await inviteFounders(t, l.id, settings.models), settings };
  });
}

export interface InauguralTick {
  league: string;
  state: "founding" | "recruitment" | "ready" | "waiting";
  detail: string;
}

/** Scheduler hook: moves every draft league's inaugural phase along (idempotent). */
export async function tickInaugural(db: Db, opts: { now?: Date } = {}): Promise<InauguralTick[]> {
  const now = opts.now ?? new Date();
  const leagues = await db<
    League[]
  >`select * from leagues where status = 'draft' and inaugural is not null order by slug`;
  const out: InauguralTick[] = [];
  for (const l of leagues) out.push(await tickLeague(db, l, now));
  return out;
}

async function tickLeague(db: Db, l: League, now: Date): Promise<InauguralTick> {
  const s = l.inaugural!;
  const tick = (state: InauguralTick["state"], detail: string) => ({ league: l.slug, state, detail });
  // 1. Founding rounds, in order, each when its time comes.
  const founding = await db<{ round: number; opens_at: Date }[]>`
    select round, opens_at from league_phases where league_id = ${l.id} and kind = 'founding' and status = 'pending' order by round`;
  for (const p of founding) {
    const [left] = await db<{ n: number }[]>`
      select count(*)::int as n from founders where league_id = ${l.id} and status = 'invited'`;
    if (!left!.n) {
      await settlePhase(db, l.id, "founding", p.round, { skipped: "no founder left to answer" });
      continue;
    }
    if (now < p.opens_at) return tick("founding", `founding round ${p.round} opens at ${p.opens_at.toISOString()}`);
    await enqueue(db, {
      kind: FOUNDING_JOB,
      key: `founding:${l.id}:${p.round}`,
      payload: { leagueId: l.id, round: p.round },
      maxAttempts: 2,
    });
    return tick("founding", `founding round ${p.round} in progress`);
  }
  // 2. The season, for the clubs that were founded.
  const seasonId = l.inaugural_season_id ?? (await createInauguralSeason(db, l));
  if (!seasonId) return tick("waiting", "fewer than two clubs were founded: an operator has to decide");
  // 3. Recruitment rounds are market windows (tickMarketWindows moves them along, in a draft league too).
  const [open] = await db<{ round: number }[]>`
    select round from market_windows where season_id = ${seasonId} and kind = 'recruitment' and phase <> 'closed' order by round limit 1`;
  if (open) return tick("recruitment", `recruitment round ${open.round} of ${INAUGURAL.recruitmentRounds}`);
  // 4. The safety net, once every offer round has settled.
  const [net] =
    await db`select 1 from league_phases where league_id = ${l.id} and kind = 'safety_net' and status = 'pending'`;
  if (net) {
    const summary = await runSafetyNet(db, seasonId);
    await settlePhase(db, l.id, "safety_net", 1, summary);
    await seedOpeningTactics(db, seasonId);
  }
  return tick("ready", "every club has its squad: the league can be activated");
}

async function settlePhase(db: Db, leagueId: string, kind: string, round: number, summary: Record<string, unknown>) {
  await db`update league_phases set status = 'settled', settled_at = now(), summary = ${db.json(summary as never)}
    where league_id = ${leagueId} and kind = ${kind} and round = ${round} and status = 'pending'`;
}

/** Season 1 for the founded clubs, their opening balances, the talent pool and the recruitment rounds. */
async function createInauguralSeason(db: Db, l: League): Promise<string | null> {
  const s = l.inaugural!;
  const clubs = await db<{ slug: string; id: string }[]>`
    select t.slug, t.id from founders f join teams t on t.id = f.team_id
    where f.league_id = ${l.id} and f.status = 'founded' order by t.slug`;
  if (clubs.length < 2) return null;
  const { seasonId } = await createPhase2Season(db, {
    leagueId: l.id,
    slug: `${l.slug}-season-1`,
    name: "Season 1",
    seed: s.seed,
    teamSlugs: clubs.map((c) => c.slug),
    opens: at(s, INAUGURAL_HOURS),
    budgetPerTeamMicroUsd: s.budgetPerTeamMicroUsd,
    editorialBudgetMicroUsd: s.editorialBudgetMicroUsd,
    calendar: s.calendar,
  });
  await db.begin(async (tx) => {
    const t = tx as unknown as Db;
    const [locked] = await t<League[]>`select * from leagues where id = ${l.id} for update`;
    if (locked!.inaugural_season_id) return;
    const R = await seasonRules(t, seasonId);
    // Opening balances land now (same key as finance's own, so they're never paid twice): clubs need
    // the money to make recruitment offers.
    for (const c of clubs)
      await t`insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo, basis)
        values (${c.id}, null, null, 'opening', ${R.opening}, ${`opening:${c.id}`}, ${INAUGURAL_RULE}, 'Opening balance',
          ${t.json({ firstSeason: `${l.slug}-season-1` })}) on conflict (key) do nothing`;
    // The shared pool: one deterministic set of unattached players, the league's own.
    for (const [i, p] of generatePool(s.seed, clubs.length).entries()) {
      const [row] = await t<{ id: string }[]>`
        insert into players (team_id, pool_league_id, name, shirt_number, position, born_season)
        values (null, ${l.id}, ${p.name}, ${(i % 99) + 1}, ${p.position}, ${1 - p.age}) returning id`;
      await t`insert into player_ratings (player_id, season_id, attributes, overall, rule, basis)
        values (${row!.id}, ${seasonId}, ${t.json(p.attributes as never)}, ${p.overall}, ${RECRUIT.version},
          ${t.json({ pool: p.id, potential: p.potential, age: p.age })})`;
    }
    for (let r = 1; r <= INAUGURAL.recruitmentRounds; r++) {
      const opens = at(s, RECRUITMENT_OPENS + (r - 1) * INAUGURAL.recruitmentRoundHours);
      await openMarketWindow(
        t,
        seasonId,
        "recruitment",
        opens,
        new Date(opens.getTime() + INAUGURAL.recruitmentRoundHours * H),
        r,
      );
    }
    await t`update leagues set inaugural_season_id = ${seasonId} where id = ${l.id}`;
  });
  return seasonId;
}

/**
 * recruit/1's safety net: each club still short of a viable squad (the minimum, with a keeper), in a
 * seeded order, gets the best remaining pool players at minimum terms (the shortest contract) plus the
 * stated fee per player, charged even if it takes the club below zero. Idempotent (fee keys per player).
 */
export async function runSafetyNet(db: Db, seasonId: string): Promise<{ assigned: number; clubs: string[] }> {
  return db.begin(async (tx) => {
    const t = tx as unknown as Db;
    await t`select pg_advisory_xact_lock(hashtext(${`safety-net:${seasonId}`}))`;
    const [season] = await t<{ seed: string; league_id: string; rounds: number }[]>`
      select seed::text, league_id, coalesce((select max(round) from fixtures f where f.season_id = s.id), 2)::int as rounds
      from seasons s where s.id = ${seasonId}`;
    const rows = await t<
      {
        id: string;
        team_id: string | null;
        position: PoolPlayer["position"];
        overall: number | null;
        born_season: number | null;
      }[]
    >`
      select p.id, p.team_id, p.position, r.overall, p.born_season
      from players p left join player_ratings r on r.player_id = p.id and r.season_id = ${seasonId}
      where p.retired_season_id is null and (p.team_id in (select team_id from season_teams where season_id = ${seasonId})
        or (p.team_id is null and p.pool_league_id = ${season!.league_id}))`;
    const pool = new Map<string, PoolPlayer & { club: string | null }>(
      rows.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.id,
          position: p.position,
          age: 1 - (p.born_season ?? -24),
          attributes: {} as never,
          overall: p.overall ?? 50,
          potential: p.overall ?? 50,
          prefs: { minWage: minWage(p.overall ?? 50, season!.rounds), years: 1, playingTime: 0 },
          club: p.team_id,
        },
      ]),
    );
    const clubs = new Map<string, ClubState>();
    for (const { team_id } of await t<
      { team_id: string }[]
    >`select team_id from season_teams where season_id = ${seasonId}`) {
      const [cash] = await t<
        { n: string }[]
      >`select coalesce(sum(amount), 0)::text as n from club_ledger where team_id = ${team_id}`;
      clubs.set(team_id, {
        id: team_id,
        budget: Number(cash!.n),
        squad: rows.filter((p) => p.team_id === team_id).map((p) => p.id),
      });
    }
    const seed = createHash("sha256").update(`safety-net:${seasonId}:${season!.seed}`).digest().readUInt32BE(0);
    const signings = safetyNet(seed, pool, clubs);
    for (const sg of signings) {
      const key = `safety-net:${seasonId}:${sg.player}`;
      const fee = await t`insert into club_ledger (team_id, season_id, round, kind, amount, key, rule, memo, basis)
        values (${sg.club}, ${seasonId}, null, 'recruitment', ${-sg.bonus}, ${key}, ${RECRUIT.version},
          'Safety-net assignment fee', ${t.json({ player: sg.player, wage: sg.wage })}) on conflict (key) do nothing`;
      if (!fee.count) continue;
      const [shirt] = await t<{ n: number }[]>`
        select min(n)::int as n from generate_series(1, 99) n where n not in (select shirt_number from players where team_id = ${sg.club})`;
      await t`update players set team_id = ${sg.club}, shirt_number = ${shirt!.n} where id = ${sg.player}`;
      await signContract(t, {
        playerId: sg.player,
        teamId: sg.club,
        seasonId,
        wage: sg.wage,
        years: sg.years,
        startsSeason: 1,
        via: "safety_net",
      });
      await t`insert into player_registrations (season_id, player_id, team_id) values (${seasonId}, ${sg.player}, ${sg.club})
        on conflict (season_id, player_id) do update set team_id = excluded.team_id`;
    }
    return { assigned: signings.length, clubs: [...new Set(signings.map((s) => s.club))] };
  });
}

/** Each club's opening setup (default tactics, its best side), unless its manager already has one. */
export async function seedOpeningTactics(
  db: Db,
  seasonId: string,
  rationale = "Opening setup after recruitment (the manager sets its own before round 1).",
) {
  const size = await seasonTeamSize(db, seasonId);
  for (const { team_id } of await db<
    { team_id: string }[]
  >`select team_id from season_teams where season_id = ${seasonId}`) {
    const squad = (
      await db<PlayerRow[]>`select * from players where retired_season_id is null and team_id = ${team_id}`
    ).map(toPlayer);
    const outfield = squad.filter((p) => p.position !== "GK").length;
    if (squad.length < size || outfield < size - 1 || outfield === squad.length) continue;
    if (await latestValidRevision(db, team_id, seasonId)) {
      await repairLineup(db, seasonId, team_id, size as TeamSize, { in: [], out: [] });
      continue;
    }
    await createRevision(db, {
      teamId: team_id,
      seasonId,
      source: "seed",
      deployment: tacticalDeployment(defaultTactics(size)),
      starters: defaultLineup(squad, size).starters,
      rationale,
    });
  }
}

/** Whether a league's inaugural phase is complete: every club with a viable, fully contracted squad. */
export async function inauguralReadiness(db: Db, leagueId: string): Promise<{ ok: boolean; problems: string[] }> {
  const [l] = await db<League[]>`select * from leagues where id = ${leagueId}`;
  if (!l?.inaugural) return { ok: true, problems: [] };
  const problems: string[] = [];
  const [net] =
    await db`select 1 from league_phases where league_id = ${leagueId} and kind = 'safety_net' and status = 'settled'`;
  if (!l.inaugural_season_id || !net) problems.push("recruitment hasn't finished (the safety net hasn't run)");
  if (l.inaugural_season_id) {
    const size = await seasonTeamSize(db, l.inaugural_season_id);
    const squads = await db<{ name: string; n: number; gk: number; uncontracted: number }[]>`
      select t.name, count(p.id)::int as n, count(p.id) filter (where p.position = 'GK')::int as gk,
        count(p.id) filter (where not exists (select 1 from player_contracts c where c.player_id = p.id and c.status = 'active'))::int as uncontracted
      from season_teams st join teams t on t.id = st.team_id left join players p on p.team_id = t.id and p.retired_season_id is null
      where st.season_id = ${l.inaugural_season_id} group by t.name order by t.name`;
    for (const q of squads) {
      if (q.n < RECRUIT.squad.min || q.gk < RECRUIT.squad.keepers || q.n - q.gk < size - 1)
        problems.push(`${q.name} has ${q.n} players and ${q.gk} keepers`);
      if (q.uncontracted) problems.push(`${q.name} has ${q.uncontracted} players without a contract`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function foundingJobHandlers(deps: {
  db: Db;
  llmFor: (model: string) => LlmClient;
}): Record<string, JobHandler> {
  return {
    [FOUNDING_JOB]: async (job) => {
      const { leagueId, round } = job.payload as { leagueId: string; round: number };
      const [p] =
        await deps.db`select status from league_phases where league_id = ${leagueId} and kind = 'founding' and round = ${round}`;
      if (!p || p.status === "settled") return { result: { status: "already-done" } };
      const r = await runFoundingRound(deps.db, leagueId, (f) => deps.llmFor(f.model));
      await settlePhase(deps.db, leagueId, "founding", round, { ...r });
      return { result: { ...r } };
    },
  };
}
