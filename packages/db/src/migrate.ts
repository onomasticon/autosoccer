import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./client.ts";

export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Migration files are `NNNN_name.sql`, applied in version order, each in its own transaction. */
export function listMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), "utf8");
      return {
        version: Number(file.slice(0, 4)),
        name: file.replace(/\.sql$/, ""),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
}

/**
 * Applies pending migrations under a Postgres advisory lock, so concurrent
 * processes (API, worker, tests) never race. Refuses to run if an applied
 * migration's file has changed since it was applied.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const migrations = listMigrations(dir);
  const result: MigrationResult = { applied: [], skipped: [] };
  await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274)`;
    await tx`
      create table if not exists schema_migrations (
        version integer primary key,
        name text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`;
    const rows = await tx<{ version: number; name: string; checksum: string }[]>`
      select version, name, checksum from schema_migrations order by version`;
    const done = new Map(rows.map((r) => [r.version, r]));
    for (const m of migrations) {
      const prev = done.get(m.version);
      if (prev) {
        if (prev.checksum !== m.checksum) {
          throw new Error(`Migration ${m.name} was modified after being applied (checksum mismatch)`);
        }
        result.skipped.push(m.name);
        continue;
      }
      await tx.savepoint(async (sp) => {
        await sp.unsafe(m.sql);
        await sp`insert into schema_migrations (version, name, checksum) values (${m.version}, ${m.name}, ${m.checksum})`;
      });
      result.applied.push(m.name);
    }
  });
  return result;
}
