/**
 * Leagues and their lifecycle (#93): draft → active → concluded → archived.
 *
 * A league owns seasons; clubs, players, managers and articles stay independently identified, so a
 * league can conclude and be archived without erasing anything. Every lifecycle change is planned
 * first (preflight checks plus the changes it would make) and only applied when the operator
 * confirms with the league's slug. Plans are read-only, so a dry run never mutates anything.
 *
 * Cutover at a season boundary: the operator marks the league's newest season as its final one.
 * When that season completes, rollover concludes the league instead of creating another season,
 * so the legacy rollover can never race the cutover.
 */

import { createHash } from "node:crypto";
import type { League } from "@autosoccer/contracts";
import type { Db } from "@autosoccer/db";
import { inauguralReadiness } from "../founding/inaugural.ts";

export type LeagueStatus = "draft" | "active" | "concluded" | "archived";

export interface LeagueRow {
  id: string;
  slug: string;
  name: string;
  status: LeagueStatus;
  division: string | null;
  tier: number | null;
  is_default: boolean;
  rollover: "legacy" | "manual";
  rules: Record<string, unknown>;
  description: string;
  final_season_id: string | null;
  archive_inventory: Inventory | null;
  archive_backup_ref: string | null;
  activated_at: Date | null;
  concluded_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
}

export async function listLeagues(db: Db): Promise<LeagueRow[]> {
  return db<LeagueRow[]>`select * from leagues order by is_default desc, created_at`;
}

/** Leagues as the public API shows them (drafts are hidden until they are activated). */
export async function publicLeagues(db: Db, onlyId?: string): Promise<League[]> {
  const rows = await db<
    (LeagueRow & { seasons: number; latest: { slug: string; name: string; status: string } | null })[]
  >`
    select l.*,
      (select count(*)::int from seasons s where s.league_id = l.id and s.status <> 'draft') as seasons,
      (select jsonb_build_object('slug', s.slug, 'name', s.name, 'status', s.status) from seasons s
        where s.league_id = l.id and s.status <> 'draft' order by s.created_at desc limit 1) as latest
    from leagues l where l.status <> 'draft' and (${onlyId ?? null}::uuid is null or l.id = ${onlyId ?? null}::uuid)
    order by l.is_default desc, (l.status = 'active') desc, l.created_at desc`;
  return rows.map((l) => ({
    slug: l.slug,
    name: l.name,
    status: l.status,
    division: l.division,
    tier: l.tier,
    isDefault: l.is_default,
    description: l.description,
    seasons: l.seasons,
    latestSeason: l.latest,
    concludedAt: l.concluded_at?.toISOString() ?? null,
    archivedAt: l.archived_at?.toISOString() ?? null,
  }));
}

export async function leagueBySlug(db: Db, slug: string): Promise<LeagueRow | null> {
  const [l] = await db<LeagueRow[]>`select * from leagues where slug = ${slug}`;
  return l ?? null;
}

export async function defaultLeague(db: Db): Promise<LeagueRow | null> {
  const [l] = await db<LeagueRow[]>`select * from leagues where is_default`;
  return l ?? null;
}

/** The given league id, else the default league's (reads scope to one league). */
export async function leagueOrDefault(db: Db, leagueId?: string | null): Promise<string> {
  if (leagueId) return leagueId;
  const l = await defaultLeague(db);
  if (!l) throw new Error("no default league");
  return l.id;
}

/** The league a season belongs to. */
export async function leagueOfSeason(db: Db, seasonId: string): Promise<LeagueRow | null> {
  const [l] = await db<LeagueRow[]>`
    select l.* from leagues l join seasons s on s.league_id = l.id where s.id = ${seasonId}`;
  return l ?? null;
}

/**
 * What a league holds: counts of every season-scoped record plus a checksum over the official
 * results, so an archive can be verified later (nothing added, removed or rewritten).
 */
export interface Inventory {
  seasons: number;
  clubs: number;
  fixtures: number;
  completedFixtures: number;
  forfeits: number;
  matches: number;
  replays: number;
  verifiedReplays: number;
  articles: number;
  publishedArticles: number;
  ledgerRows: number;
  ledgerTotal: number;
  registrations: number;
  transfers: number;
  withdrawals: number;
  managerRuns: number;
  /** sha256 over every fixture's id, status, outcome and score, and every replay's hash. */
  resultsChecksum: string;
}

export async function inventory(db: Db, leagueId: string): Promise<Inventory> {
  const [c] = await db<Omit<Inventory, "resultsChecksum">[]>`
    with s as (select id from seasons where league_id = ${leagueId}),
    f as (select * from fixtures where season_id in (select id from s)),
    m as (select * from matches where fixture_id in (select id from f))
    select
      (select count(*)::int from s) as seasons,
      (select count(distinct team_id)::int from season_teams where season_id in (select id from s)) as clubs,
      (select count(*)::int from f) as fixtures,
      (select count(*)::int from f where status = 'completed') as "completedFixtures",
      (select count(*)::int from f where outcome is not null) as forfeits,
      (select count(*)::int from m) as matches,
      (select count(*)::int from replay_artifacts where match_id in (select id from m)) as replays,
      (select count(*)::int from replay_artifacts where match_id in (select id from m) and verified) as "verifiedReplays",
      (select count(*)::int from articles where season_id in (select id from s)) as articles,
      (select count(*)::int from articles where season_id in (select id from s) and status = 'published') as "publishedArticles",
      (select count(*)::int from club_ledger where season_id in (select id from s)) as "ledgerRows",
      (select coalesce(sum(amount), 0)::float8 from club_ledger where season_id in (select id from s)) as "ledgerTotal",
      (select count(*)::int from player_registrations where season_id in (select id from s)) as registrations,
      (select count(*)::int from transfer_bids b join transfer_windows w on w.id = b.window_id
        where w.season_id in (select id from s) and b.status = 'completed') as transfers,
      (select count(*)::int from club_withdrawals where season_id in (select id from s)) as withdrawals,
      (select count(*)::int from agent_runs where season_id in (select id from s) and agent_kind = 'manager') as "managerRuns"`;
  const rows = await db<{ line: string }[]>`
    select concat_ws('|', f.id, f.status, f.outcome, f.walkover_team_id, m.home_score, m.away_score, m.final_hash, r.sha256) as line
    from fixtures f join seasons s on s.id = f.season_id
      left join matches m on m.fixture_id = f.id left join replay_artifacts r on r.match_id = m.id
    where s.league_id = ${leagueId} order by f.id`;
  const h = createHash("sha256");
  for (const r of rows) h.update(`${r.line}\n`);
  return { ...c!, resultsChecksum: h.digest("hex") };
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Plan {
  action: "create" | "final-season" | "conclude" | "archive" | "unarchive" | "activate" | "set-default";
  league: string;
  ok: boolean;
  checks: Check[];
  /** What applying the plan changes. */
  changes: string[];
  inventory?: Inventory;
}

const plan = (action: Plan["action"], league: string, checks: Check[], changes: string[], inv?: Inventory): Plan => ({
  action,
  league,
  ok: checks.every((c) => c.ok),
  checks,
  changes,
  ...(inv ? { inventory: inv } : {}),
});

async function unfinishedWork(db: Db, leagueId: string): Promise<Check[]> {
  const [u] = await db<{ seasons: number; windows: number; jobs: number }[]>`
    with s as (select id from seasons where league_id = ${leagueId})
    select
      (select count(*)::int from seasons where id in (select id from s) and status in ('draft', 'scheduled', 'active')) as seasons,
      (select count(*)::int from transfer_windows where season_id in (select id from s) and phase <> 'closed') as windows,
      (select count(*)::int from jobs j where j.status in ('queued', 'running') and (
        j.payload->>'seasonId' in (select id::text from s)
        or j.payload->>'fixtureId' in (select f.id::text from fixtures f where f.season_id in (select id from s)))) as jobs`;
  return [
    { name: "no unfinished season", ok: u!.seasons === 0, detail: `${u!.seasons} draft/scheduled/active` },
    { name: "no open transfer window", ok: u!.windows === 0, detail: `${u!.windows} open` },
    { name: "no queued or running jobs", ok: u!.jobs === 0, detail: `${u!.jobs} pending` },
  ];
}

const exists = (l: LeagueRow | null, slug: string): Check => ({
  name: "league exists",
  ok: !!l,
  detail: l ? `${l.name} (${l.status})` : `no league ${slug}`,
});

/** A new draft league (manual rollover: it only gets seasons from explicit commands). */
export async function planCreate(
  db: Db,
  input: { slug: string; name: string; division?: string | null; tier?: number | null },
): Promise<Plan> {
  const existing = await leagueBySlug(db, input.slug);
  const [clash] = await db`select 1 from seasons where slug like ${`${input.slug}-%`} limit 1`;
  return plan(
    "create",
    input.slug,
    [
      { name: "slug is free", ok: !existing, detail: existing ? `${existing.name} already uses it` : "free" },
      {
        name: "slug is url-safe",
        ok: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug),
        detail: input.slug,
      },
      { name: "no season slugs collide", ok: !clash, detail: clash ? "a season slug starts with it" : "none" },
      { name: "name given", ok: input.name.trim().length > 0, detail: input.name },
    ],
    [`create draft league ${input.slug} "${input.name}" (manual rollover, not the default)`],
  );
}

export async function planFinalSeason(db: Db, slug: string, seasonSlug: string): Promise<Plan> {
  const l = await leagueBySlug(db, slug);
  const [newest] = l
    ? await db<{ id: string; slug: string; status: string }[]>`
        select id, slug, status from seasons where league_id = ${l.id} order by created_at desc limit 1`
    : [];
  return plan(
    "final-season",
    slug,
    [
      exists(l, slug),
      { name: "league is active", ok: l?.status === "active", detail: l?.status ?? "-" },
      {
        name: "season is the league's newest",
        ok: newest?.slug === seasonSlug,
        detail: newest ? `newest is ${newest.slug} (${newest.status})` : "no seasons",
      },
    ],
    [`when ${seasonSlug} completes, ${slug} concludes instead of rolling over`],
  );
}

export async function planConclude(db: Db, slug: string): Promise<Plan> {
  const l = await leagueBySlug(db, slug);
  const checks: Check[] = [exists(l, slug)];
  if (l) {
    checks.push({ name: "league is active", ok: l.status === "active", detail: l.status });
    checks.push(...(await unfinishedWork(db, l.id)));
  }
  return plan("conclude", slug, checks, [`${slug} → concluded: no more seasons; records stay browsable`]);
}

export async function planArchive(db: Db, slug: string, backupRef?: string): Promise<Plan> {
  const l = await leagueBySlug(db, slug);
  const checks: Check[] = [exists(l, slug)];
  let inv: Inventory | undefined;
  if (l) {
    checks.push({ name: "league is concluded", ok: l.status === "concluded", detail: l.status });
    checks.push({
      name: "not the default league",
      ok: !l.is_default,
      detail: l.is_default ? "set another default first" : "ok",
    });
    checks.push(...(await unfinishedWork(db, l.id)));
    checks.push({
      name: "backup reference recorded",
      ok: !!backupRef?.trim(),
      detail: backupRef?.trim() || "pass --backup <dump name> after taking a backup",
    });
    inv = await inventory(db, l.id);
  }
  return plan(
    "archive",
    slug,
    checks,
    [`${slug} → archived: its seasons, fixtures, matches, money and registrations become read-only`],
    inv,
  );
}

export async function planUnarchive(db: Db, slug: string): Promise<Plan> {
  const l = await leagueBySlug(db, slug);
  return plan(
    "unarchive",
    slug,
    [exists(l, slug), { name: "league is archived", ok: l?.status === "archived", detail: l?.status ?? "-" }],
    [`${slug} → concluded: writable again (rollback of an archive)`],
  );
}

export async function planActivate(db: Db, slug: string): Promise<Plan> {
  const l = await leagueBySlug(db, slug);
  const checks: Check[] = [exists(l, slug)];
  if (l) {
    checks.push({ name: "league is draft", ok: l.status === "draft", detail: l.status });
    const [s] = await db<{ n: number; clubs: number }[]>`
      select count(*)::int as n, coalesce(max((select count(*) from season_teams st where st.season_id = s.id)), 0)::int as clubs
      from seasons s where s.league_id = ${l.id} and s.status = 'scheduled'`;
    checks.push({ name: "has a scheduled season", ok: s!.n > 0, detail: `${s!.n} scheduled` });
    checks.push({ name: "season has clubs", ok: s!.clubs >= 2, detail: `${s!.clubs} clubs` });
    // A league with an inaugural phase: founding and recruitment done, every squad viable and contracted.
    const ready = await inauguralReadiness(db, l.id);
    checks.push({ name: "inaugural phase complete", ok: ready.ok, detail: ready.problems.join("; ") || "ok" });
  }
  return plan("activate", slug, checks, [`${slug} → active: the scheduler starts playing its seasons`]);
}

export async function planSetDefault(db: Db, slug: string): Promise<Plan> {
  const l = await leagueBySlug(db, slug);
  return plan(
    "set-default",
    slug,
    [
      exists(l, slug),
      {
        name: "league is active or concluded",
        ok: l?.status === "active" || l?.status === "concluded",
        detail: l?.status ?? "-",
      },
    ],
    [`the site shows ${slug} by default; every other league's URLs keep resolving`],
  );
}

export class PlanRefused extends Error {
  constructor(readonly plan: Plan) {
    super(
      `${plan.action} ${plan.league} refused: ${plan.checks
        .filter((c) => !c.ok)
        .map((c) => c.name)
        .join(", ")}`,
    );
  }
}

/**
 * Applies a lifecycle change. Requires `confirm` to equal the league's slug, re-plans under a lock
 * on the leagues table (so two operators can't interleave), and refuses when any check fails.
 * Idempotent where it can be: archiving an archived league is refused, not repeated.
 */
export async function apply(
  db: Db,
  action: Plan["action"],
  args: {
    slug: string;
    confirm: string;
    name?: string;
    division?: string | null;
    tier?: number | null;
    season?: string;
    backupRef?: string;
  },
): Promise<Plan> {
  if (args.confirm !== args.slug) throw new Error(`confirm with --confirm ${args.slug}`);
  return db.begin(async (tx) => {
    const t = tx as unknown as Db;
    await t`lock table leagues in share row exclusive mode`;
    const p = await planFor(t, action, args);
    if (!p.ok) throw new PlanRefused(p);
    switch (action) {
      case "create":
        await t`insert into leagues (slug, name, division, tier) values (${args.slug}, ${args.name!}, ${args.division ?? null}, ${args.tier ?? null})`;
        break;
      case "final-season":
        await t`update leagues set final_season_id = (select id from seasons where slug = ${args.season!}) where slug = ${args.slug}`;
        break;
      case "conclude":
        await t`update leagues set status = 'concluded', concluded_at = now() where slug = ${args.slug}`;
        break;
      case "archive":
        await t`update leagues set status = 'archived', archived_at = now(), archive_inventory = ${t.json(p.inventory as never)},
          archive_backup_ref = ${args.backupRef!.trim()} where slug = ${args.slug}`;
        break;
      case "unarchive":
        await t`update leagues set status = 'concluded', archived_at = null where slug = ${args.slug}`;
        break;
      case "activate":
        await t`update leagues set status = 'active', activated_at = now() where slug = ${args.slug}`;
        break;
      case "set-default":
        await t`update leagues set is_default = false where is_default and slug <> ${args.slug}`;
        await t`update leagues set is_default = true where slug = ${args.slug}`;
        break;
    }
    return p;
  });
}

export function planFor(db: Db, action: Plan["action"], args: Parameters<typeof apply>[2]): Promise<Plan> {
  switch (action) {
    case "create":
      return planCreate(db, { slug: args.slug, name: args.name ?? "", division: args.division, tier: args.tier });
    case "final-season":
      return planFinalSeason(db, args.slug, args.season ?? "");
    case "conclude":
      return planConclude(db, args.slug);
    case "archive":
      return planArchive(db, args.slug, args.backupRef);
    case "unarchive":
      return planUnarchive(db, args.slug);
    case "activate":
      return planActivate(db, args.slug);
    case "set-default":
      return planSetDefault(db, args.slug);
  }
}

/** Recomputes an archived league's inventory and compares it with the one recorded at archival. */
export async function verifyArchive(
  db: Db,
  slug: string,
): Promise<{ ok: boolean; differences: string[]; inventory: Inventory | null }> {
  const l = await leagueBySlug(db, slug);
  if (!l?.archive_inventory) return { ok: false, differences: ["league has no archive inventory"], inventory: null };
  const now = await inventory(db, l.id);
  const before = l.archive_inventory as unknown as Record<string, unknown>;
  const differences = Object.entries(now)
    .filter(([k, v]) => before[k] !== v)
    .map(([k, v]) => `${k}: ${String(before[k])} → ${String(v)}`);
  return { ok: differences.length === 0, differences, inventory: now };
}

/**
 * The cutover hook rollover calls when a league's newest season has completed: if that season was
 * announced as the final one, the league concludes (once) and rollover creates nothing.
 */
export async function concludeIfFinal(db: Db, leagueId: string, completedSeasonId: string): Promise<boolean> {
  const r = await db`
    update leagues set status = 'concluded', concluded_at = now()
    where id = ${leagueId} and status = 'active' and final_season_id = ${completedSeasonId}`;
  if (r.count) return true;
  const [l] = await db<
    { final_season_id: string | null }[]
  >`select final_season_id from leagues where id = ${leagueId}`;
  return l?.final_season_id === completedSeasonId;
}
