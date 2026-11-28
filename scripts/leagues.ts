/**
 * League lifecycle commands (#93) against the configured DATABASE_URL. Every command is a dry run
 * unless it is given `--confirm <league-slug>`: it prints the preflight checks and the changes it
 * would make, and exits non-zero if a check fails.
 *
 *   bun run leagues list
 *   bun run leagues inventory --league original
 *   bun run leagues create --league founders --name "The Founders League" [--division "Division 1" --tier 1] [--confirm founders]
 *   bun run leagues final-season --league original --season season-30 [--confirm original]
 *   bun run leagues end-season --league original --season season-17 [--confirm original]
 *       # stops the league's current season part-way and concludes the league: played matches stay,
 *       # unplayed fixtures go, and the season has no champion (status ended_early)
 *   bun run leagues conclude --league original [--confirm original]
 *   bun run leagues archive --league original --backup db/2026-12-01T03:00:00Z.dump [--confirm original]
 *   bun run leagues verify --league original      # an archived league still matches its archive inventory
 *   bun run leagues unarchive --league original [--confirm original]   # rollback of an archive
 *   bun run leagues inaugural --league founders --opens 2027-01-04T09:00:00Z --seed 7 [--models a,b,c] [--budget-usd 10] [--editorial-usd 25] [--first-preseason-hours 12] [--confirm founders]
 *       # defaults: every allocated registry model (not the reserve), and LAUNCH_CAPS (founding/inaugural.ts)
 *       # schedules the inaugural phase (founding, recruitment, safety net); `status` shows where it is
 *   bun run leagues inaugural-status --league founders
 *   bun run leagues activate --league founders [--confirm founders]
 *   bun run leagues set-default --league founders [--confirm founders]
 *
 * Take a backup first (deploy/exe/backup.sh) for anything that changes a league. See
 * docs/platform/leagues.md for the cutover runbook.
 */
import { createDb } from "@autosoccer/db";
import { loadConfig } from "../apps/server/src/config.ts";
import { inauguralReadiness, LAUNCH_CAPS, startInaugural } from "../apps/server/src/modules/founding/inaugural.ts";
import {
  apply,
  inventory,
  leagueBySlug,
  listLeagues,
  type Plan,
  PlanRefused,
  planFor,
  verifyArchive,
} from "../apps/server/src/modules/league/leagues.ts";
import { missingKeys } from "../apps/server/src/modules/models/gateway.ts";
import { modelBySlug, REGISTRY } from "../apps/server/src/modules/models/registry.ts";

const [cmd = "list"] = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const config = loadConfig();
const db = createDb(config.DATABASE_URL, { max: 2, caFile: config.DATABASE_CA_CERT_FILE });

function print(p: Plan, applied: boolean) {
  console.log(`\n${p.action} ${p.league} — ${applied ? "APPLIED" : p.ok ? "dry run: ready" : "dry run: REFUSED"}`);
  for (const c of p.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  for (const ch of p.changes) console.log(`  ${applied ? "→" : "would"} ${ch}`);
  if (p.inventory) console.log(`  inventory ${JSON.stringify(p.inventory)}`);
  if (!applied && p.ok) console.log(`  re-run with --confirm ${p.league} to apply`);
}

const ACTIONS = [
  "create",
  "final-season",
  "end-season",
  "conclude",
  "archive",
  "unarchive",
  "activate",
  "set-default",
] as const;
let code = 0;
try {
  if (cmd === "list") {
    for (const l of await listLeagues(db))
      console.log(
        `${l.is_default ? "*" : " "} ${l.slug.padEnd(16)} ${l.status.padEnd(10)} ${l.rollover.padEnd(7)} ${l.name}${l.final_season_id ? " (final season set)" : ""}`,
      );
  } else if (cmd === "inventory") {
    const l = await leagueBySlug(db, opt("league") ?? "");
    if (!l) throw new Error("no such league (--league)");
    console.log(JSON.stringify(await inventory(db, l.id), null, 2));
  } else if (cmd === "inaugural") {
    const slug = opt("league") ?? "";
    const allocated = REGISTRY.filter((m) => m.status !== "reserve").map((m) => m.slug);
    const models = (opt("models") ?? allocated.join(",")).split(",").filter(Boolean);
    const unknown = models.filter((m) => !modelBySlug(m));
    if (unknown.length) throw new Error(`not in the model registry: ${unknown.join(", ")}`);
    const opens = new Date(opt("opens") ?? "");
    if (Number.isNaN(opens.getTime())) throw new Error("--opens must be an ISO time");
    const input = {
      opens,
      seed: Number(opt("seed") ?? 1),
      models,
      budgetPerTeamMicroUsd: Math.round(Number(opt("budget-usd") ?? LAUNCH_CAPS.managerPerClubPerSeasonUsd) * 1e6),
      editorialBudgetMicroUsd: Math.round(Number(opt("editorial-usd") ?? LAUNCH_CAPS.editorialPerSeasonUsd) * 1e6),
      ...(opt("first-preseason-hours") ? { firstPreseasonHours: Number(opt("first-preseason-hours")) } : {}),
    };
    if (input.firstPreseasonHours !== undefined && !(input.firstPreseasonHours >= 3))
      throw new Error("--first-preseason-hours must be at least 3: one hour for each transfer phase");
    if (!(input.budgetPerTeamMicroUsd > 0))
      throw new Error("--budget-usd must be positive: with $0, every manager decision is skipped");
    // Preflight: a founder whose provider key is missing would fail every founding round, unseen.
    const live = process.env.LLM_PROVIDER !== "offline";
    const missing = live ? missingKeys(models.map((m) => modelBySlug(m)!)) : [];
    for (const k of [...new Set(missing.map((m) => m.key))])
      console.log(
        `  ✗ ${k} is not set: ${missing
          .filter((m) => m.key === k)
          .map((m) => m.model)
          .join(", ")}`,
      );
    if (!live) console.log("  note: LLM_PROVIDER=offline, so founders and managers are the offline stand-ins");
    if (missing.length && opt("confirm") === slug)
      throw new Error(`refusing to schedule: ${missing.length} founders have no API key in this environment`);
    console.log(
      `inaugural ${slug}: ${models.length} founders, founding opens ${opens.toISOString()}, seed ${input.seed}, $${input.budgetPerTeamMicroUsd / 1e6} per club per season, newsroom $${input.editorialBudgetMicroUsd / 1e6} per season, season 1 preseason ${input.firstPreseasonHours ?? 72}h`,
    );
    if (opt("confirm") !== slug) console.log(`  dry run: re-run with --confirm ${slug} to schedule it`);
    else {
      const r = await startInaugural(db, slug, input);
      console.log(`  scheduled: ${r.founders.length} founders invited; the scheduler runs each step at its time`);
    }
  } else if (cmd === "inaugural-status") {
    const l = await leagueBySlug(db, opt("league") ?? "");
    if (!l) throw new Error("no such league (--league)");
    const phases = await db<{ kind: string; round: number; opens_at: Date; status: string }[]>`
      select kind, round, opens_at, status from league_phases where league_id = ${l.id} order by opens_at, kind, round`;
    for (const p of phases) console.log(`  ${p.kind.padEnd(11)} ${p.round}  ${p.opens_at.toISOString()}  ${p.status}`);
    const ready = await inauguralReadiness(db, l.id);
    console.log(ready.ok ? "  ready to activate" : `  not ready:\n    ${ready.problems.join("\n    ")}`);
  } else if (cmd === "verify") {
    const r = await verifyArchive(db, opt("league") ?? "");
    console.log(
      r.ok ? "archive verified: unchanged since archival" : `archive differs:\n  ${r.differences.join("\n  ")}`,
    );
    code = r.ok ? 0 : 1;
  } else if ((ACTIONS as readonly string[]).includes(cmd)) {
    const action = cmd as Plan["action"];
    const args = {
      slug: opt("league") ?? "",
      confirm: opt("confirm") ?? "",
      name: opt("name"),
      division: opt("division") ?? null,
      tier: opt("tier") ? Number(opt("tier")) : null,
      season: opt("season"),
      backupRef: opt("backup"),
    };
    if (args.confirm) {
      print(await apply(db, action, args), true);
    } else {
      const p = await planFor(db, action, args);
      print(p, false);
      code = p.ok ? 0 : 1;
    }
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
} catch (e) {
  if (e instanceof PlanRefused) print(e.plan, false);
  console.error((e as Error).message);
  code = 1;
} finally {
  await db.end();
}
process.exit(code);
