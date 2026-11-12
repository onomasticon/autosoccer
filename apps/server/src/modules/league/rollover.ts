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
import type { Logger } from "../../log.ts";
import { seedManagers } from "../agents/service.ts";
import { seedJournalists } from "../editorial/service.ts";
import { createSeason } from "./service.ts";

/** The league's format for new seasons. */
export const LEAGUE_TEAM_SIZE: TeamSize = 7;

export interface RolloverOptions {
  managerModel: string;
  editorialModel: string;
  /**
   * Minutes between rounds of the new season (and from the end of the last season to round 1).
   * Default: the spacing of the season that just ended. 240 gives one season per day:
   * a 4-hour break, then six rounds 4 hours apart.
   */
  roundMinutes?: number;
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
  const startsAt = new Date(Math.ceil((now.getTime() + minutes * 60_000) / 60_000) * 60_000);
  const slug = `season-${n + 1}`;
  const { seasonId, created } = await createSeason(db, {
    slug,
    name: `Season ${n + 1}`,
    seed: nextSeasonSeed(Number(last.seed)),
    budgetPerTeamMicroUsd: Number(last.budget_per_team_micro_usd),
    editorialBudgetMicroUsd: Number(last.editorial_budget_micro_usd),
    teamSlugs: teams.map((t) => t.slug),
    startsAt,
    cadence: { kind: "interval", minutes },
    playersPerTeam: LEAGUE_TEAM_SIZE,
  });
  await seedManagers(db, seasonId, opts.managerModel);
  await seedJournalists(db, opts.editorialModel);
  if (created)
    opts.log?.info("season rolled over", { from: last.slug, to: slug, startsAt: startsAt.toISOString(), minutes });
  return slug;
}
