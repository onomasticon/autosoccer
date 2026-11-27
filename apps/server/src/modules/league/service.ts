import type { TeamSize } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { SIM_VERSION } from "@autosoccer/sim-adapter";
import { FINANCE_RULE } from "../finance/rules.ts";
import { settleFinances } from "../finance/settle.ts";
import { checkSolvency, resolveForfeits, withdrawals, withdrawnBy } from "../insolvency/check.ts";
import { INSOLVENCY_RULE } from "../insolvency/rules.ts";
import { enqueueFixture } from "../matches/service.ts";
import { TRANSFER_RULE } from "../transfers/rules.ts";
import { closeWindowForKickoff } from "../transfers/window.ts";
import { type Cadence, kickoffs } from "./cadence.ts";
import { doubleRoundRobin, fixtureSeed, seededOrder } from "./schedule.ts";
import { ALL_TEAMS, SEED_TEAMS, type SeedTeam } from "./seed-data.ts";
import { computeStandings, type Result, type Standing } from "./standings.ts";

/** Upserts the founding clubs and their squads (new shirt numbers are added to existing clubs). Safe to run repeatedly. */
export async function seedTeams(db: Db, teams: readonly SeedTeam[] = SEED_TEAMS): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  await db.begin(async (tx) => {
    for (const t of teams) {
      await tx`
        insert into teams (slug, name, short_name, city, primary_color, secondary_color, crest)
        values (${t.slug}, ${t.name}, ${t.shortName}, ${t.city}, ${t.colors.primary}, ${t.colors.secondary}, ${tx.json(t.crest)})
        on conflict (slug) do nothing`;
      const [row] = await tx<{ id: string }[]>`select id from teams where slug = ${t.slug}`;
      ids.set(t.slug, row!.id);
      // The club's founding identity (dated identity history, see insolvency/takeover.ts).
      await tx`
        insert into team_identities (team_id, name, short_name, city, primary_color, secondary_color, crest, reason)
        select id, name, short_name, city, primary_color, secondary_color, crest, 'founding' from teams where id = ${row!.id}
        on conflict (team_id) where from_season_id is null do nothing`;
      for (const p of t.players) {
        await tx`insert into players (team_id, name, shirt_number, position)
          values (${row!.id}, ${p.name}, ${p.number}, ${p.position}) on conflict (team_id, shirt_number) where retired_season_id is null do nothing`;
      }
    }
  });
  return ids;
}

/**
 * Adds any seed-squad players a club doesn't have yet (by shirt number), so squads grow when the
 * league's format does. Never changes or removes an existing player. Returns how many were added.
 */
export async function syncSquads(db: Db, teams: readonly SeedTeam[] = ALL_TEAMS): Promise<number> {
  let added = 0;
  for (const t of teams) {
    const [row] = await db<{ id: string }[]>`select id from teams where slug = ${t.slug}`;
    if (!row) continue;
    for (const p of t.players) {
      // A seed player who has since moved club is never re-created (names are unique in the seed).
      const r = await db`insert into players (team_id, name, shirt_number, position)
        select ${row.id}, ${p.name}, ${p.number}, ${p.position}
        where not exists (select 1 from players where name = ${p.name})
        on conflict (team_id, shirt_number) where retired_season_id is null do nothing`;
      added += r.count;
    }
  }
  return added;
}

/** Default season cap on journalist spend: about 18 articles at ~$0.10 each, plus headroom. */
export const DEFAULT_EDITORIAL_BUDGET_MICRO_USD = 3_000_000;

export interface CreateSeasonInput {
  slug: string;
  name: string;
  seed: number;
  budgetPerTeamMicroUsd: number;
  /** Season cap on journalist (editorial) model spend; defaults to the schema default ($3.00). */
  editorialBudgetMicroUsd?: number;
  teamSlugs: string[];
  simVersion?: string;
  startsAt?: Date;
  /** Spacing between rounds on the published calendar (demo cadence). */
  roundIntervalMinutes?: number;
  /** Calendar cadence; overrides roundIntervalMinutes (see cadence.ts). Default: demo, hourly. */
  cadence?: Cadence;
  /** Players per side. Default 7 (7-a-side); the launch season was 5-a-side. */
  playersPerTeam?: TeamSize;
  /** Club finance rule (finance/1 by default); null creates a season without club finances. */
  financeRule?: string | null;
  /** Transfer rule (transfer/1 by default when the season has finances); null: no transfer window. */
  transferRule?: string | null;
  /** Insolvency rule (insolvency/1 by default when the season has finances); null: no solvency checks. */
  insolvencyRule?: string | null;
}

/**
 * Registers each club's current players for a season (one club per player per season). Players
 * already registered (for example signed in the transfer window) keep their registration.
 */
export async function registerSquads(db: Db, seasonId: string): Promise<number> {
  const r = await db`
    insert into player_registrations (season_id, player_id, team_id)
    select st.season_id, p.id, p.team_id from season_teams st join players p on p.team_id = st.team_id
    where st.season_id = ${seasonId} and p.retired_season_id is null
    on conflict (season_id, player_id) do nothing`;
  return r.count;
}

/**
 * Creates a season with its full double-round-robin calendar in one transaction.
 * Idempotent by slug: an existing season is returned untouched.
 */
export async function createSeason(db: Db, input: CreateSeasonInput): Promise<{ seasonId: string; created: boolean }> {
  return db.begin(async (tx) => {
    const [existing] = await tx<{ id: string }[]>`select id from seasons where slug = ${input.slug}`;
    if (existing) return { seasonId: existing.id, created: false };
    const teams = await tx<
      { id: string; slug: string }[]
    >`select id, slug from teams where slug = any(${input.teamSlugs})`;
    if (teams.length !== input.teamSlugs.length) throw new Error(`unknown team in ${input.teamSlugs.join(", ")}`);
    const startsAt = input.startsAt ?? new Date();
    const financeRule = input.financeRule === undefined ? FINANCE_RULE : input.financeRule;
    const transferRule = financeRule ? (input.transferRule === undefined ? TRANSFER_RULE : input.transferRule) : null;
    const insolvencyRule = financeRule
      ? input.insolvencyRule === undefined
        ? INSOLVENCY_RULE
        : input.insolvencyRule
      : null;
    const [season] = await tx<{ id: string }[]>`
      insert into seasons (slug, name, status, seed, sim_version, players_per_team, budget_per_team_micro_usd, editorial_budget_micro_usd, starts_at, finance_rule, transfer_rule, insolvency_rule)
      values (${input.slug}, ${input.name}, 'scheduled', ${input.seed}, ${input.simVersion ?? SIM_VERSION}, ${input.playersPerTeam ?? 7},
        ${input.budgetPerTeamMicroUsd}, ${input.editorialBudgetMicroUsd ?? DEFAULT_EDITORIAL_BUDGET_MICRO_USD}, ${startsAt},
        ${financeRule}, ${transferRule}, ${insolvencyRule}) returning id`;
    for (const t of teams) await tx`insert into season_teams (season_id, team_id) values (${season!.id}, ${t.id})`;
    await registerSquads(tx as unknown as Db, season!.id);
    const order = seededOrder(teams, input.seed);
    const bySlug = new Map(teams.map((t) => [t.slug, t.id]));
    const calendar = doubleRoundRobin(order.map((t) => t.slug));
    const times = kickoffs(
      startsAt,
      Math.max(...calendar.map((f) => f.round)),
      input.cadence ?? { kind: "interval", minutes: input.roundIntervalMinutes ?? 60 },
    );
    for (const f of calendar) {
      await tx`
        insert into fixtures (season_id, round, home_team_id, away_team_id, seed, scheduled_at)
        values (${season!.id}, ${f.round}, ${bySlug.get(f.home)!}, ${bySlug.get(f.away)!},
          ${fixtureSeed(input.seed, f.round, f.home, f.away)}, ${times[f.round - 1]!})`;
    }
    return { seasonId: season!.id, created: true };
  });
}

export type AdvanceResult =
  | { state: "completed" }
  | { state: "waiting"; round: number; reason: string }
  | { state: "playing"; round: number; enqueued: number; pending: number }
  | { state: "blocked"; round: number; failed: string[] };

export interface AdvanceOptions {
  /** Only start a round once its scheduled time has passed. */
  respectSchedule?: boolean;
  now?: Date;
  /**
   * Runs before a round's matches are enqueued (e.g. manager pre-match decisions).
   * Return false to hold the round back until the next tick.
   */
  beforeRound?: (round: number, fixtureIds: string[]) => Promise<boolean>;
}

/**
 * The round scheduler. Call it repeatedly (it's idempotent): it activates the season,
 * releases the earliest unfinished round's fixtures to the match queue, and completes the
 * season once every fixture has a result. Rounds are strictly sequential.
 */
export async function advanceSeason(db: Db, seasonId: string, opts: AdvanceOptions = {}): Promise<AdvanceResult> {
  await db`update seasons set status = 'active' where id = ${seasonId} and status = 'scheduled'`;
  const [next] = await db<{ round: number; scheduled_at: Date | null }[]>`
    select round, min(scheduled_at) as scheduled_at from fixtures
    where season_id = ${seasonId} and status <> 'completed'
    group by round order by round limit 1`;
  if (!next) {
    await db`update seasons set status = 'completed', completed_at = coalesce(completed_at, now()) where id = ${seasonId}`;
    await settleFinances(db, seasonId); // finishing-position prizes (idempotent)
    return { state: "completed" };
  }
  const round = next.round;
  // Payroll check (insolvency/1) as soon as the round is next, before its previews and manager
  // decisions. Round 1 waits for the transfer window to close: its deals move cash.
  const [window] = await db`select 1 from transfer_windows where season_id = ${seasonId} and phase <> 'closed'`;
  if (!window) await checkSolvency(db, seasonId, round);
  const roundFixtures = () => db<{ id: string; status: string }[]>`
    select f.id, f.status from fixtures f where f.season_id = ${seasonId} and f.round = ${round} order by f.id`;
  let fixtures = await roundFixtures();
  const failed = await db<{ fixture_id: string }[]>`
    select (j.payload->>'fixtureId') as fixture_id from jobs j
    where j.kind = 'match.play' and j.status = 'failed' and (j.payload->>'fixtureId') = any(${fixtures.map((f) => f.id)})`;
  if (failed.length) return { state: "blocked", round, failed: failed.map((f) => f.fixture_id) };

  const toRelease = fixtures.filter((f) => f.status === "scheduled");
  if (toRelease.length) {
    const now = opts.now ?? new Date();
    if (opts.respectSchedule && next.scheduled_at && next.scheduled_at > now) {
      return { state: "waiting", round, reason: `round ${round} starts at ${next.scheduled_at.toISOString()}` };
    }
    // The season starts on time: an open transfer window settles and closes before any round is
    // released (and before the managers pick their round-1 sides from the new squads).
    await closeWindowForKickoff(db, seasonId);
    await checkSolvency(db, seasonId, round);
    // A withdrawn club's fixtures resolve now, as walkovers (or void): never simulated.
    if (await resolveForfeits(db, seasonId, round)) fixtures = await roundFixtures();
    const live = fixtures.filter((f) => f.status === "scheduled").map((f) => f.id);
    if (live.length && opts.beforeRound && !(await opts.beforeRound(round, live))) {
      return { state: "waiting", round, reason: "pre-round work in progress" };
    }
  }
  let enqueued = 0;
  for (const f of fixtures.filter((x) => x.status !== "completed")) {
    if (f.status === "scheduled")
      await db`update fixtures set status = 'ready', updated_at = now() where id = ${f.id} and status = 'scheduled'`;
  }
  // Club finances for the released round (distribution, wages, any results not yet settled),
  // before its matches are prepared. Idempotent: every entry has a settlement key.
  await settleFinances(db, seasonId);
  for (const f of fixtures.filter((x) => x.status !== "completed")) {
    if ((await enqueueFixture(db, f.id)).created) enqueued++;
  }
  return { state: "playing", round, enqueued, pending: fixtures.filter((f) => f.status !== "completed").length };
}

/** Official results so far: completed matches, and fixtures resolved as walkovers or void. */
export async function seasonResults(db: Db, seasonId: string): Promise<Result[]> {
  const rows = await db<{ round: number; home: string; away: string; home_score: number; away_score: number }[]>`
    select f.round, f.home_team_id as home, f.away_team_id as away, m.home_score, m.away_score
    from fixtures f join matches m on m.fixture_id = f.id
    where f.season_id = ${seasonId} and m.status = 'completed'
    order by f.round`;
  const forfeits = await db<{ round: number; home: string; away: string; outcome: string; winner: string | null }[]>`
    select f.round, f.home_team_id as home, f.away_team_id as away, f.outcome, f.walkover_team_id as winner
    from fixtures f where f.season_id = ${seasonId} and f.outcome is not null and f.status = 'completed'
    order by f.round`;
  return [
    ...rows.map((r) => ({
      round: r.round,
      home: r.home,
      away: r.away,
      homeGoals: r.home_score,
      awayGoals: r.away_score,
    })),
    ...forfeits.map((r) => ({
      round: r.round,
      home: r.home,
      away: r.away,
      homeGoals: 0,
      awayGoals: 0,
      walkover: (r.outcome === "void" ? "void" : r.winner === r.home ? "home" : "away") as Result["walkover"],
    })),
  ].sort((a, b) => a.round - b.round);
}

/**
 * The table from official results. With `throughRound`, only results up to and including that
 * round count — a historical snapshot, so facts about round N never include later results.
 */
export async function seasonStandings(
  db: Db,
  seasonId: string,
  opts: { throughRound?: number } = {},
): Promise<{ rows: Standing[]; afterRound: number }> {
  const teams = await db<{ id: string; name: string }[]>`
    select t.id, t.name from season_teams st join teams t on t.id = st.team_id where st.season_id = ${seasonId}`;
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const all = await seasonResults(db, seasonId);
  const results = opts.throughRound === undefined ? all : all.filter((r) => r.round <= opts.throughRound!);
  const [done] = await db<{ round: number | null }[]>`
    select max(round)::int as round from fixtures f where season_id = ${seasonId}
      and not exists (select 1 from fixtures g where g.season_id = f.season_id and g.round <= f.round and g.status <> 'completed')`;
  // A historical snapshot shows a club as withdrawn once it has forfeited a fixture by then.
  const gone = await withdrawals(db, seasonId);
  const through = opts.throughRound ?? Number.POSITIVE_INFINITY;
  const out = withdrawnBy(gone, through);
  return {
    rows: computeStandings(
      teams.map((t) => t.id),
      results,
      (id) => names.get(id) ?? id,
      new Map([...gone].filter(([t]) => out.has(t))),
    ),
    afterRound: Math.min(done?.round ?? 0, opts.throughRound ?? Number.POSITIVE_INFINITY),
  };
}
