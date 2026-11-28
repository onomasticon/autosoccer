/**
 * Phase 2 season rollover (rollover/1, #101): when a new league's season completes, the next one is
 * created on calendar/1 with the same clubs, so the league runs on without an operator. The original
 * league keeps its own rollover (league/rollover.ts); this one only touches active leagues that came
 * out of an inaugural phase.
 *
 * Between seasons, in order:
 * 1. A season announced as the league's final one concludes the league instead (no rollover).
 * 2. ageing/1: club players a year older; those who retire leave, and an academy graduate takes
 *    each one's place. A retiree's contract ends.
 * 3. The next season (finance/3, transfer/2, insolvency/2) from calendar/1's timetable, starting with
 *    its preseason window: renewals of the contracts that ended, then free agency.
 * 4. Ratings develop from last season's record and age, for club players and the league's free agents.
 * 5. Each graduate signs an academy contract at the market wage; every club gets an opening setup.
 *
 * Cash, debt, administration, honours and each club's manager (and its model) carry over unchanged:
 * the lender's season end has already run when the season completed. Each step is idempotent, and the
 * rollover is a league phase (`league_phases` kind 'rollover', round = the new season's number), so an
 * interrupted rollover finishes on the next tick and its summary is on record.
 */
import type { Db } from "@autosoccer/db";
import type { Logger } from "../../log.ts";
import { createPhase2Season } from "../contracts/scheduler.ts";
import { marketWage, signContract, yearsFor } from "../contracts/service.ts";
import { developmentRate, retireAndPromote } from "../league/ageing.ts";
import { developSeason } from "../league/careers.ts";
import { concludeIfFinal } from "../league/leagues.ts";
import { nextSeasonSeed, seasonNumber } from "../league/rollover.ts";
import { type InauguralSettings, seedOpeningTactics } from "./inaugural.ts";

export const ROLLOVER_RULE = "rollover/1";

interface SeasonRow {
  id: string;
  slug: string;
  name: string;
  seed: string;
  status: string;
  budget_per_team_micro_usd: string;
  editorial_budget_micro_usd: string;
}

export interface Phase2Rollover {
  league: string;
  season: string;
  created: boolean;
  summary: RolloverSummary | null;
}

export interface RolloverSummary {
  rule: typeof ROLLOVER_RULE;
  from: string;
  retired: number;
  graduates: number;
  developed: number;
}

/** Scheduler hook: rolls every active Phase 2 league on to its next season when one completes. */
export async function rolloverPhase2(db: Db, opts: { now?: Date; log?: Logger } = {}): Promise<Phase2Rollover[]> {
  const leagues = await db<{ id: string; slug: string; inaugural: InauguralSettings }[]>`
    select id, slug, inaugural from leagues where status = 'active' and rollover = 'manual' and inaugural is not null
    order by slug`;
  const out: Phase2Rollover[] = [];
  for (const l of leagues) {
    const r = await rolloverLeague(db, l, opts);
    if (r) out.push(r);
  }
  return out;
}

async function rolloverLeague(
  db: Db,
  l: { id: string; slug: string; inaugural: InauguralSettings },
  opts: { now?: Date; log?: Logger },
): Promise<Phase2Rollover | null> {
  const seasons = await db<SeasonRow[]>`
    select id, slug, name, seed::text, status, budget_per_team_micro_usd::text, editorial_budget_micro_usd::text
    from seasons where league_id = ${l.id} order by created_at desc limit 2`;
  const [newest, before] = seasons;
  if (!newest) return null;
  // A rollover that was interrupted after its season was created: finish it.
  if (newest.status !== "completed") {
    const n = seasonNumber(newest.slug);
    const [pending] = await db`
      select 1 from league_phases where league_id = ${l.id} and kind = 'rollover' and round = ${n ?? 0} and status = 'pending'`;
    if (!pending || !before) return null;
    return { league: l.slug, season: newest.slug, created: false, summary: await finish(db, l.id, newest, before) };
  }
  if (await concludeIfFinal(db, l.id, newest.id)) {
    opts.log?.info("league concluded after its final season", { league: l.slug, season: newest.slug });
    return null;
  }
  const n = seasonNumber(newest.slug);
  if (n === null) {
    opts.log?.warn("phase 2 rollover skipped: season slug isn't <league>-season-N", { season: newest.slug });
    return null;
  }
  const now = opts.now ?? new Date();
  await db`insert into league_phases (league_id, kind, round, opens_at)
    values (${l.id}, 'rollover', ${n + 1}, ${now}) on conflict do nothing`;
  // ageing/1 before the new season registers its squads: retirees leave, graduates join.
  await retireAndPromote(db, newest.id, n + 1);
  await db`update player_contracts set status = 'expired', ended_at = now()
    where status = 'active' and player_id in (select id from players where retired_season_id = ${newest.id})`;
  const teams = await db<{ slug: string }[]>`
    select t.slug from season_teams st join teams t on t.id = st.team_id where st.season_id = ${newest.id} order by t.slug`;
  const { seasonId, created } = await createPhase2Season(db, {
    leagueId: l.id,
    slug: `${l.slug}-season-${n + 1}`,
    name: `Season ${n + 1}`,
    seed: nextSeasonSeed(Number(newest.seed)),
    teamSlugs: teams.map((t) => t.slug),
    // The preseason window opens on the next whole minute; calendar/1 places round 1 after it.
    opens: new Date(Math.ceil(now.getTime() / 60_000) * 60_000),
    budgetPerTeamMicroUsd: Number(newest.budget_per_team_micro_usd),
    editorialBudgetMicroUsd: Number(newest.editorial_budget_micro_usd),
    calendar: l.inaugural.calendar,
  });
  const [next] = await db<SeasonRow[]>`
    select id, slug, name, seed::text, status, budget_per_team_micro_usd::text, editorial_budget_micro_usd::text
    from seasons where id = ${seasonId}`;
  const summary = await finish(db, l.id, next!, newest);
  if (created) opts.log?.info("phase 2 season rolled over", { league: l.slug, from: newest.slug, to: next!.slug });
  return { league: l.slug, season: next!.slug, created, summary };
}

/** Development, graduates' contracts and opening setups for a newly created season (idempotent). */
async function finish(db: Db, leagueId: string, season: SeasonRow, prev: SeasonRow): Promise<RolloverSummary> {
  const n = seasonNumber(season.slug)!;
  // Every league player develops with age (pool players were generated without a hidden rate).
  const unrated = await db<{ id: string; name: string }[]>`
    select p.id, p.name from players p
    where p.development_rate is null and p.retired_season_id is null
      and (p.team_id in (select team_id from season_teams where season_id = ${season.id})
        or (p.team_id is null and p.pool_league_id = ${leagueId}))`;
  for (const p of unrated)
    await db`update players set development_rate = ${developmentRate(p.name)} where id = ${p.id} and development_rate is null`;
  const developed = await developSeason(db, season.id, prev.id);
  // Graduates sign for their club: the market wage for their rating, the term for their age.
  const graduates = await db<{ id: string; team_id: string; born_season: number; overall: number }[]>`
    select p.id, p.team_id, p.born_season, r.overall from players p
    join season_teams st on st.team_id = p.team_id and st.season_id = ${season.id}
    join player_ratings r on r.player_id = p.id and r.season_id = ${season.id}
    where p.academy_season_id = ${prev.id} and p.retired_season_id is null
      and not exists (select 1 from player_contracts c where c.player_id = p.id and c.status = 'active')`;
  const [{ rounds } = { rounds: 2 }] = await db<{ rounds: number }[]>`
    select coalesce(max(round), 2)::int as rounds from fixtures where season_id = ${season.id}`;
  await db.begin(async (tx) => {
    for (const g of graduates)
      await signContract(tx as unknown as Db, {
        playerId: g.id,
        teamId: g.team_id,
        seasonId: season.id,
        wage: marketWage(g.overall, rounds),
        years: yearsFor(n - g.born_season),
        startsSeason: n,
        via: "academy",
      });
  });
  await seedOpeningTactics(
    db,
    season.id,
    "Opening setup for the new season (the manager sets its own before round 1).",
  );
  const [counts] = await db<{ retired: number; graduates: number }[]>`
    select (select count(*)::int from players where retired_season_id = ${prev.id}
              and team_id in (select team_id from season_teams where season_id = ${prev.id})) as retired,
           (select count(*)::int from players where academy_season_id = ${prev.id}) as graduates`;
  const summary: RolloverSummary = {
    rule: ROLLOVER_RULE,
    from: prev.slug,
    retired: counts!.retired,
    graduates: counts!.graduates,
    developed,
  };
  await db`update league_phases set status = 'settled', settled_at = now(),
      summary = ${db.json(summary as never)}
    where league_id = ${leagueId} and kind = 'rollover' and round = ${n} and status = 'pending'`;
  return summary;
}
