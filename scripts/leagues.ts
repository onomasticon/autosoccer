/**
 * League lifecycle commands (#93) against the configured DATABASE_URL. Every command is a dry run
 * unless it is given `--confirm <league-slug>`: it prints the preflight checks and the changes it
 * would make, and exits non-zero if a check fails.
 *
 *   bun run leagues list
 *   bun run leagues inventory --league original
 *   bun run leagues create --league founders --name "The Founders League" [--division "Division 1" --tier 1] [--confirm founders]
 *   bun run leagues final-season --league original --season season-30 [--confirm original]
 *   bun run leagues conclude --league original [--confirm original]
 *   bun run leagues archive --league original --backup db/2026-12-01T03:00:00Z.dump [--confirm original]
 *   bun run leagues verify --league original      # an archived league still matches its archive inventory
 *   bun run leagues unarchive --league original [--confirm original]   # rollback of an archive
 *   bun run leagues activate --league founders [--confirm founders]
 *   bun run leagues set-default --league founders [--confirm founders]
 *
 * Take a backup first (deploy/exe/backup.sh) for anything that changes a league. See
 * docs/platform/leagues.md for the cutover runbook.
 */
import { createDb } from "@autosoccer/db";
import { loadConfig } from "../apps/server/src/config.ts";
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

const ACTIONS = ["create", "final-season", "conclude", "archive", "unarchive", "activate", "set-default"] as const;
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
