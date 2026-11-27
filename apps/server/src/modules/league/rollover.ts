/**
 * Season rollover: when the league's latest season is complete and nothing else is scheduled,
 * the next season is created automatically with the same clubs, budgets and calendar spacing,
 * so the league never goes dark between seasons. Managers keep their memory across seasons
 * (it lives on the manager, not the season); each gets an opening setup for the new season.
 *
 * Deterministic and idempotent: the next season's slug, name, seed and kick-off follow from the
 * previous season alone, and createSeason is idempotent by slug.
 */
import { createHash } from "node:crypto";
import type { TeamSize } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { SIM_COMMIT, SIM_VERSION } from "@autosoccer/sim-adapter";
import type { Logger } from "../../log.ts";
import { seedManagers } from "../agents/service.ts";
import { seedJournalists } from "../editorial/service.ts";
import { rescueClubs } from "../insolvency/takeover.ts";
import { openWindow } from "../transfers/window.ts";
import { retireAndPromote } from "./ageing.ts";
import { CADENCES, type Cadence, kickoffs } from "./cadence.ts";
import { developSeason } from "./careers.ts";
import { ALL_TEAMS } from "./seed-data.ts";
import { createSeason, registerSquads, seedTeams, syncSquads } from "./service.ts";

/**
 * The league's format for new seasons. Season 5 was due to be the first 11-a-side season; the
 * league went back to 7-a-side (with ball control and ratings) before it kicked off.
 */
export const LEAGUE_TEAM_SIZE: TeamSize = 7;

/**
 * How many clubs the league has. It was four; when a season rolls over with fewer, the next clubs
 * from the seed list join (the expansion: six new clubs, each with a squad and an AI manager), and
 * the season grows to a double round robin of 2 × (clubs − 1) rounds.
 */
export const LEAGUE_CLUBS = 10;

/** Rounds in a double round robin of n clubs. */
export const roundsFor = (clubs: number) => 2 * (clubs - 1);

export interface RolloverOptions {
  managerModel: string;
  editorialModel: string;
  /**
   * Minutes between rounds of the new season (and from the end of the last season to round 1).
   * Default: the spacing of the season that just ended. 240 gives one season per day:
   * a 4-hour break, then six rounds 4 hours apart.
   */
  roundMinutes?: number;
  /**
   * A public calendar for the new season ("weekly" or "twice-weekly", UTC). Round 1 is the first
   * slot at least `roundMinutes` (or a day) after the last season ends. Default: interval spacing.
   */
  cadence?: "interval" | "weekly" | "twice-weekly";
  /** Players age, retire and are replaced by academy graduates (ageing/1). Default true. */
  ageing?: boolean;
  /** Clubs the new season should have (default LEAGUE_CLUBS); new clubs join to make it up. */
  clubs?: number;
  /** Earliest kick-off for the new season (default: now). */
  now?: Date;
  log?: Logger;
}

interface LastSeason {
  id: string;
  slug: string;
  name: string;
  seed: number;
  status: string;
  budget_per_team_micro_usd: number;
  editorial_budget_micro_usd: number;
}

/** Seed for the season after `seed`: stable, and different every season. */
export function nextSeasonSeed(seed: number): number {
  return createHash("sha256").update(`autosoccer-season-after:${seed}`).digest().readUInt32BE(0);
}

/** "season-3" → 4; anything else → null. */
export function seasonNumber(slug: string): number | null {
  const m = /^season-(\d+)$/.exec(slug);
  return m ? Number(m[1]) : null;
}

/**
 * Creates the next season if the latest one is complete and none is scheduled or active.
 * Returns the new season's slug, or null when there is nothing to do.
 */
export async function rolloverSeason(db: Db, opts: RolloverOptions): Promise<string | null> {
  const [open] = await db`select 1 from seasons where status in ('draft', 'scheduled', 'active') limit 1`;
  if (open) return null;
  const [last] = await db<LastSeason[]>`
    select id, slug, name, seed, status, budget_per_team_micro_usd, editorial_budget_micro_usd
    from seasons order by created_at desc limit 1`; // the newest season, whatever its calendar says
  if (!last || last.status !== "completed") return null;
  const n = seasonNumber(last.slug);
  if (n === null) {
    opts.log?.warn("season rollover skipped: latest season slug is not season-N", { season: last.slug });
    return null;
  }
  const teams = await db<{ slug: string }[]>`
    select t.slug from season_teams st join teams t on t.id = st.team_id where st.season_id = ${last.id} order by t.slug`;
  // The configured pace, else the same spacing between rounds as the season that just ended.
  const [gap] = await db<{ minutes: number | null }[]>`
    select extract(epoch from (max(scheduled_at) - min(scheduled_at)))::float / 60 / nullif(count(distinct round) - 1, 0) as minutes
    from fixtures where season_id = ${last.id}`;
  const minutes = Math.max(5, Math.round(opts.roundMinutes ?? gap?.minutes ?? 60));
  const now = opts.now ?? new Date();
  const calendar = opts.cadence && opts.cadence !== "interval" ? (CADENCES[opts.cadence] as Cadence) : null;
  // On a calendar, leave at least a day for previews and the new season's opening setups.
  const startsAt = calendar
    ? kickoffs(new Date(now.getTime() + Math.max(minutes, 24 * 60) * 60_000), 1, calendar)[0]!
    : new Date(Math.ceil((now.getTime() + minutes * 60_000) / 60_000) * 60_000);
  const slug = `season-${n + 1}`;
  // The expansion: new clubs join until the league has LEAGUE_CLUBS (idempotent: seeding is by slug).
  const joining = ALL_TEAMS.filter((t) => !teams.some((x) => x.slug === t.slug)).slice(
    0,
    Math.max(0, (opts.clubs ?? LEAGUE_CLUBS) - teams.length),
  );
  if (joining.length) {
    await seedTeams(db, joining);
    opts.log?.info("clubs join the league", { season: slug, clubs: joining.map((t) => t.slug) });
  }
  // Spend caps follow the season's length (the same budget per round and per match as before).
  const growth = roundsFor(teams.length + joining.length) / Math.max(1, roundsFor(teams.length));
  const matchGrowth = (growth * (teams.length + joining.length)) / Math.max(1, teams.length);
  const added = await syncSquads(db);
  if (added) opts.log?.info("squads grew for the new format", { players: added, playersPerTeam: LEAGUE_TEAM_SIZE });
  // ageing/1: everyone is a year older; players who retire leave, and academy graduates take their
  // places (before the new season registers its squads).
  const retired = opts.ageing === false ? [] : await retireAndPromote(db, last.id, n + 1);
  if (retired.length)
    opts.log?.info("players retired; academy graduates promoted", {
      season: slug,
      retired: retired.map((r) => `${r.name} (${r.age})`),
    });
  const { seasonId, created } = await createSeason(db, {
    slug,
    name: `Season ${n + 1}`,
    seed: nextSeasonSeed(Number(last.seed)),
    budgetPerTeamMicroUsd: Math.round(Number(last.budget_per_team_micro_usd) * growth),
    editorialBudgetMicroUsd: Math.round(Number(last.editorial_budget_micro_usd) * matchGrowth),
    teamSlugs: [...teams.map((t) => t.slug), ...joining.map((t) => t.slug)],
    startsAt,
    cadence: calendar ?? { kind: "interval", minutes },
    playersPerTeam: LEAGUE_TEAM_SIZE,
  });
  // Player careers: this season's ratings, developed from last season's record (idempotent).
  const developed = await developSeason(db, seasonId, last.id);
  if (developed) opts.log?.info("player ratings developed", { season: slug, players: developed });
  // A club that went bankrupt last season returns under new owners and a new name, recapitalised
  // (insolvency/1), before its manager's opening setup and the transfer window see its cash.
  for (const t of await rescueClubs(db, last.id, seasonId))
    opts.log?.info("club taken over", { from: t.from, to: t.to, capital: t.capital, season: slug });
  await seedManagers(db, seasonId, opts.managerModel);
  await seedJournalists(db, opts.editorialModel);
  // The transfer window before the new season (when it has a transfer rule; see transfers/window.ts).
  await openWindow(db, seasonId, now);
  if (created)
    opts.log?.info("season rolled over", {
      from: last.slug,
      to: slug,
      startsAt: startsAt.toISOString(),
      cadence: opts.cadence ?? "interval",
      minutes,
    });
  return slug;
}

/**
 * Brings a season that hasn't kicked off yet up to the current format and simulator: rollover
 * creates the next season as soon as one ends, pinned to whatever sim was running, so without
 * this an upgrade deployed between seasons would wait a whole season to take effect.
 *
 * Only touches the newest season, and only while nothing has happened in it: every fixture still
 * scheduled, no match rows, no manager or journalist runs and no queued jobs for its fixtures.
 * Then it re-pins the sim, sets the team size, grows squads, and replaces the opening setups.
 * Returns the season's slug when it changed something.
 */
export async function refreshUpcomingSeason(
  db: Db,
  opts: Pick<RolloverOptions, "managerModel" | "log">,
): Promise<string | null> {
  const [s] = await db<{ id: string; slug: string; status: string; sim_version: string; players_per_team: number }[]>`
    select id, slug, status, sim_version, players_per_team from seasons order by created_at desc limit 1`;
  if (!s || (s.status !== "scheduled" && s.status !== "active")) return null;
  const current = s.sim_version === SIM_VERSION || s.sim_version === SIM_COMMIT;
  if (current && s.players_per_team === LEAGUE_TEAM_SIZE) return null;
  const [started] = await db`
    select 1 from fixtures f where f.season_id = ${s.id} and (
      f.status <> 'scheduled'
      or exists (select 1 from matches m where m.fixture_id = f.id)
      or exists (select 1 from jobs j where j.payload->>'fixtureId' = f.id::text))
    union all select 1 from agent_runs where season_id = ${s.id} and agent_kind = 'manager' and purpose <> 'transfer'
    limit 1`;
  if (started) return null;
  await db.begin(async (tx) => {
    await tx`update seasons set sim_version = ${SIM_VERSION}, players_per_team = ${LEAGUE_TEAM_SIZE} where id = ${s.id}`;
    await tx`delete from tactical_revisions where season_id = ${s.id}`;
  });
  const added = await syncSquads(db);
  await registerSquads(db, s.id);
  // Snapshots for any players the format change added (existing snapshots are kept).
  const [prev] = await db<{ id: string }[]>`
    select id from seasons where id <> ${s.id} and status = 'completed' order by created_at desc limit 1`;
  await developSeason(db, s.id, prev?.id ?? null);
  await seedManagers(db, s.id, opts.managerModel);
  opts.log?.info("upcoming season moved to the current format", {
    season: s.slug,
    simVersion: SIM_VERSION,
    from: { simVersion: s.sim_version, playersPerTeam: s.players_per_team },
    playersPerTeam: LEAGUE_TEAM_SIZE,
    playersAdded: added,
  });
  return s.slug;
}
